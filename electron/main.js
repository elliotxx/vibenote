import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, protocol, shell } from 'electron'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rgPath } from '@vscode/ripgrep'
import { GitBackupManager } from './gitBackup.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged
const isHeadlessVerification = process.env.VIBENOTE_HEADLESS_VERIFY === '1'
const APP_NAME = 'vibenote'
const STREAM_FILE = 'stream.txt'

app.setName('Vibenote')
if (process.env.VIBENOTE_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.VIBENOTE_USER_DATA_DIR))
}

let mainWindow = null
let library = null
let aiSettings = null
let gitBackup = null
let currentSearch = null
let pendingOpenBuffer = null
let quitFlushPromise = null
let quitFlushComplete = false
const pendingOpenFiles = []
const quitFlushAcks = new Map()

function runtimeIconPath() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../build/icon.png')
  return fs.existsSync(candidate) ? candidate : null
}

function applyRuntimeIcon() {
  const iconPath = runtimeIconPath()
  if (!iconPath) return null
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }
  return iconPath
}

function safeJoin(base, relativePath) {
  const fullPath = path.resolve(base, relativePath)
  const basePath = path.resolve(base)
  if (fullPath !== basePath && !fullPath.startsWith(basePath + path.sep)) {
    throw new Error('Path escapes note library')
  }
  return fullPath
}

function slugifyName(name) {
  return name
    .trim()
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 80) || 'untitled'
}

function initialContent(name = 'Scratch') {
  const created = new Date().toISOString()
  return `${JSON.stringify({ formatVersion: '1.0.0', name, cursors: null, foldedRanges: [] })}\n---block:markdown;auto=1;created=${created}\n`
}

function isVibenoteContent(content) {
  return content.startsWith('---block:') || content.includes('\n---block:')
}

function noteNameFromFile(filePath) {
  const parsed = path.parse(filePath)
  return parsed.name || 'Untitled'
}

function wrapExternalContent(content, name) {
  if (isVibenoteContent(content)) return content
  const created = new Date().toISOString()
  return `${JSON.stringify({ formatVersion: '1.0.0', name, cursors: null, foldedRanges: [] })}\n---block:markdown;auto=1;created=${created}\n${content}`
}

function withVibenoteExtension(filePath) {
  return path.extname(filePath) ? filePath : `${filePath}.vibenote`
}

async function writeAtomic(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 })
  await fs.promises.rename(tmp, filePath)
}

function writeAtomicSync(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, filePath)
}

function compactTimestamp(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-')
}

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex')
}

function documentKey(documentId) {
  return String(documentId).replace(/[^a-z0-9._-]+/gi, '_')
}

function imageRefsForContent(content) {
  const refs = []
  const pattern = /!\[[^\]]*]\((<([^>]+)>|([^)]+))\)/g
  for (const match of content.matchAll(pattern)) {
    const target = (match[2] || match[3] || '').trim()
    if (!target) continue
    const exists = path.isAbsolute(target) && fs.existsSync(target)
    let size = null
    let hash = null
    if (exists) {
      try {
        const buffer = fs.readFileSync(target)
        size = buffer.length
        hash = crypto.createHash('sha256').update(buffer).digest('hex')
      } catch {
        // Keep the reference, but leave file metadata empty when unreadable.
      }
    }
    refs.push({ path: target, exists, size, hash })
  }
  return refs
}

class BackupManager {
  constructor(userDataPath) {
    this.backupsPath = path.join(userDataPath, 'backups')
    this.recoveryPath = path.join(userDataPath, 'recovery')
    this.maxSnapshots = 100
  }

  async init() {
    await fs.promises.mkdir(this.backupsPath, { recursive: true })
    await fs.promises.mkdir(this.recoveryPath, { recursive: true })
  }

  initSync() {
    fs.mkdirSync(this.backupsPath, { recursive: true })
    fs.mkdirSync(this.recoveryPath, { recursive: true })
  }

  docDir(documentId) {
    return path.join(this.backupsPath, documentKey(documentId))
  }

  manifestPath(documentId) {
    return path.join(this.docDir(documentId), 'manifest.json')
  }

  recoveryFilePath(documentId) {
    return path.join(this.recoveryPath, `${documentKey(documentId)}.vibenote`)
  }

  recoveryMetaPath(documentId) {
    return path.join(this.recoveryPath, `${documentKey(documentId)}.json`)
  }

