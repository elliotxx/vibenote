import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  CLI_CONTRACT,
  blockIdForRequest,
  idempotencyHashes,
  sha256,
} from './noteContract.js'
import { noteError } from './noteErrors.js'
import {
  appendBlockToNote,
  contentRevision,
  parseNote,
  storageRevision,
} from './noteFormat.js'
import { notePaths } from './notePaths.js'
import { fixedStringMatches, snippetAround } from './noteSearch.js'

const STREAM_FILE = 'stream.txt'

function safeFileName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '_')
}

async function writeAtomic(filePath, content) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.promises.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 })
    await fs.promises.rename(temporary, filePath)
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function writeAtomicSync(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, filePath)
  } catch (error) {
    fs.rmSync(temporary, { force: true })
    throw error
  }
}

function boundedLimit(value) {
  const parsed = Number(value ?? CLI_CONTRACT.limits.list.default)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > CLI_CONTRACT.limits.list.max) {
    throw noteError('INVALID_ARGUMENT', 'Limit is outside the supported range')
  }
  return parsed
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeCursor(value) {
  if (!value) return null
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw noteError('INVALID_ARGUMENT', 'Cursor is invalid')
  }
}

export class NoteStore {
  constructor({ userDataPath, now = () => new Date(), ownerId = () => crypto.randomUUID(), appVersion = 'unknown' }) {
    if (!userDataPath) throw new Error('userDataPath is required')
    this.paths = notePaths(userDataPath)
    this.now = now
    this.ownerId = ownerId
    this.appVersion = appVersion
  }

  capabilities() {
    return {
      schemaVersion: CLI_CONTRACT.schemaVersion,
      formatVersion: CLI_CONTRACT.formatVersion,
      commands: CLI_CONTRACT.commands,
      limits: CLI_CONTRACT.limits,
      scopes: ['internal:read', 'internal:append'],
      mutations: { append: { dryRun: true, revisionCheck: true, idempotency: true, snapshot: true } },
    }
  }

  async doctor() {
    return {
      supported: process.platform === 'darwin' && process.arch === 'arm64',
      notesReadable: await fs.promises.access(this.paths.notes, fs.constants.R_OK).then(() => true, () => false),
      notesWritable: await fs.promises.access(this.paths.notes, fs.constants.W_OK).then(() => true, () => false),
      pathSource: 'explicit',
    }
  }

