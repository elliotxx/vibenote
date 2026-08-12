import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { parseNote } from '../../core/noteFormat.js'
import { NoteStore } from '../../core/noteStore.js'

const initial = '{"formatVersion":"1.0.0","name":"Stream","cursors":null}\n---block:markdown;auto=1;created=2026-01-01T00:00:00.000Z\nExisting synthetic content'

async function fixture(t) {
  const userDataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-note-store-'))
  const notesPath = path.join(userDataPath, 'notes')
  await fs.promises.mkdir(notesPath, { recursive: true })
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), initial)
  t.after(() => fs.promises.rm(userDataPath, { recursive: true, force: true }))
  return {
    userDataPath,
    streamPath: path.join(notesPath, 'stream.txt'),
    store: new NoteStore({
      userDataPath,
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      ownerId: () => 'synthetic-owner',
      appVersion: 'test',
    }),
  }
}

test('read operations do not create storage side effects', async t => {
  const { userDataPath, store } = await fixture(t)

  const notes = await store.listNotes({ limit: 20 })
  const blocks = await store.listBlocks({ noteId: 'internal:stream', limit: 20 })

  assert.equal(notes.items[0].id, 'internal:stream')
  assert.equal(blocks.items[0].stable, false)
  assert.deepEqual((await fs.promises.readdir(userDataPath)).sort(), ['notes'])
})

test('dry-run returns a stable proposal without writing files', async t => {
  const { userDataPath, streamPath, store } = await fixture(t)
  const before = await fs.promises.readFile(streamPath, 'utf8')

  const proposal = await store.appendBlock({
    noteId: 'internal:stream',
    language: 'markdown',
    content: 'New synthetic content',
    idempotencyKey: 'synthetic-task',
    dryRun: true,
  })

  assert.equal(proposal.dryRun, true)
  assert.match(proposal.blockId, /^[0-9a-f-]{36}$/)
  assert.equal(await fs.promises.readFile(streamPath, 'utf8'), before)
  assert.deepEqual((await fs.promises.readdir(userDataPath)).sort(), ['notes'])
})

test('append creates snapshot and recovery while preserving existing bytes', async t => {
  const { streamPath, store } = await fixture(t)
  const proposal = await store.appendBlock({
    noteId: 'internal:stream',
    language: 'markdown',
    content: 'New synthetic content',
    idempotencyKey: 'synthetic-task',
    dryRun: true,
  })

  const result = await store.appendBlock({
    noteId: 'internal:stream',
    language: 'markdown',
    content: 'New synthetic content',
    idempotencyKey: 'synthetic-task',
    expectedRevision: proposal.expectedRevision,
  })
  const written = await fs.promises.readFile(streamPath, 'utf8')
  const parsed = parseNote(written)

  assert.equal(written.slice(0, initial.length), initial)
  assert.equal(parsed.blocks.length, 2)
  assert.equal(parsed.blocks[1].id, proposal.blockId)
  assert.equal(result.blockId, proposal.blockId)
  assert.ok(result.snapshotId)
  assert.ok(result.recoveryId)
})

test('replay is idempotent and changed payload is rejected', async t => {
  const { streamPath, store } = await fixture(t)
  const proposal = await store.appendBlock({ noteId: 'internal:stream', language: 'markdown', content: 'first', idempotencyKey: 'same', dryRun: true })
  await store.appendBlock({ noteId: 'internal:stream', language: 'markdown', content: 'first', idempotencyKey: 'same', expectedRevision: proposal.expectedRevision })
  const once = await fs.promises.readFile(streamPath, 'utf8')

  const replay = await store.appendBlock({ noteId: 'internal:stream', language: 'markdown', content: 'first', idempotencyKey: 'same', expectedRevision: proposal.expectedRevision })
  assert.equal(replay.replayed, true)
  assert.equal(await fs.promises.readFile(streamPath, 'utf8'), once)

  await assert.rejects(
    store.appendBlock({ noteId: 'internal:stream', language: 'markdown', content: 'different', idempotencyKey: 'same', acceptCurrent: true }),
    error => error.code === 'IDEMPOTENCY_MISMATCH',
  )
  assert.equal(await fs.promises.readFile(streamPath, 'utf8'), once)
})

test('stale revision fails without snapshot, recovery, or target writes', async t => {
  const { userDataPath, streamPath, store } = await fixture(t)
  const before = await fs.promises.readFile(streamPath, 'utf8')

  await assert.rejects(
    store.appendBlock({ noteId: 'internal:stream', language: 'markdown', content: 'new', idempotencyKey: 'conflict', expectedRevision: 'sha256:stale' }),
    error => error.code === 'REVISION_CONFLICT',
  )

  assert.equal(await fs.promises.readFile(streamPath, 'utf8'), before)
  assert.equal(fs.existsSync(path.join(userDataPath, 'backups')), false)
  assert.equal(fs.existsSync(path.join(userDataPath, 'recovery')), false)
})

test('desktop save uses storage CAS and preserves a conflicting draft as recovery', async t => {
  const { userDataPath, streamPath, store } = await fixture(t)
  const loaded = await store.readStorage({ identifier: 'stream.txt' })
  await fs.promises.writeFile(streamPath, `${initial}\nExternal change`)

  await assert.rejects(
    store.saveNote({ identifier: 'stream.txt', content: `${initial}\nLocal draft`, expectedStorageRevision: loaded.storageRevision }),
    error => error.code === 'STORAGE_REVISION_CONFLICT' && Boolean(error.recoveryId),
  )

  assert.equal(await fs.promises.readFile(streamPath, 'utf8'), `${initial}\nExternal change`)
  assert.equal(await fs.promises.readFile(path.join(userDataPath, 'recovery', 'internal_stream.vibenote'), 'utf8'), `${initial}\nLocal draft`)
})