  readManifestSync(documentId) {
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath(documentId), 'utf8'))
    } catch {
      return { documentId, snapshots: [] }
    }
  }

  async readManifest(documentId) {
    try {
      return JSON.parse(await fs.promises.readFile(this.manifestPath(documentId), 'utf8'))
    } catch {
      return { documentId, snapshots: [] }
    }
  }

  async writeManifest(documentId, manifest) {
    await fs.promises.mkdir(this.docDir(documentId), { recursive: true })
    await writeAtomic(this.manifestPath(documentId), JSON.stringify(manifest, null, 2))
  }

  writeManifestSync(documentId, manifest) {
    fs.mkdirSync(this.docDir(documentId), { recursive: true })
    writeAtomicSync(this.manifestPath(documentId), JSON.stringify(manifest, null, 2))
  }

  snapshotRecord(document, fileName, content, reason, highRisk) {
    return {
      fileName,
      reason,
      highRisk: Boolean(highRisk),
      createdAt: new Date().toISOString(),
      sourcePath: document.filePath,
      sourceIdentifier: document.identifier,
      sourceKind: document.kind,
      sourceSize: Buffer.byteLength(content, 'utf8'),
      contentHash: contentHash(content),
      appVersion: app.getVersion(),
      images: imageRefsForContent(content),
    }
  }

  snapshotFileName(reason) {
    const label = String(reason || 'snapshot')
      .replace(/[^a-z0-9._-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'snapshot'
    return `${compactTimestamp()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}-${label}.vibenote`
  }

  shouldCreateSnapshot(documentId, content, reason, force, manifest) {
    const hash = contentHash(content)
    const latest = manifest.snapshots?.at(-1)
    if (latest?.contentHash === hash) return false
    if (force) return true
    return true
  }

  trimManifestSync(documentId, manifest) {
    const snapshots = manifest.snapshots || []
    while (snapshots.length > this.maxSnapshots) {
      const removed = snapshots.shift()
      if (removed?.fileName) {
        try {
          fs.unlinkSync(path.join(this.docDir(documentId), removed.fileName))
        } catch {
          // Missing old snapshots should not block saving new content.
        }
      }
    }
    manifest.snapshots = snapshots
  }

  async trimManifest(documentId, manifest) {
    const snapshots = manifest.snapshots || []
    while (snapshots.length > this.maxSnapshots) {
      const removed = snapshots.shift()
      if (removed?.fileName) {
        try {
          await fs.promises.unlink(path.join(this.docDir(documentId), removed.fileName))
        } catch {
          // Missing old snapshots should not block saving new content.
        }
      }
    }
    manifest.snapshots = snapshots
  }

  async writeRecovery(document, content) {
    await fs.promises.mkdir(this.recoveryPath, { recursive: true })
    await writeAtomic(this.recoveryFilePath(document.documentId), content)
    await writeAtomic(this.recoveryMetaPath(document.documentId), JSON.stringify({
      documentId: document.documentId,
      identifier: document.identifier,
      filePath: document.filePath,
      kind: document.kind,
      contentHash: contentHash(content),
      updatedAt: new Date().toISOString(),
    }, null, 2))
  }

  writeRecoverySync(document, content) {
    fs.mkdirSync(this.recoveryPath, { recursive: true })
    writeAtomicSync(this.recoveryFilePath(document.documentId), content)
    writeAtomicSync(this.recoveryMetaPath(document.documentId), JSON.stringify({
      documentId: document.documentId,
      identifier: document.identifier,
      filePath: document.filePath,
      kind: document.kind,
      contentHash: contentHash(content),
      updatedAt: new Date().toISOString(),
    }, null, 2))
  }

  async snapshot(document, content, options = {}) {
    const reason = options.reason || 'autosave'
    const force = Boolean(options.force)
    const highRisk = Boolean(options.highRisk)
    const manifest = await this.readManifest(document.documentId)
    manifest.documentId = document.documentId
    manifest.identifier = document.identifier
    manifest.filePath = document.filePath
    manifest.kind = document.kind
    manifest.updatedAt = new Date().toISOString()
    manifest.snapshots = manifest.snapshots || []
    if (!this.shouldCreateSnapshot(document.documentId, content, reason, force, manifest)) {
      return null
    }

    await fs.promises.mkdir(this.docDir(document.documentId), { recursive: true })
    const fileName = this.snapshotFileName(reason)
    await writeAtomic(path.join(this.docDir(document.documentId), fileName), content)
    manifest.snapshots.push(this.snapshotRecord(document, fileName, content, reason, highRisk))
    await this.trimManifest(document.documentId, manifest)
    await this.writeManifest(document.documentId, manifest)
    return manifest.snapshots.at(-1)
  }

  snapshotSync(document, content, options = {}) {
    const reason = options.reason || 'manual'
    const force = Boolean(options.force)
    const highRisk = Boolean(options.highRisk)
    this.initSync()
    const manifest = this.readManifestSync(document.documentId)
    manifest.documentId = document.documentId
    manifest.identifier = document.identifier
    manifest.filePath = document.filePath
    manifest.kind = document.kind
    manifest.updatedAt = new Date().toISOString()
    manifest.snapshots = manifest.snapshots || []
    if (!this.shouldCreateSnapshot(document.documentId, content, reason, force, manifest)) {
      return null
    }

    fs.mkdirSync(this.docDir(document.documentId), { recursive: true })
    const fileName = this.snapshotFileName(reason)
    writeAtomicSync(path.join(this.docDir(document.documentId), fileName), content)
    manifest.snapshots.push(this.snapshotRecord(document, fileName, content, reason, highRisk))
    this.trimManifestSync(document.documentId, manifest)
    this.writeManifestSync(document.documentId, manifest)
    return manifest.snapshots.at(-1)
  }

  async recoveriesFor(documents) {
    const results = []
    for (const document of documents) {
      const recoveryFile = this.recoveryFilePath(document.documentId)
      if (!fs.existsSync(recoveryFile)) continue
      const recoveryStat = await fs.promises.stat(recoveryFile)
      const targetExists = fs.existsSync(document.filePath)
      if (targetExists) {
        const targetStat = await fs.promises.stat(document.filePath)
        if (recoveryStat.mtimeMs <= targetStat.mtimeMs + 1) continue
      }
      results.push({
        documentId: document.documentId,
        identifier: document.identifier,
        filePath: document.filePath,
        kind: document.kind,
        targetExists,
        updatedAt: recoveryStat.mtime.toISOString(),
      })
    }
    return results
  }

  async readRecovery(document) {
    const recoveryFile = this.recoveryFilePath(document.documentId)
    const content = await fs.promises.readFile(recoveryFile, 'utf8')
    const recoveryStat = await fs.promises.stat(recoveryFile)
    return {
      documentId: document.documentId,
      identifier: document.identifier,
      filePath: document.filePath,
      kind: document.kind,
      targetExists: fs.existsSync(document.filePath),
      updatedAt: recoveryStat.mtime.toISOString(),
      content,
    }
  }
}

async function readMetadata(filePath) {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const head = buffer.subarray(0, bytesRead).toString('utf8')
    const idx = head.indexOf('\n---block:')
    if (idx === -1) {
      return {}
    }
    return JSON.parse(head.slice(0, idx).trim() || '{}')
  } catch {
    return {}
  } finally {
    await handle.close()
  }
}

class FileLibrary {
  constructor(basePath, userDataPath) {
    this.basePath = basePath
    this.userDataPath = userDataPath
    this.legacyImagesPath = path.join(basePath, '.images')
    this.appImagesPath = path.join(userDataPath, 'images')
    this.externalRegistryPath = path.join(userDataPath, 'external-documents.json')
    this.backups = new BackupManager(userDataPath)
    this.externalDocuments = new Map()
    this.loaded = new Map()
    this.onInternalChange = () => {}
  }

