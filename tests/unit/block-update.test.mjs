import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CLI_CONTRACT } from '../../core/noteContract.js'
import { parseNote } from '../../core/noteFormat.js'
import { NoteStore } from '../../core/noteStore.js'

const ids = [1, 2, 3].map(number => `11111111-1111-4111-8111-${String(number).padStart(12, '0')}`)
const initial = '{ "name": "Synthetic", "custom": true, "cursors": null }\n' + ids.map((id, index) =>
  `---block:markdown;created=2026-01-01T00:00:00.000Z;id=${id};auto=1;future=keep\nSynthetic ${index}\n`,
).join('\n')

async function fixture(t, raw = initial) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibenote-update-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'notes'))
  const file = path.join(root, 'notes', 'stream.txt')
  await fs.writeFile(file, raw)
  const store = new NoteStore({ userDataPath: root })
  const revision = (await store.readNote({ noteId: 'internal:stream' })).revision
  return { root, file, store, revision }
}

const request = (revision, options = {}) => ({
  noteId: 'internal:stream', blockId: ids[1], content: 'Updated synthetic text',
  expectedRevision: revision, idempotencyKey: 'update-one', ...options,
})

for (const blockId of ids) {
  test(`update preserves surrounding bytes and metadata for ${blockId}`, async t => {
    const { file, store, revision, root } = await fixture(t)
    const before = parseNote(initial)
    const target = before.blocks.find(block => block.id === blockId)
    const result = await store.updateBlock(request(revision, { blockId, content: '示例\n\nNew text\n' }))
    const written = await fs.readFile(file, 'utf8')
    const after = parseNote(written)
    const updated = after.blocks.find(block => block.id === blockId)
    assert.equal(after.blocks.length, 3)
    assert.deepEqual(after.metadata, before.metadata)
    assert.equal(updated.content, '示例\n\nNew text\n')
    assert.equal(written.slice(0, updated.rawRange.from), initial.slice(0, target.rawRange.from))
    assert.equal(written.slice(updated.rawRange.to), initial.slice(target.rawRange.to))
    assert.equal(updated.language, target.language)
    for (const [key, value] of Object.entries(target.fields)) assert.equal(updated.fields[key], value)
    const snapshot = path.join(root, 'backups', 'internal_stream', `${result.snapshotId}.vibenote`)
    assert.equal(await fs.readFile(snapshot, 'utf8'), initial)
    assert.equal(await fs.readFile(path.join(root, 'recovery', `${result.recoveryId}.vibenote`), 'utf8'), written)
  })
}

test('dry-run creates no files and can be applied with the returned revision', async t => {
  const { file, store, revision, root } = await fixture(t)
  const proposal = await store.updateBlock(request(undefined, { dryRun: true }))
  assert.equal(proposal.expectedRevision, revision)
  assert.equal(await fs.readFile(file, 'utf8'), initial)
  assert.deepEqual(await fs.readdir(root), ['notes'])
  const applied = await store.updateBlock(request(proposal.expectedRevision))
  assert.equal(applied.revision, proposal.revision)
  assert.equal(applied.blockId, proposal.blockId)
})

test('receipts survive subsequent updates and desktop edits without reverting content', async t => {
  const { file, store, revision } = await fixture(t)
  const first = await store.updateBlock(request(revision))
  const second = await store.updateBlock(request(first.revision, { idempotencyKey: 'update-two', content: 'Second version' }))
  const storage = await store.readStorage({ identifier: 'stream.txt' })
  await store.saveNote({ identifier: 'stream.txt', content: storage.content.replace('Second version', 'Desktop edit'), expectedStorageRevision: storage.storageRevision })
  const before = await fs.readFile(file, 'utf8')
  const replay = await store.updateBlock(request(revision))
  assert.equal(replay.replayed, true)
  assert.equal(await fs.readFile(file, 'utf8'), before)
  await assert.rejects(store.updateBlock(request(second.revision, { content: 'Different request' })), { code: 'IDEMPOTENCY_MISMATCH' })
  await assert.rejects(store.updateBlock(request(second.revision, { blockId: ids[0] })), { code: 'IDEMPOTENCY_MISMATCH' })
})

test('rejects stale updates including dry-runs without changing any note bytes', async t => {
  const { file, store, revision } = await fixture(t)
  await store.updateBlock(request(revision))
  const before = await fs.readFile(file, 'utf8')
  for (const dryRun of [false, true]) {
    await assert.rejects(store.updateBlock(request(revision, { idempotencyKey: 'stale', dryRun })), { code: 'REVISION_CONFLICT' })
  }
  assert.equal(await fs.readFile(file, 'utf8'), before)
})

test('invalid requests, ambiguous ids, and delimiter injection fail safely', async t => {
  const { file, store, revision, root } = await fixture(t)
  for (const options of [
    { content: null }, { blockId: undefined }, { legacyIndex: 1 }, { idempotencyKey: undefined },
    { expectedRevision: undefined }, { acceptCurrent: true },
    { content: 'New\n---block:markdown\nInjected' }, { content: '---block:invalid\nInjected' },
  ]) {
    await assert.rejects(store.updateBlock(request(revision, options)), { code: 'INVALID_ARGUMENT' })
  }
  await assert.rejects(store.updateBlock(request(revision, { content: 'x'.repeat(CLI_CONTRACT.limits.updateBytes + 1) })), { code: 'CONTENT_TOO_LARGE' })
  await assert.rejects(store.updateBlock(request(revision, { blockId: 'missing' })), { code: 'BLOCK_NOT_FOUND' })
  assert.equal(await fs.readFile(file, 'utf8'), initial)
  assert.deepEqual(await fs.readdir(root), ['notes'])
  await fs.writeFile(file, initial.replace(ids[0], ids[1]))
  await assert.rejects(store.updateBlock(request(revision)), { code: 'INVALID_NOTE_FORMAT' })
})

test('empty content is an update, not block deletion', async t => {
  const { store, revision } = await fixture(t)
  await store.updateBlock(request(revision, { content: '' }))
  assert.equal((await store.readBlock({ noteId: 'internal:stream', blockId: ids[1] })).content, '')
  assert.equal((await store.listBlocks({ noteId: 'internal:stream' })).items.length, 3)
})

test('corrupt update history is rejected without mutation', async t => {
  const raw = initial.replace(';future=keep', ';future=keep;updates=invalid')
  const { store, revision, file } = await fixture(t, raw)
  await assert.rejects(store.updateBlock(request(revision)), { code: 'IDEMPOTENCY_CORRUPT' })
  assert.equal(await fs.readFile(file, 'utf8'), raw)
})

test('concurrent updates only allow one writer for a revision', async t => {
  const { store, revision } = await fixture(t)
  const results = await Promise.allSettled([
    store.updateBlock(request(revision)),
    store.updateBlock(request(revision, { content: 'Concurrent text', idempotencyKey: 'concurrent' })),
  ])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected')
  assert.ok(['NOTE_BUSY', 'REVISION_CONFLICT'].includes(rejected.reason.code))
})

test('desktop stale saves cannot overwrite CLI updates', async t => {
  const { store, revision } = await fixture(t)
  const loaded = await store.readStorage({ identifier: 'stream.txt' })
  await store.updateBlock(request(revision))
  await assert.rejects(store.saveNote({ identifier: 'stream.txt', content: loaded.content + 'Unsaved edit', expectedStorageRevision: loaded.storageRevision }), { code: 'STORAGE_REVISION_CONFLICT' })
  assert.equal((await store.readBlock({ noteId: 'internal:stream', blockId: ids[1] })).content, 'Updated synthetic text')
})