  async noteRecords() {
    const entries = await fs.promises.readdir(this.paths.notes, { withFileTypes: true })
    const records = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.txt')) continue
      const raw = await fs.promises.readFile(path.join(this.paths.notes, entry.name), 'utf8')
      const parsed = parseNote(raw)
      const metadataId = typeof parsed.metadata.id === 'string' ? parsed.metadata.id : null
      records.push({
        id: entry.name === STREAM_FILE ? 'internal:stream' : metadataId ? `internal:${metadataId}` : `legacy:${Buffer.from(entry.name).toString('base64url')}`,
        stable: entry.name === STREAM_FILE || Boolean(metadataId),
        fileName: entry.name,
        raw,
        parsed,
      })
    }
    return records.sort((left, right) => left.fileName === STREAM_FILE ? -1 : right.fileName === STREAM_FILE ? 1 : left.fileName.localeCompare(right.fileName))
  }

  async recordFor(noteId) {
    const record = (await this.noteRecords()).find(item => item.id === noteId)
    if (!record) throw noteError('NOTE_NOT_FOUND', 'The note was not found')
    return record
  }

  async recordForIdentifier(identifier) {
    const fileName = String(identifier || STREAM_FILE)
    if (path.basename(fileName) !== fileName || !fileName.endsWith('.txt')) {
      throw noteError('SCOPE_DENIED', 'Only internal note identifiers are allowed')
    }
    const filePath = path.join(this.paths.notes, fileName)
    let raw
    try {
      raw = await fs.promises.readFile(filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') throw noteError('NOTE_NOT_FOUND', 'The note was not found')
      throw error
    }
    const parsed = parseNote(raw)
    const metadataId = typeof parsed.metadata.id === 'string' ? parsed.metadata.id : null
    return {
      id: fileName === STREAM_FILE ? 'internal:stream' : metadataId ? `internal:${metadataId}` : `legacy:${Buffer.from(fileName).toString('base64url')}`,
      stable: fileName === STREAM_FILE || Boolean(metadataId),
      fileName,
      raw,
      parsed,
    }
  }

  recordForIdentifierSync(identifier) {
    const fileName = String(identifier || STREAM_FILE)
    if (path.basename(fileName) !== fileName || !fileName.endsWith('.txt')) {
      throw noteError('SCOPE_DENIED', 'Only internal note identifiers are allowed')
    }
    const filePath = path.join(this.paths.notes, fileName)
    let raw
    try {
      raw = fs.readFileSync(filePath, 'utf8')
    } catch (error) {
      if (error?.code === 'ENOENT') throw noteError('NOTE_NOT_FOUND', 'The note was not found')
      throw error
    }
    const parsed = parseNote(raw)
    const metadataId = typeof parsed.metadata.id === 'string' ? parsed.metadata.id : null
    return {
      id: fileName === STREAM_FILE ? 'internal:stream' : metadataId ? `internal:${metadataId}` : `legacy:${Buffer.from(fileName).toString('base64url')}`,
      stable: fileName === STREAM_FILE || Boolean(metadataId),
      fileName,
      raw,
      parsed,
    }
  }

  async readStorage({ identifier }) {
    const record = await this.recordForIdentifier(identifier)
    return {
      content: record.raw,
      noteId: record.id,
      revision: contentRevision(record.parsed),
      storageRevision: storageRevision(record.raw),
    }
  }

  async listNotes({ limit, cursor } = {}) {
    const records = await this.noteRecords()
    const start = decodeCursor(cursor)?.index || 0
    const pageSize = boundedLimit(limit)
    const items = records.slice(start, start + pageSize).map(record => ({
      id: record.id,
      stable: record.stable,
      name: record.parsed.metadata.name || record.fileName.replace(/\.txt$/, ''),
      tags: Array.isArray(record.parsed.metadata.tags) ? record.parsed.metadata.tags : [],
      revision: contentRevision(record.parsed),
      blockCount: record.parsed.blocks.length,
    }))
    return { items, nextCursor: start + pageSize < records.length ? encodeCursor({ index: start + pageSize }) : null }
  }

  async readNote({ noteId, raw = false } = {}) {
    const record = await this.recordFor(noteId)
    if (raw && Buffer.byteLength(record.raw, 'utf8') > CLI_CONTRACT.limits.noteRawBytes) {
      throw noteError('CONTENT_TOO_LARGE', 'The note is too large for raw output')
    }
    return {
      noteId: record.id,
      stable: record.stable,
      metadata: record.parsed.metadata,
      revision: contentRevision(record.parsed),
      storageRevision: storageRevision(record.raw),
      blockCount: record.parsed.blocks.length,
      ...(raw ? { raw: record.raw } : {}),
    }
  }

  async listBlocks({ noteId, limit, cursor } = {}) {
    const record = await this.recordFor(noteId)
    const revision = contentRevision(record.parsed)
    const decoded = decodeCursor(cursor)
    if (decoded && decoded.revision !== revision) throw noteError('CURSOR_STALE', 'The note changed after the cursor was issued')
    const start = decoded?.index || 0
    const pageSize = boundedLimit(limit)
    const blocks = record.parsed.blocks.slice(start, start + pageSize)
    const items = blocks.map(block => ({
      id: block.id,
      stable: block.stable,
      legacyIndex: block.legacyIndex,
      language: block.language,
      created: block.fields.created || null,
      bytes: Buffer.byteLength(block.content, 'utf8'),
    }))
    return {
      noteId,
      revision,
      items,
      nextCursor: start + pageSize < record.parsed.blocks.length ? encodeCursor({ revision, index: start + pageSize }) : null,
    }
  }

  async readBlock({ noteId, blockId, legacyIndex, offset = 0, maxBytes = CLI_CONTRACT.limits.blockRead.defaultBytes } = {}) {
    const record = await this.recordFor(noteId)
    const block = blockId
      ? record.parsed.blocks.find(item => item.id === blockId)
      : record.parsed.blocks[Number(legacyIndex)]
    if (!block) throw noteError('BLOCK_NOT_FOUND', 'The block was not found')
    const limit = Math.min(Number(maxBytes), CLI_CONTRACT.limits.blockRead.maxBytes)
    if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(Number(offset)) || Number(offset) < 0) {
      throw noteError('INVALID_ARGUMENT', 'Block range is invalid')
    }
    const bytes = Buffer.from(block.content, 'utf8')
    const chunk = bytes.subarray(Number(offset), Number(offset) + limit)
    return {
      noteId,
      blockId: block.id,
      legacyIndex: block.legacyIndex,
      stable: block.stable,
      content: chunk.toString('utf8'),
      truncated: Number(offset) + chunk.length < bytes.length,
      nextOffset: Number(offset) + chunk.length < bytes.length ? Number(offset) + chunk.length : null,
      revision: contentRevision(record.parsed),
    }
  }

  async search({ query, limit } = {}) {
    if (typeof query !== 'string' || !query) throw noteError('INVALID_ARGUMENT', 'Query is required')
    const pageSize = boundedLimit(limit)
    const items = []
    for (const record of await this.noteRecords()) {
      const revision = contentRevision(record.parsed)
      for (const block of record.parsed.blocks) {
        for (const index of fixedStringMatches(block.content, query)) {
          items.push({
            noteId: record.id,
            blockId: block.id,
            legacyIndex: block.legacyIndex,
            stable: block.stable,
            snippet: snippetAround(block.content, index, query.length, CLI_CONTRACT.limits.snippetCharacters),
            matchOffset: index,
            revision,
          })
          if (items.length >= pageSize) return { items, truncated: true }
        }
      }
    }
    return { items, truncated: false }
  }

  async acquireLock(noteId) {
    await fs.promises.mkdir(this.paths.locks, { recursive: true })
    const lockPath = path.join(this.paths.locks, `${safeFileName(noteId)}.lock`)
    try {
      await fs.promises.mkdir(lockPath)
      await fs.promises.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({ ownerId: this.ownerId(), pid: process.pid, createdAt: this.now().toISOString() }))
      return async () => {
        await fs.promises.rm(lockPath, { recursive: true, force: true })
        await fs.promises.rmdir(this.paths.locks).catch(() => {})
        await fs.promises.rmdir(this.paths.runtime).catch(() => {})
      }
    } catch (error) {
      if (error?.code === 'EEXIST') throw noteError('NOTE_BUSY', 'The note is busy', { retryable: true })
      throw error
    }
  }

  acquireLockSync(noteId) {
    fs.mkdirSync(this.paths.locks, { recursive: true })
    const lockPath = path.join(this.paths.locks, `${safeFileName(noteId)}.lock`)
    try {
      fs.mkdirSync(lockPath)
      fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({ ownerId: this.ownerId(), pid: process.pid, createdAt: this.now().toISOString() }))
      return () => {
        fs.rmSync(lockPath, { recursive: true, force: true })
        try { fs.rmdirSync(this.paths.locks) } catch {}
        try { fs.rmdirSync(this.paths.runtime) } catch {}
      }
    } catch (error) {
      if (error?.code === 'EEXIST') throw noteError('NOTE_BUSY', 'The note is busy', { retryable: true })
      throw error
    }
  }

  async appendBlock(request) {
    const contentBytes = Buffer.byteLength(request.content || '', 'utf8')
    if (contentBytes > CLI_CONTRACT.limits.appendBytes) throw noteError('CONTENT_TOO_LARGE', 'Content exceeds the append limit')
    if (!request.idempotencyKey) throw noteError('INVALID_ARGUMENT', 'Idempotency key is required')
    const record = await this.recordFor(request.noteId)
    if (!record.stable) throw noteError('SCOPE_DENIED', 'Legacy notes are read-only for CLI mutations')
    const hashes = idempotencyHashes({
      noteId: request.noteId,
      key: request.idempotencyKey,
      language: request.language,
      content: request.content,
      options: { auto: Boolean(request.auto) },
    })
    const blockId = blockIdForRequest(request.noteId, hashes.keyHash)
    const release = await this.acquireLock(request.noteId)
    try {
      const current = await this.recordFor(request.noteId)
      const revision = contentRevision(current.parsed)
      const matches = current.parsed.blocks.filter(block => block.fields.request === `sha256:${hashes.keyHash}`)
      if (matches.length > 1) throw noteError('IDEMPOTENCY_CORRUPT', 'The idempotency record is ambiguous')
      if (matches.length === 1) {
        if (matches[0].fields.payload !== `sha256:${hashes.payloadHash}`) {
          throw noteError('IDEMPOTENCY_MISMATCH', 'The idempotency key was used for a different request')
        }
        return { dryRun: false, noteId: request.noteId, blockId: matches[0].id, revision, replayed: true }
      }
      if (!request.dryRun && !request.acceptCurrent && request.expectedRevision !== revision) {
        throw noteError('REVISION_CONFLICT', 'The note changed after it was read', { retryable: true })
      }
      const created = this.now().toISOString()
      const candidate = appendBlockToNote(current.raw, {
        language: request.language,
        id: blockId,
        auto: Boolean(request.auto),
        created,
        content: request.content,
        requestHash: hashes.keyHash,
        payloadHash: hashes.payloadHash,
      })
      const parsedCandidate = parseNote(candidate)
      const result = {
        dryRun: Boolean(request.dryRun),
        noteId: request.noteId,
        blockId,
        previousRevision: revision,
        revision: contentRevision(parsedCandidate),
        expectedRevision: revision,
        replayed: false,
      }
      if (request.dryRun) return result
      const snapshotId = await this.writeSnapshot(current, revision)
      const recoveryId = await this.writeRecovery(current, candidate, revision)
      await writeAtomic(path.join(this.paths.notes, current.fileName), candidate)
      return { ...result, snapshotId, recoveryId }
    } finally {
      await release()
    }
  }

  async saveNote({ identifier, content, expectedStorageRevision, acceptCurrent = false }) {
    if (typeof content !== 'string') throw noteError('INVALID_ARGUMENT', 'Content must be text')
    parseNote(content)
    const initial = await this.recordForIdentifier(identifier)
    const release = await this.acquireLock(initial.id)
    try {
      const current = await this.recordForIdentifier(identifier)
      const currentStorageRevision = storageRevision(current.raw)
      if (!acceptCurrent && expectedStorageRevision !== currentStorageRevision) {
        const recoveryId = await this.writeRecovery(current, content, contentRevision(current.parsed), 'conflict')
        const error = noteError('STORAGE_REVISION_CONFLICT', 'The note changed after it was loaded', { retryable: true })
        error.recoveryId = recoveryId
        throw error
      }
      if (current.raw === content) {
        return { noteId: current.id, revision: contentRevision(current.parsed), storageRevision: currentStorageRevision, unchanged: true }
      }
      const recoveryId = await this.writeRecovery(current, content, contentRevision(current.parsed))
      const snapshotId = await this.writeSnapshot(current, contentRevision(current.parsed), 'autosave')
      await writeAtomic(path.join(this.paths.notes, current.fileName), content)
      const parsed = parseNote(content)
      return { noteId: current.id, revision: contentRevision(parsed), storageRevision: storageRevision(content), snapshotId, recoveryId, unchanged: false }
    } finally {
      await release()
    }
  }

  saveNoteSync({ identifier, content, expectedStorageRevision, acceptCurrent = false }) {
    if (typeof content !== 'string') throw noteError('INVALID_ARGUMENT', 'Content must be text')
    parseNote(content)
    const initial = this.recordForIdentifierSync(identifier)
    const release = this.acquireLockSync(initial.id)
    try {
      const current = this.recordForIdentifierSync(identifier)
      const currentStorageRevision = storageRevision(current.raw)
      if (!acceptCurrent && expectedStorageRevision !== currentStorageRevision) {
        const recoveryId = this.writeRecoverySync(current, content, contentRevision(current.parsed), 'conflict')
        const error = noteError('STORAGE_REVISION_CONFLICT', 'The note changed after it was loaded', { retryable: true })
        error.recoveryId = recoveryId
        throw error
      }
      if (current.raw === content) {
        return { noteId: current.id, revision: contentRevision(current.parsed), storageRevision: currentStorageRevision, unchanged: true }
      }
      const recoveryId = this.writeRecoverySync(current, content, contentRevision(current.parsed))
      const snapshotId = this.writeSnapshotSync(current, contentRevision(current.parsed), 'autosave')
      writeAtomicSync(path.join(this.paths.notes, current.fileName), content)
      const parsed = parseNote(content)
      return { noteId: current.id, revision: contentRevision(parsed), storageRevision: storageRevision(content), snapshotId, recoveryId, unchanged: false }
    } finally {
      release()
    }
  }

  async writeSnapshot(record, revision, reason = 'agent-append') {
    const snapshotId = `${this.now().toISOString().replace(/[^0-9]/g, '')}-${sha256(`${revision}:${this.ownerId()}`).slice(0, 12)}`
    const directory = path.join(this.paths.snapshots, safeFileName(record.id))
    const fileName = `${snapshotId}.vibenote`
    await writeAtomic(path.join(directory, fileName), record.raw)
    const manifestPath = path.join(directory, 'manifest.json')
    let manifest = { documentId: record.id, identifier: record.fileName, kind: 'internal', snapshots: [] }
    try { manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) } catch {}
    manifest.documentId = record.id
    manifest.identifier = record.fileName
    manifest.kind = 'internal'
    manifest.updatedAt = this.now().toISOString()
    manifest.snapshots = Array.isArray(manifest.snapshots) ? manifest.snapshots : []
    manifest.snapshots.push({
      snapshotId,
      fileName,
      reason,
      highRisk: false,
      createdAt: this.now().toISOString(),
      sourceIdentifier: record.fileName,
      sourceKind: 'internal',
      sourceSize: Buffer.byteLength(record.raw, 'utf8'),
      revision,
      contentHash: sha256(record.raw),
      appVersion: this.appVersion,
      images: [],
    })
    while (manifest.snapshots.length > CLI_CONTRACT.limits.snapshotMax) {
      const removed = manifest.snapshots.shift()
      if (removed?.fileName) await fs.promises.rm(path.join(directory, removed.fileName), { force: true })
    }
    await writeAtomic(manifestPath, JSON.stringify(manifest, null, 2))
    return snapshotId
  }

  async writeRecovery(record, candidate, previousRevision, type = 'candidate') {
    const recoveryId = safeFileName(record.id)
    await writeAtomic(path.join(this.paths.recovery, `${recoveryId}.vibenote`), candidate)
    await writeAtomic(path.join(this.paths.recovery, `${recoveryId}.json`), JSON.stringify({
      recoveryId,
      noteId: record.id,
      identifier: record.fileName,
      kind: 'internal',
      type,
      previousRevision,
      contentHash: sha256(candidate),
      candidateStorageRevision: storageRevision(candidate),
      updatedAt: this.now().toISOString(),
    }, null, 2))
    return recoveryId
  }

  writeSnapshotSync(record, revision, reason = 'agent-append') {
    const snapshotId = `${this.now().toISOString().replace(/[^0-9]/g, '')}-${sha256(`${revision}:${this.ownerId()}`).slice(0, 12)}`
    const directory = path.join(this.paths.snapshots, safeFileName(record.id))
    const fileName = `${snapshotId}.vibenote`
    writeAtomicSync(path.join(directory, fileName), record.raw)
    const manifestPath = path.join(directory, 'manifest.json')
    let manifest = { documentId: record.id, identifier: record.fileName, kind: 'internal', snapshots: [] }
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {}
    manifest.documentId = record.id
    manifest.identifier = record.fileName
    manifest.kind = 'internal'
    manifest.updatedAt = this.now().toISOString()
    manifest.snapshots = Array.isArray(manifest.snapshots) ? manifest.snapshots : []
    manifest.snapshots.push({
      snapshotId,
      fileName,
      reason,
      highRisk: false,
      createdAt: this.now().toISOString(),
      sourceIdentifier: record.fileName,
      sourceKind: 'internal',
      sourceSize: Buffer.byteLength(record.raw, 'utf8'),
      revision,
      contentHash: sha256(record.raw),
      appVersion: this.appVersion,
      images: [],
    })
    while (manifest.snapshots.length > CLI_CONTRACT.limits.snapshotMax) {
      const removed = manifest.snapshots.shift()
      if (removed?.fileName) fs.rmSync(path.join(directory, removed.fileName), { force: true })
    }
    writeAtomicSync(manifestPath, JSON.stringify(manifest, null, 2))
    return snapshotId
  }

  writeRecoverySync(record, candidate, previousRevision, type = 'candidate') {
    const recoveryId = safeFileName(record.id)
    writeAtomicSync(path.join(this.paths.recovery, `${recoveryId}.vibenote`), candidate)
    writeAtomicSync(path.join(this.paths.recovery, `${recoveryId}.json`), JSON.stringify({
      recoveryId,
      noteId: record.id,
      identifier: record.fileName,
      kind: 'internal',
      type,
      previousRevision,
      contentHash: sha256(candidate),
      candidateStorageRevision: storageRevision(candidate),
      updatedAt: this.now().toISOString(),
    }, null, 2))
    return recoveryId
  }
}