  async init() {
    await fs.promises.mkdir(this.basePath, { recursive: true })
    await fs.promises.mkdir(this.legacyImagesPath, { recursive: true })
    await fs.promises.mkdir(this.appImagesPath, { recursive: true })
    await this.backups.init()
    await this.loadExternalRegistry()
    const streamPath = path.join(this.basePath, STREAM_FILE)
    if (!fs.existsSync(streamPath)) {
      await writeAtomic(streamPath, initialContent('Stream'))
    }
  }

  async loadExternalRegistry() {
    try {
      const raw = await fs.promises.readFile(this.externalRegistryPath, 'utf8')
      const records = JSON.parse(raw)
      if (!Array.isArray(records)) return
      this.externalDocuments = new Map(
        records
          .filter(record => record?.id && record?.filePath)
          .map(record => [String(record.id), path.resolve(String(record.filePath))]),
      )
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        console.warn('Failed to read external document registry', error)
      }
    }
  }

  async saveExternalRegistry() {
    const records = Array.from(this.externalDocuments.entries())
      .map(([id, filePath]) => ({ id, filePath }))
    await writeAtomic(this.externalRegistryPath, JSON.stringify(records, null, 2))
  }

  documentIdForPath(filePath) {
    const resolved = path.resolve(filePath)
    const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 16)
    return `external:${hash}`
  }

  documentRecord(identifier = STREAM_FILE) {
    const requestedPath = String(identifier || STREAM_FILE)
    const filePath = this.resolveBufferPath(requestedPath)
    if (this.externalDocuments.has(requestedPath)) {
      return {
        documentId: requestedPath,
        identifier: requestedPath,
        filePath,
        kind: 'external',
      }
    }

    const relativePath = path.relative(this.basePath, filePath)
    const documentId = relativePath === STREAM_FILE
      ? 'internal:stream'
      : `internal:${crypto.createHash('sha256').update(relativePath).digest('hex').slice(0, 16)}`
    return {
      documentId,
      identifier: requestedPath,
      filePath,
      kind: 'internal',
    }
  }

  allDocumentRecords() {
    const seen = new Set()
    const records = []
    const addRecord = identifier => {
      try {
        const record = this.documentRecord(identifier)
        if (seen.has(record.documentId)) return
        seen.add(record.documentId)
        records.push(record)
      } catch {
        // Ignore documents that disappeared before recovery scanning.
      }
    }

    addRecord(STREAM_FILE)
    try {
      for (const entry of fs.readdirSync(this.basePath, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.txt')) addRecord(entry.name)
      }
    } catch {
      // The notes directory may not exist during early startup.
    }
    for (const [id] of this.externalDocuments.entries()) {
      addRecord(id)
    }
    return records
  }

  async registerExternal(filePath) {
    const resolved = path.resolve(filePath)
    const id = this.documentIdForPath(resolved)
    this.externalDocuments.set(id, resolved)
    await this.saveExternalRegistry()
    return id
  }

  async bufferInfoForExternal(id, filePath) {
    const metadata = fs.existsSync(filePath) ? await readMetadata(filePath) : {}
    return {
      path: id,
      name: metadata.name || noteNameFromFile(filePath),
      tags: metadata.tags || [],
      isScratch: false,
      isExternal: true,
      filePath,
    }
  }

  resolveBufferPath(identifier = STREAM_FILE) {
    const requestedPath = String(identifier || STREAM_FILE)
    if (this.externalDocuments.has(requestedPath)) {
      return this.externalDocuments.get(requestedPath)
    }

    if (path.isAbsolute(requestedPath)) {
      const resolved = path.resolve(requestedPath)
      const registered = Array.from(this.externalDocuments.values())
        .find(filePath => path.resolve(filePath) === resolved)
      if (registered) return registered
      throw new Error('External document is not registered')
    }

    return safeJoin(this.basePath, requestedPath)
  }

  async list() {
    const entries = await fs.promises.readdir(this.basePath, { withFileTypes: true })
    const buffers = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.txt')) {
        continue
      }
      const metadata = await readMetadata(path.join(this.basePath, entry.name))
      buffers.push({
        path: entry.name,
        name: metadata.name || entry.name.replace(/\.txt$/, ''),
        tags: metadata.tags || [],
        isScratch: entry.name === STREAM_FILE,
      })
    }
    for (const [id, filePath] of this.externalDocuments.entries()) {
      if (!fs.existsSync(filePath)) continue
      buffers.push(await this.bufferInfoForExternal(id, filePath))
    }
    return buffers.sort((a, b) => {
      if (a.isScratch) return -1
      if (b.isScratch) return 1
      if (a.isExternal && !b.isExternal) return 1
      if (!a.isExternal && b.isExternal) return -1
      return a.name.localeCompare(b.name)
    })
  }

  async load(identifier) {
    const filePath = this.resolveBufferPath(identifier)
    const raw = await fs.promises.readFile(filePath, 'utf8')
    const content = this.externalDocuments.has(String(identifier))
      ? wrapExternalContent(raw, noteNameFromFile(filePath))
      : raw
    this.loaded.set(identifier, content)
    return content
  }

  async save(identifier, content) {
    const document = this.documentRecord(identifier)
    const filePath = document.filePath
    await this.backups.writeRecovery(document, content)
    if (fs.existsSync(filePath)) {
      const previous = await fs.promises.readFile(filePath, 'utf8')
      if (previous !== content) {
        await this.backups.snapshot(document, previous, { reason: 'autosave' })
      }
    }
    await writeAtomic(filePath, content)
    this.loaded.set(identifier, content)
    if (document.kind === 'internal') this.onInternalChange()
    return true
  }

  saveSync(identifier, content) {
    const document = this.documentRecord(identifier)
    const filePath = document.filePath
    this.backups.writeRecoverySync(document, content)
    if (fs.existsSync(filePath)) {
      const previous = fs.readFileSync(filePath, 'utf8')
      if (previous !== content) {
        this.backups.snapshotSync(document, previous, { reason: 'autosave' })
      }
    }
    writeAtomicSync(filePath, content)
    this.loaded.set(identifier, content)
    if (document.kind === 'internal') this.onInternalChange()
    return true
  }

  async snapshot(identifier, content, reason = 'manual') {
    const document = this.documentRecord(identifier)
    await this.backups.writeRecovery(document, content)
    await this.backups.snapshot(document, content, { reason, force: true, highRisk: true })
    return true
  }

  snapshotSync(identifier, content, reason = 'manual') {
    const document = this.documentRecord(identifier)
    this.backups.writeRecoverySync(document, content)
    this.backups.snapshotSync(document, content, { reason, force: true, highRisk: true })
    return true
  }

  async listRecoveries() {
    return this.backups.recoveriesFor(this.allDocumentRecords())
  }

  async readRecovery(identifier) {
    return this.backups.readRecovery(this.documentRecord(identifier))
  }

  async create(name) {
    const base = slugifyName(name)
    let fileName = `${base}.txt`
    let counter = 2
    while (fs.existsSync(path.join(this.basePath, fileName))) {
      fileName = `${base}-${counter++}.txt`
    }
    await writeAtomic(path.join(this.basePath, fileName), initialContent(name))
    this.onInternalChange()
    return fileName
  }

  async delete(relativePath) {
    if (relativePath === STREAM_FILE) {
      throw new Error('Main note stream cannot be deleted')
    }
    if (this.externalDocuments.has(String(relativePath))) {
      throw new Error('External files cannot be deleted from Vibenote')
    }
    await fs.promises.unlink(safeJoin(this.basePath, relativePath))
    this.loaded.delete(relativePath)
    this.onInternalChange()
    return true
  }

  async archiveStream(name) {
    const stream = await this.load(STREAM_FILE)
    const archivePath = await this.create(name)
    await this.save(archivePath, stream.replace(/^\{.*?\}/s, JSON.stringify({
      formatVersion: '1.0.0',
      name,
      cursors: null,
      foldedRanges: [],
    })))
    await this.save(STREAM_FILE, initialContent('Stream'))
    return archivePath
  }

  resolveDocumentPath(documentPath = STREAM_FILE) {
    return this.resolveBufferPath(documentPath)
  }

  documentAssetKey(documentPath = STREAM_FILE) {
    const resolved = this.resolveDocumentPath(documentPath)
    const parsed = path.parse(resolved)
    const label = slugifyName(parsed.name || 'document')
    const hash = crypto.createHash('sha256').update(resolved).digest('hex').slice(0, 12)
    return `${label}-${hash}`
  }

  imageDirectoryFor(documentPath, storageMode) {
    const mode = storageMode === 'app-data' ? 'app-data' : 'beside-file'
    if (mode === 'app-data') {
      return path.join(this.appImagesPath, this.documentAssetKey(documentPath))
    }

    const documentFile = this.resolveDocumentPath(documentPath)
    const parsed = path.parse(documentFile)
    return path.join(parsed.dir, `${parsed.name}.assets`)
  }

  async saveImage({ mime, data, documentPath, storageMode }) {
    if (!mime || !mime.startsWith('image/')) {
      throw new Error('Only image data can be saved')
    }
    const ext = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1].replace(/[^a-z0-9]/gi, '')
    const suffix = crypto.randomBytes(4).toString('hex')
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}-${suffix}.${ext}`
    const imagesPath = this.imageDirectoryFor(documentPath, storageMode)
    await fs.promises.mkdir(imagesPath, { recursive: true })
    const filePath = path.join(imagesPath, fileName)
    await fs.promises.writeFile(filePath, Buffer.from(data))
    if (this.documentRecord(documentPath).kind === 'internal') this.onInternalChange()
    return filePath
  }

  resolveLegacyImageUrl(url) {
    if (!url.startsWith('vibenote-image://')) return url
    const parsed = new URL(url)
    const fileName = decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\//, ''))
    return safeJoin(this.legacyImagesPath, fileName)
  }

  async openExternalPath(filePath) {
    const resolved = path.resolve(filePath)
    if (!fs.existsSync(resolved)) {
      throw new Error('File does not exist')
    }
    const id = await this.registerExternal(resolved)
    return this.bufferInfoForExternal(id, resolved)
  }

  async openExternalWithDialog() {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '打开 Vibenote 文件',
      properties: ['openFile'],
      filters: [
        { name: 'Vibenote 文件', extensions: ['vibenote', 'txt', 'md'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return this.openExternalPath(result.filePaths[0])
  }

  async createExternalWithDialog() {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '新建 Vibenote 文件',
      defaultPath: 'Untitled.vibenote',
      filters: [
        { name: 'Vibenote 文件', extensions: ['vibenote'] },
        { name: 'Markdown / Text', extensions: ['md', 'txt'] },
      ],
    })
    if (result.canceled || !result.filePath) return null
    const filePath = withVibenoteExtension(result.filePath)
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    if (!fs.existsSync(filePath)) {
      await writeAtomic(filePath, initialContent(noteNameFromFile(filePath)))
    }
    const id = await this.registerExternal(filePath)
    return this.bufferInfoForExternal(id, filePath)
  }
}

class AiSettingsStore {
  constructor(basePath) {
    this.settingsPath = path.join(basePath, 'ai-settings.json')
    this.keyPath = path.join(basePath, 'ai-key.bin')
    this.defaults = {
      enabled: false,
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }
  }

  async readKeyRecord() {
    try {
      const raw = await fs.promises.readFile(this.keyPath, 'utf8')
      try {
        return JSON.parse(raw)
      } catch {
        return {
          version: 0,
          storage: 'safeStorage',
          value: raw,
        }
      }
    } catch {
      return null
    }
  }

  keyStorageFromRecord(record) {
    if (!record) return 'none'
    if (record.storage === 'localFallback') return 'local-fallback'
    if (record.storage === 'safeStorage') return 'unknown'
    return 'unknown'
  }

  async readSettings() {
    let stored = {}
    try {
      stored = JSON.parse(await fs.promises.readFile(this.settingsPath, 'utf8'))
    } catch {
      stored = {}
    }
    const keyRecord = await this.readKeyRecord()
    return {
      ...this.defaults,
      ...stored,
      hasApiKey: Boolean(keyRecord),
      keyStorage: this.keyStorageFromRecord(keyRecord),
    }
  }

  async saveSettings(settings) {
    const { hasApiKey, keyStorage, ...safeSettings } = settings || {}
    void hasApiKey
    void keyStorage
    await writeAtomic(this.settingsPath, JSON.stringify({ ...this.defaults, ...safeSettings }, null, 2))
    return this.readSettings()
  }

  async setApiKey(apiKey) {
    const value = String(apiKey || '').trim()
    if (!value) {
      throw new Error('API key is required')
    }
    const record = {
      version: 1,
      storage: 'localFallback',
      value: Buffer.from(value, 'utf8').toString('base64'),
    }
    await writeAtomic(this.keyPath, JSON.stringify(record, null, 2))
    return this.readSettings()
  }

  async clearApiKey() {
    await fs.promises.rm(this.keyPath, { force: true })
    return this.readSettings()
  }

  async readApiKey() {
    const record = await this.readKeyRecord()
    if (!record) {
      throw new Error('API key is required')
    }
    if (record.storage === 'localFallback') {
      return Buffer.from(record.value, 'base64').toString('utf8')
    }
    if (record.storage === 'safeStorage') {
      throw new Error('This API key was saved with macOS Keychain. Clear it and save it again.')
    }
    throw new Error('Unsupported API key storage')
  }

  endpointFor(settings) {
    const baseUrl = String(settings.baseUrl || '').trim().replace(/\/+$/, '')
    if (!baseUrl) {
      throw new Error('Base URL is required')
    }
    if (baseUrl.endsWith('/chat/completions')) return baseUrl
    return `${baseUrl}/chat/completions`
  }

  textFromAiValue(value) {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      return value
        .map(item => {
          if (typeof item === 'string') return item
          if (typeof item?.text === 'string') return item.text
          if (typeof item?.text?.value === 'string') return item.text.value
          if (typeof item?.content === 'string') return item.content
          if (Array.isArray(item?.content)) return this.textFromAiValue(item.content)
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
    return ''
  }

  normalizeAiContent(content) {
    const normalized = String(content || '')
      .replace(/\r\n?/g, '\n')
      .trim()

    if (!normalized.includes('\n') && normalized.includes('\\n')) {
      return normalized.replace(/\\n/g, '\n').replace(/\\t/g, '  ').trim()
    }

    return normalized
  }

  contentFromChatResponse(data) {
    const choice = data?.choices?.[0]
    const responseOutputContent = Array.isArray(data?.output)
      ? data.output.flatMap(item => item?.content || [])
      : []
    return this.normalizeAiContent(
      this.textFromAiValue(choice?.message?.content) ||
      this.textFromAiValue(choice?.text) ||
      this.textFromAiValue(data?.output_text) ||
      this.textFromAiValue(responseOutputContent),
    )
  }

  todoBodyFromLine(line) {
    return String(line || '').match(/^\s*[-*]\s*\[[ xX]\]\s*(.+?)\s*$/)?.[1]?.trim() || ''
  }

  isLikelyActionableTodo(body) {
    const text = String(body || '').trim()
    if (!text || /[:：]\s*$/.test(text)) return false
    if (/^(讨论|交流|周报内容|AI\s*工具对齐|模式调整|本周目标|下阶段规划)$/i.test(text)) {
      return false
    }
    return /(确认|判断|修复|处理|重启|读|推进|跟进|申请|建设|支持|交付|评估|测试|验证|自测|跑|收集|补齐|打标|通知|登录|扫描|使用|分析|解决|优化|覆盖|联调|归因|治理|拆解|上线|发布|检查|整理|迁移|接入|创建|更新|改|写|看|找|补|review|fix|update|verify|test|ship|release|deploy|implement|support|create)/i.test(text)
  }

  normalizeTodoContent(content) {
    return this.normalizeAiContent(content)
      .split('\n')
      .map(line => this.todoBodyFromLine(line))
      .filter(body => this.isLikelyActionableTodo(body))
      .map(body => `- [ ] ${body}`)
      .join('\n')
      .trim()
  }

  aiCompletionPrompt({ scope, language, input, isSelection, instruction: customInstruction }) {
    const guidance = isSelection
      ? [
          'Polish the selected note text below.',
          'Improve clarity, wording, and readability without changing the meaning.',
          'Make concrete wording improvements where possible instead of echoing the source unchanged.',
          'Preserve every selected item, line, owner, date, decision, and open question.',
          'Keep the selected text structure, line breaks, indentation, list nesting, and paragraph spacing unless it is clearly malformed.',
          'If the selection has multiple lines, return a complete multi-line result with all source items still represented.',
        ]
      : [
          'Polish the entire current block below.',
          'Improve clarity, wording, and readability without changing the meaning.',
          'Make concrete wording improvements where possible instead of echoing the source unchanged.',
          'Preserve every original item, line, owner, date, decision, and open question.',
          'Preserve the original structure, line breaks, indentation, list nesting, task checkboxes, names, dates, decisions, and open questions.',
          'Do not summarize, continue writing, add new ideas, or turn it into a different format.',
        ]

    return [
      `Source scope: ${scope}.`,
      `Source language: ${language}.`,
      ...(customInstruction
        ? [
            'Apply this user-requested editing direction while preserving the note facts and structure:',
            customInstruction,
          ]
        : []),
      ...guidance,
      'Keep the original language.',
      'Do not omit low-level details just because they look repetitive.',
      'Do not summarize, shorten, truncate, or replace a list with a high-level overview.',
      'Return only the polished note content.',
      '',
      input,
    ].join('\n')
  }

  aiAnswerPrompt({ scope, language, input, isSelection, instruction }) {
    return [
      `Source scope: ${scope}.`,
      `Source language: ${language}.`,
      isSelection
        ? 'Answer the user question about the selected note text below.'
        : 'Answer the user question about the entire current block below.',
      'Use only information supported by the note unless the user explicitly asks for a broader opinion.',
      'Keep the answer concise, direct, and in the original language.',
      'Do not rewrite the note, propose replacement text, or imply that the source will be modified.',
      'Do not include Markdown fences or Vibenote block delimiter metadata.',
      '',
      'User question:',
      instruction,
      '',
      'Note content:',
      input,
    ].join('\n')
  }

  maxTokensForCompletion(input, mode) {
    if (mode === 'extract-todos') return 1400
    return Math.min(6000, Math.max(1800, Math.ceil(String(input || '').length * 1.35)))
  }

  aiTodoPrompt({ scope, language, input, isSelection }) {
    return [
      `Source scope: ${scope}.`,
      `Source language: ${language}.`,
      isSelection
        ? 'Extract actionable todo items from the selected note text below.'
        : 'Extract actionable todo items from the entire current block below.',
      'Keep the original language.',
      'Return only Markdown task list items.',
      'Use exactly this marker for every item: - [ ]',
      'Keep each item concise and concrete.',
      'A valid todo must contain an action verb or a concrete requested outcome.',
      'Ignore section headings, topic labels, meeting titles, categories, standalone nouns, and lines ending with a colon.',
      'Do not turn headings such as "成本中心:", "讨论:", "周报内容", "测试应用", or "e2e case" into todos.',
      'Preserve important owners, dates, names, and context when they clarify the task.',
      'Do not include headings, commentary, numbering, quotes, or metadata.',
      '',
      input,
    ].join('\n')
  }

  async testConnection() {
    const settings = await this.readSettings()
    if (!settings.enabled) {
      return { ok: false, message: 'AI is disabled' }
    }
    if (!settings.hasApiKey) {
      return { ok: false, message: 'API key is required' }
    }
    if (!settings.model) {
      return { ok: false, message: 'Model is required' }
    }

    try {
      const response = await fetch(this.endpointFor(settings), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.readApiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 4,
          temperature: 0,
        }),
      })

      if (!response.ok) {
        return { ok: false, message: `Connection failed (${response.status})` }
      }
      return { ok: true, message: 'Connection OK' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' }
    }
  }

  async complete(payload) {
    const settings = await this.readSettings()
    const input = String(payload?.input || '').trim()
    const language = String(payload?.language || 'markdown').trim() || 'markdown'
    const mode = payload?.mode === 'extract-todos' ? 'extract-todos' : 'polish'
    const intent = payload?.intent === 'answer' ? 'answer' : 'rewrite'
    const instruction = String(payload?.instruction || '').trim().slice(0, 800)
    const isSelection = payload?.scope === 'selection'
    const scope = isSelection ? 'selection' : 'current block'

    if (!settings.enabled) {
      return { ok: false, message: 'AI is disabled', content: '' }
    }
    if (!settings.hasApiKey) {
      return { ok: false, message: 'API key is required', content: '' }
    }
    if (!settings.model) {
      return { ok: false, message: 'Model is required', content: '' }
    }
    if (!input) {
      return { ok: false, message: 'Nothing to send to AI', content: '' }
    }

    try {
      const response = await fetch(this.endpointFor(settings), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.readApiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            {
              role: 'system',
              content: mode === 'extract-todos'
                ? [
                    'You are Vibenote, an AI-native plain text note assistant.',
                    'Extract actionable todos from note content.',
                    'Return only directly insertable Markdown checklist lines.',
                    'Every line must begin with "- [ ] ".',
                    'Do not collapse separate tasks together.',
                    'Only include concrete actions. Exclude headings, topics, categories, standalone nouns, and colon-ended labels.',
                    'A valid todo should contain an action verb or a clearly requested outcome.',
                    'Do not include headings, explanations, quotes, or metadata.',
                    'If the content has no explicit task, infer only strongly implied next actions.',
                    'If there is still no actionable todo, return an empty response.',
                    'Do not output Vibenote block delimiter metadata.',
                  ].join(' ')
                : intent === 'answer'
                  ? [
                      'You are Vibenote, an AI-native plain text note assistant.',
                      'Answer the user question about the supplied note content.',
                      'Do not rewrite, replace, or mutate the note.',
                      'Give a concise, useful answer grounded in the source text.',
                      'Do not invent facts that are not in the note.',
                      'Do not output Vibenote block delimiter metadata.',
                    ].join(' ')
                  : [
                    'You are Vibenote, an AI-native plain text note assistant.',
                    'Polish note content for clearer expression.',
                    'Make concrete wording improvements where possible instead of echoing the source unchanged.',
                    'Return only the complete polished note content that should be inserted as a new block.',
                    'Preserve every source item; do not omit lines, bullets, owners, dates, decisions, or open questions.',
                    'Preserve the source structure: keep line breaks, list markers, indentation, and paragraph spacing.',
                    'Do not collapse multi-line input into one paragraph.',
                    'For multi-line source text, return a multi-line result.',
                    'Do not summarize, shorten, or replace detailed notes with a high-level overview.',
                    'Never truncate with ellipses or leave a sentence unfinished.',
                    'Do not summarize, continue writing, add new ideas, or change the original meaning.',
                    'If the source is already useful, return a lightly cleaned version; never return an empty response.',
                    'If there is no useful improvement to make, return the original source text exactly.',
                    'Do not include markdown fences unless they are part of the useful note.',
                    'Do not output Vibenote block delimiter metadata.',
                  ].join(' '),
            },
            {
              role: 'user',
              content: mode === 'extract-todos'
                ? this.aiTodoPrompt({ scope, language, input, isSelection })
                : intent === 'answer'
                  ? this.aiAnswerPrompt({ scope, language, input, isSelection, instruction })
                  : this.aiCompletionPrompt({ scope, language, input, isSelection, instruction }),
            },
          ],
          max_tokens: this.maxTokensForCompletion(input, mode),
          temperature: 0.3,
        }),
      })

      if (!response.ok) {
        return { ok: false, message: `AI request failed (${response.status})`, content: '' }
      }

      const data = await response.json()
      const rawContent = this.contentFromChatResponse(data)
      const content = mode === 'extract-todos' ? this.normalizeTodoContent(rawContent) : rawContent
      if (!content && mode === 'polish' && intent !== 'answer') {
        return { ok: true, message: 'AI kept the current block', content: input }
      }
      if (!content) {
        return { ok: true, message: 'No todos found', content: '' }
      }
      return {
        ok: true,
        message: mode === 'extract-todos'
          ? 'Todo list inserted'
          : intent === 'answer'
            ? 'AI answer generated'
            : 'Polished note inserted',
        content,
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'AI request failed',
        content: '',
      }
    }
  }
}

function createWindow() {
  const iconPath = runtimeIconPath()
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    title: 'Vibenote',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f6f8',
    show: !isHeadlessVerification,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(1)
  })

  mainWindow.webContents.on('zoom-changed', event => {
    event.preventDefault()
    mainWindow?.webContents.setZoomFactor(1)
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const command = editorCommandForInput(input)
    if (!command) return
    event.preventDefault()
    mainWindow?.webContents.send('editor:command', command)
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3344')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function sendEditorCommandWhenFocused(command) {
  if (!mainWindow || !mainWindow.isVisible()) return
  mainWindow.webContents.send('editor:command', command)
}

function notifyBufferOpened(buffer) {
  if (!buffer || !mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('buffer:opened', buffer)
}

async function openExternalPathAndNotify(filePath) {
  try {
    const buffer = await library.openExternalPath(filePath)
    notifyBufferOpened(buffer)
    return buffer
  } catch (error) {
    dialog.showErrorBox('无法打开文件', error instanceof Error ? error.message : String(error))
    return null
  }
}

async function openExternalWithDialogAndNotify() {
  try {
    notifyBufferOpened(await library.openExternalWithDialog())
  } catch (error) {
    dialog.showErrorBox('无法打开文件', error instanceof Error ? error.message : String(error))
  }
}

async function createExternalWithDialogAndNotify() {
  try {
    notifyBufferOpened(await library.createExternalWithDialog())
  } catch (error) {
    dialog.showErrorBox('无法创建文件', error instanceof Error ? error.message : String(error))
  }
}

function setupApplicationMenu() {
  const template = [
    {
      label: 'Vibenote',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: '新建 Vibenote 文件...',
          accelerator: 'CommandOrControl+N',
          click: () => createExternalWithDialogAndNotify(),
        },
        {
          label: '打开...',
          accelerator: 'CommandOrControl+O',
          click: () => openExternalWithDialogAndNotify(),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'New Block After',
          accelerator: 'CommandOrControl+Enter',
          click: () => sendEditorCommandWhenFocused('block:add-after'),
        },
        {
          label: 'Format Block',
          accelerator: 'Alt+Shift+F',
          click: () => sendEditorCommandWhenFocused('block:format'),
        },
        {
          label: 'Delete Block',
          accelerator: 'Ctrl+Shift+D',
          click: () => sendEditorCommandWhenFocused('block:delete'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', accelerator: 'CommandOrControl+Alt+Shift+R' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Reset Editor Font Size',
          accelerator: 'CommandOrControl+0',
          click: () => sendEditorCommandWhenFocused('view:font-reset'),
        },
        {
          label: 'Increase Editor Font Size',
          accelerator: 'CommandOrControl+Plus',
          click: () => sendEditorCommandWhenFocused('view:font-increase'),
        },
        {
          label: 'Decrease Editor Font Size',
          accelerator: 'CommandOrControl+-',
          click: () => sendEditorCommandWhenFocused('view:font-decrease'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function editorCommandForInput(input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null
  const primary = input.meta || input.control
  const key = input.key.toLowerCase()
  if (primary && key === 'n') return 'file:new'
  if (primary && key === 'o') return 'file:open'
  if (primary && key === 'f') return input.shift ? 'search:document' : 'search:block'
  if (primary && key === 'r') return input.shift ? 'replace:document' : 'replace:block'
  if (primary && (key === '=' || key === '+')) return 'view:font-increase'
  if (primary && key === '-') return 'view:font-decrease'
  if (primary && key === '0') return 'view:font-reset'
  if (key === 'enter' && primary && input.alt) return 'block:split'
  if (key === 'enter' && primary && input.shift) return 'block:add-end'
  if (key === 'enter' && input.alt && input.shift) return 'block:add-start'
  if (key === 'enter' && input.alt) return 'block:add-before'
  if (key === 'enter' && primary) return 'block:add-after'
  if (key === 'd' && primary && input.shift) return 'block:delete'
  if (key === 'arrowup' && primary && input.alt) return 'cursor:add-above'
  if (key === 'arrowdown' && primary && input.alt) return 'cursor:add-below'
  if (key === 'arrowup' && primary) return 'block:previous'
  if (key === 'arrowdown' && primary) return 'block:next'
  if (key === 'l' && primary) return 'language:focus'
  if (key === 'f' && input.alt && input.shift) return 'block:format'
  return null
}

function startSearch(query) {
  if (currentSearch) {
    currentSearch.kill()
    currentSearch = null
  }
  return new Promise((resolve, reject) => {
    const results = []
    const args = ['--json', '--line-number', '--column', '--fixed-strings', '--ignore-case', '--glob', '*.txt', '--glob', '!.images/**', '--', query, '.']
    const rg = spawn(rgPath.replace(/app\.asar/, 'app.asar.unpacked'), args, { cwd: library.basePath })
    currentSearch = rg
    let stderr = ''
    rg.stdout.setEncoding('utf8')
    rg.stderr.setEncoding('utf8')
    rg.stdout.on('data', chunk => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line) continue
        try {
          const event = JSON.parse(line)
          if (event.type !== 'match') continue
          const data = event.data
          const preview = (data.lines?.text || '').trim()
          results.push({
            path: data.path?.text?.replace(/^\.\//, '') || '',
            line: data.line_number,
            column: data.submatches?.[0]?.start || 0,
            preview,
          })
        } catch {
          // Ignore partial or malformed ripgrep JSON chunks.
        }
      }
    })
    rg.stderr.on('data', chunk => {
      stderr += chunk
    })
    rg.on('close', code => {
      currentSearch = null
      if (code !== 0 && code !== 1) {
        reject(new Error(stderr || `ripgrep exited with ${code}`))
      } else {
        resolve(results)
      }
    })
  })
}

app.whenReady().then(async () => {
  if (isHeadlessVerification && process.platform === 'darwin' && app.dock) {
    app.dock.hide()
  } else {
    applyRuntimeIcon()
  }
  const userDataPath = app.getPath('userData')
  const basePath = path.join(userDataPath, 'notes')
  library = new FileLibrary(basePath, userDataPath)
  aiSettings = new AiSettingsStore(userDataPath)
  await library.init()
  gitBackup = new GitBackupManager({
    userDataPath,
    notesPath: basePath,
    appVersion: app.getVersion(),
    onStatusChanged(status) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('git-backup:status-changed', status)
      }
    },
  })
  library.onInternalChange = () => gitBackup?.markDirty()
  await gitBackup.init()
  for (const filePath of pendingOpenFiles.splice(0)) {
    pendingOpenBuffer = await library.openExternalPath(filePath)
  }
  protocol.handle('vibenote-image', async request => {
    const fileName = decodeURIComponent(new URL(request.url).hostname || new URL(request.url).pathname.replace(/^\//, ''))
    const filePath = safeJoin(library.legacyImagesPath, fileName)
    return new Response(await fs.promises.readFile(filePath))
  })
  setupApplicationMenu()
  createWindow()
  if (!isHeadlessVerification) {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (!mainWindow) return
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    })
    globalShortcut.register('CommandOrControl+Shift+D', () => {
      sendEditorCommandWhenFocused('block:delete')
    })
    globalShortcut.register('Ctrl+Shift+D', () => {
      sendEditorCommandWhenFocused('block:delete')
    })
  }
})

app.on('open-file', (event, filePath) => {
  event.preventDefault()
  if (!library) {
    pendingOpenFiles.push(filePath)
    return
  }
  void openExternalPathAndNotify(filePath)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  gitBackup?.stop()
})

app.on('before-quit', event => {
  if (quitFlushComplete || !gitBackup?.getSettings().enabled) return
  event.preventDefault()
  if (quitFlushPromise) return
  const deadlineAt = Date.now() + 5_000
  quitFlushPromise = (async () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const requestId = crypto.randomUUID()
      const rendererBudget = Math.max(0, Math.min(1_000, deadlineAt - Date.now()))
      const acknowledged = new Promise(resolve => {
        const timeout = setTimeout(() => {
          quitFlushAcks.delete(requestId)
          resolve(false)
        }, rendererBudget)
        quitFlushAcks.set(requestId, () => {
          clearTimeout(timeout)
          quitFlushAcks.delete(requestId)
          resolve(true)
        })
      })
      mainWindow.webContents.send('app:flush-before-quit', requestId)
      await acknowledged
    }
    await gitBackup.flushForQuit(deadlineAt)
  })().finally(() => {
    quitFlushComplete = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

ipcMain.handle('buffer:list', () => library.list())
ipcMain.handle('buffer:load', (_event, relativePath) => library.load(relativePath))
ipcMain.handle('buffer:save', (_event, relativePath, content) => library.save(relativePath, content))
ipcMain.on('buffer:saveSync', (event, relativePath, content) => {
  try {
    event.returnValue = { ok: library.saveSync(relativePath, content) }
  } catch (error) {
    event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('buffer:snapshot', (_event, relativePath, content, reason) => library.snapshot(relativePath, content, reason))
ipcMain.on('buffer:snapshotSync', (event, relativePath, content, reason) => {
  try {
    event.returnValue = { ok: library.snapshotSync(relativePath, content, reason) }
  } catch (error) {
    event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('buffer:create', (_event, name) => library.create(name))
ipcMain.handle('buffer:delete', (_event, relativePath) => library.delete(relativePath))
ipcMain.handle('buffer:archiveStream', (_event, name) => library.archiveStream(name))
ipcMain.handle('buffer:openExternal', () => library.openExternalWithDialog())
ipcMain.handle('buffer:createExternal', () => library.createExternalWithDialog())
ipcMain.handle('buffer:listRecoveries', () => library.listRecoveries())
ipcMain.handle('buffer:readRecovery', (_event, relativePath) => library.readRecovery(relativePath))
ipcMain.handle('buffer:consumePendingOpen', () => {
  const buffer = pendingOpenBuffer
  pendingOpenBuffer = null
  return buffer
})
ipcMain.handle('library:search', (_event, query) => startSearch(query))
ipcMain.handle('image:save', (_event, payload) => library.saveImage(payload))
ipcMain.handle('image:resolveLegacyUrl', (_event, url) => library.resolveLegacyImageUrl(url))
ipcMain.handle('shell:openExternal', async (_event, url) => {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS links can be opened')
  }
  await shell.openExternal(parsed.toString())
  return true
})
ipcMain.handle('settings:get', () => nativeTheme.themeSource)
ipcMain.handle('settings:setTheme', (_event, theme) => {
  nativeTheme.themeSource = theme
  return true
})
ipcMain.handle('git-backup:getSettings', () => gitBackup.getSettings())
ipcMain.handle('git-backup:getStatus', () => gitBackup.getStatus())
ipcMain.handle('git-backup:chooseRepository', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose Git backup repository',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return gitBackup.getSettings()
  return gitBackup.configureRepository(result.filePaths[0])
})
ipcMain.handle('git-backup:setEnabled', (_event, enabled) => gitBackup.setEnabled(Boolean(enabled)))
ipcMain.on('app:flush-before-quit-complete', (_event, requestId) => {
  quitFlushAcks.get(String(requestId))?.()
})
ipcMain.handle('ai:getSettings', () => aiSettings.readSettings())
ipcMain.handle('ai:saveSettings', (_event, settings) => aiSettings.saveSettings(settings))
ipcMain.handle('ai:setApiKey', (_event, apiKey) => aiSettings.setApiKey(apiKey))
ipcMain.handle('ai:clearApiKey', () => aiSettings.clearApiKey())
ipcMain.handle('ai:testConnection', () => aiSettings.testConnection())
ipcMain.handle('ai:complete', (_event, payload) => aiSettings.complete(payload))
