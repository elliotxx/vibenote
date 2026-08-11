import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const GIT_BACKUP_FORMAT_VERSION = 1
export const GIT_BACKUP_DIRECTORY = 'vibenote-backup'
export const GIT_BACKUP_OWNERSHIP_FILE = '.vibenote-backup.json'

export class GitBackupExportError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GitBackupExportError'
    this.code = code
  }
}

export function gitBackupSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function exists(filePath) {
  try {
    await fs.promises.access(filePath)
    return true
  } catch {
    return false
  }
}

async function readJson(filePath) {
  return JSON.parse(await fs.promises.readFile(filePath, 'utf8'))
}

async function writeJson(filePath, value) {
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeJson(temporaryPath, value)
  await fs.promises.rename(temporaryPath, filePath)
}

function portablePath(filePath) {
  return filePath.split(path.sep).join('/')
}

function isWithin(candidate, root) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

async function realPathOrResolved(filePath) {
  try {
    return await fs.promises.realpath(filePath)
  } catch {
    return path.resolve(filePath)
  }
}

async function listInternalNotes(notesPath) {
  const notes = []
  async function visit(directory) {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name)
      if (entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.endsWith('.assets')) {
        await visit(fullPath)
      } else if (entry.isFile() && entry.name.endsWith('.txt')) {
        notes.push(fullPath)
      }
    }
  }
  await visit(notesPath)
  return notes.sort((left, right) => left.localeCompare(right))
}

function imageReferences(content) {
  const pattern = /!\[[^\]]*]\((<([^>]+)>|([^\s)]+))(?:\s+(["'][^"']*["']))?\)/g
  return Array.from(content.matchAll(pattern)).map(match => ({
    whole: match[0],
    destination: match[1],
    target: (match[2] || match[3] || '').trim(),
    title: match[4] || '',
    index: match.index ?? 0,
  }))
}

function localFilePath(target) {
  if (/^https?:\/\//i.test(target)) return null
  if (target.startsWith('file://')) {
    try {
      return fileURLToPath(target)
    } catch {
      return target
    }
  }
  return path.isAbsolute(target) ? target : null
}

function safeAssetName(filePath) {
  const cleaned = path.basename(filePath)
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned.slice(-96) || 'asset'
}

async function hashFile(filePath) {
  return gitBackupSha256(await fs.promises.readFile(filePath))
}

export async function inspectGitBackupSource({ notesPath, userImagesPath }) {
  const notesRoot = await realPathOrResolved(notesPath)
  const imagesRoot = await realPathOrResolved(userImagesPath)
  const documents = []
  const assets = new Map()

  for (const sourcePath of await listInternalNotes(notesPath)) {
    const actualSourcePath = await fs.promises.realpath(sourcePath)
    const relativePath = portablePath(path.relative(notesPath, sourcePath))
    const content = await fs.promises.readFile(sourcePath, 'utf8')
    const sourceSha256 = gitBackupSha256(content)
    const documentKey = gitBackupSha256(relativePath).slice(0, 16)
    const documentReferences = []

    for (const reference of imageReferences(content)) {
      const requestedPath = localFilePath(reference.target)
      if (!requestedPath) continue

      let actualPath
      try {
        actualPath = await fs.promises.realpath(requestedPath)
      } catch {
        throw new GitBackupExportError('export-incomplete', 'A referenced local image is missing or unreadable')
      }

      const besideRoot = await realPathOrResolved(path.join(path.dirname(sourcePath), `${path.parse(sourcePath).name}.assets`))
      if (!isWithin(actualPath, besideRoot) && !isWithin(actualPath, imagesRoot)) {
        throw new GitBackupExportError('export-incomplete', 'A note references an image outside Vibenote-managed storage')
      }
      if (!isWithin(actualSourcePath, notesRoot)) {
        throw new GitBackupExportError('export-incomplete', 'A note path escapes the internal note library')
      }

      const stat = await fs.promises.stat(actualPath)
      if (!stat.isFile()) throw new GitBackupExportError('export-incomplete', 'A referenced image is not a regular file')
      const assetSha256 = await hashFile(actualPath)
      const exportPath = `assets/${documentKey}/${assetSha256.slice(0, 12)}-${safeAssetName(actualPath)}`
      const assetKey = `${documentKey}:${actualPath}`
      if (!assets.has(assetKey)) {
        assets.set(assetKey, {
          documentKey,
          sourcePath: actualPath,
          exportPath,
          size: stat.size,
          sha256: assetSha256,
        })
      }
      documentReferences.push({ requestedPath: path.resolve(requestedPath), sourcePath: actualPath, exportPath })
    }

    documents.push({
      relativePath,
      sourcePath: actualSourcePath,
      sourceSha256,
      documentKey,
      content,
      references: documentReferences,
    })
  }

  const assetList = Array.from(assets.values()).sort((left, right) => left.exportPath.localeCompare(right.exportPath))
  const sourceFingerprint = gitBackupSha256(JSON.stringify({
    documents: documents.map(({ relativePath, sourceSha256 }) => ({ relativePath, sourceSha256 })),
    assets: assetList.map(({ exportPath, size, sha256 }) => ({ exportPath, size, sha256 })),
  }))
  return { documents, assets: assetList, sourceFingerprint }
}

function rewriteDocument(document) {
  const assetsBySource = new Map(document.references.map(reference => [reference.requestedPath, reference]))
  let rewritten = ''
  let offset = 0
  for (const reference of imageReferences(document.content)) {
    const requestedPath = localFilePath(reference.target)
    if (!requestedPath) continue
    const asset = assetsBySource.get(path.resolve(requestedPath))
    if (!asset) continue
    const noteExportPath = `notes/${document.relativePath}`
    const relativeAssetPath = path.posix.relative(path.posix.dirname(noteExportPath), asset.exportPath)
    const destination = /[ <>]/.test(relativeAssetPath) ? `<${relativeAssetPath}>` : relativeAssetPath
    const replacement = reference.whole.replace(reference.destination, destination)
    rewritten += document.content.slice(offset, reference.index) + replacement
    offset = reference.index + reference.whole.length
  }
  return rewritten + document.content.slice(offset)
}

async function verifySnapshotDirectory(snapshotPath, manifest) {
  for (const document of manifest.documents || []) {
    const filePath = path.join(snapshotPath, document.exportPath)
    if (!await exists(filePath) || await hashFile(filePath) !== document.exportSha256) return false
  }
  for (const asset of manifest.assets || []) {
    const filePath = path.join(snapshotPath, asset.exportPath)
    if (!await exists(filePath) || await hashFile(filePath) !== asset.sha256) return false
  }
  return true
}

export async function readGitBackupManifest(repositoryPath) {
  try {
    return await readJson(path.join(repositoryPath, GIT_BACKUP_DIRECTORY, 'manifest.json'))
  } catch {
    return null
  }
}

export async function verifyGitBackupSnapshot(repositoryPath) {
  try {
    const marker = await readJson(path.join(repositoryPath, GIT_BACKUP_OWNERSHIP_FILE))
    if (marker.formatVersion !== GIT_BACKUP_FORMAT_VERSION || marker.managedDirectory !== GIT_BACKUP_DIRECTORY) return false
    const manifestPath = path.join(repositoryPath, GIT_BACKUP_DIRECTORY, 'manifest.json')
    const manifestBuffer = await fs.promises.readFile(manifestPath)
    if (marker.manifestSha256 !== gitBackupSha256(manifestBuffer)) return false
    const manifest = JSON.parse(manifestBuffer.toString('utf8'))
    return verifySnapshotDirectory(path.join(repositoryPath, GIT_BACKUP_DIRECTORY), manifest)
  } catch {
    return false
  }
}

export async function recoverGitBackupArtifacts(repositoryPath) {
  const entries = await fs.promises.readdir(repositoryPath, { withFileTypes: true })
  const temporary = entries.filter(entry => entry.isDirectory() && /^\.vibenote-backup\.(?:staging|rollback)-/.test(entry.name))
  if (temporary.length === 0) return
  if (await verifyGitBackupSnapshot(repositoryPath)) {
    await Promise.all(temporary.map(entry => fs.promises.rm(path.join(repositoryPath, entry.name), { recursive: true, force: true })))
    return
  }

  const rollbacks = temporary.filter(entry => entry.name.startsWith('.vibenote-backup.rollback-')).sort((a, b) => b.name.localeCompare(a.name))
  for (const rollback of rollbacks) {
    const rollbackPath = path.join(repositoryPath, rollback.name)
    try {
      const manifestBuffer = await fs.promises.readFile(path.join(rollbackPath, 'manifest.json'))
      const manifest = JSON.parse(manifestBuffer.toString('utf8'))
      if (!await verifySnapshotDirectory(rollbackPath, manifest)) continue
      await fs.promises.rm(path.join(repositoryPath, GIT_BACKUP_DIRECTORY), { recursive: true, force: true })
      await fs.promises.rename(rollbackPath, path.join(repositoryPath, GIT_BACKUP_DIRECTORY))
      await writeJsonAtomic(path.join(repositoryPath, GIT_BACKUP_OWNERSHIP_FILE), {
        formatVersion: GIT_BACKUP_FORMAT_VERSION,
        managedDirectory: GIT_BACKUP_DIRECTORY,
        manifestSha256: gitBackupSha256(manifestBuffer),
      })
      await Promise.all(temporary.filter(entry => entry.name !== rollback.name).map(entry => fs.promises.rm(path.join(repositoryPath, entry.name), { recursive: true, force: true })))
      return
    } catch {
      // Unverified artifacts are retained for diagnosis.
    }
  }
  throw new GitBackupExportError('mirror-conflict', 'Interrupted backup artifacts could not be safely recovered')
}

export async function exportGitBackup({ notesPath, userImagesPath, repositoryPath, appVersion, now = new Date(), faultAt = null }) {
  await recoverGitBackupArtifacts(repositoryPath)
  const snapshotPath = path.join(repositoryPath, GIT_BACKUP_DIRECTORY)
  const markerPath = path.join(repositoryPath, GIT_BACKUP_OWNERSHIP_FILE)
  const snapshotExists = await exists(snapshotPath)
  const markerExists = await exists(markerPath)
  if (snapshotExists !== markerExists) {
    throw new GitBackupExportError('mirror-conflict', 'The backup directory ownership marker is missing or unexpected')
  }
  if (snapshotExists && !await verifyGitBackupSnapshot(repositoryPath)) {
    throw new GitBackupExportError('mirror-conflict', 'The published backup was modified outside Vibenote')
  }

  const source = await inspectGitBackupSource({ notesPath, userImagesPath })
  const identifier = `${process.pid}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`
  const stagingPath = path.join(repositoryPath, `.vibenote-backup.staging-${identifier}`)
  const rollbackPath = path.join(repositoryPath, `.vibenote-backup.rollback-${identifier}`)
  const previousMarker = markerExists ? await fs.promises.readFile(markerPath) : null
  let oldSnapshotMoved = false
  let newSnapshotPublished = false

  try {
    await fs.promises.mkdir(path.join(stagingPath, 'notes'), { recursive: true })
    await fs.promises.mkdir(path.join(stagingPath, 'assets'), { recursive: true })
    const manifestDocuments = []
    for (const document of source.documents) {
      const exportedContent = rewriteDocument(document)
      const exportPath = `notes/${document.relativePath}`
      const outputPath = path.join(stagingPath, exportPath)
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.promises.writeFile(outputPath, exportedContent, { mode: 0o600 })
      manifestDocuments.push({
        relativePath: document.relativePath,
        exportPath,
        sourceSha256: document.sourceSha256,
        exportSha256: gitBackupSha256(exportedContent),
        imageReferences: document.references.map(reference => ({ exportPath: reference.exportPath })),
      })
    }
    for (const asset of source.assets) {
      const outputPath = path.join(stagingPath, asset.exportPath)
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
      await fs.promises.copyFile(asset.sourcePath, outputPath)
      if (await hashFile(outputPath) !== asset.sha256) {
        throw new GitBackupExportError('export-incomplete', 'A copied image failed hash verification')
      }
    }
    const manifest = {
      formatVersion: GIT_BACKUP_FORMAT_VERSION,
      generatedAt: now.toISOString(),
      appVersion,
      sourceFingerprint: source.sourceFingerprint,
      documents: manifestDocuments,
      assets: source.assets.map(({ exportPath, size, sha256 }) => ({ exportPath, size, sha256 })),
    }
    await writeJson(path.join(stagingPath, 'manifest.json'), manifest)
    if (!await verifySnapshotDirectory(stagingPath, manifest)) {
      throw new GitBackupExportError('export-incomplete', 'The staged backup failed verification')
    }
    if (faultAt === 'staging') throw new Error('Injected staging failure')

    if (snapshotExists) {
      await fs.promises.rename(snapshotPath, rollbackPath)
      oldSnapshotMoved = true
    }
    if (faultAt === 'switch') throw new Error('Injected switch failure')
    await fs.promises.rename(stagingPath, snapshotPath)
    newSnapshotPublished = true
    const manifestBuffer = await fs.promises.readFile(path.join(snapshotPath, 'manifest.json'))
    await writeJsonAtomic(markerPath, {
      formatVersion: GIT_BACKUP_FORMAT_VERSION,
      managedDirectory: GIT_BACKUP_DIRECTORY,
      manifestSha256: gitBackupSha256(manifestBuffer),
    })
    if (faultAt === 'marker') throw new Error('Injected marker failure')
    if (!await verifyGitBackupSnapshot(repositoryPath)) {
      throw new GitBackupExportError('export-incomplete', 'The published backup failed verification')
    }
    if (oldSnapshotMoved) await fs.promises.rm(rollbackPath, { recursive: true, force: true })
    return manifest
  } catch (error) {
    if (newSnapshotPublished) await fs.promises.rm(snapshotPath, { recursive: true, force: true }).catch(() => {})
    if (oldSnapshotMoved && await exists(rollbackPath)) await fs.promises.rename(rollbackPath, snapshotPath)
    if (previousMarker) await fs.promises.writeFile(markerPath, previousMarker, { mode: 0o600 })
    else await fs.promises.rm(markerPath, { force: true }).catch(() => {})
    await fs.promises.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}
