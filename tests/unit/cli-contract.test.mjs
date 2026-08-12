import assert from 'node:assert/strict'
import test from 'node:test'

import {
  CLI_CONTRACT,
  blockIdForRequest,
  idempotencyHashes,
} from '../../core/noteContract.js'
import { notePaths } from '../../core/notePaths.js'

test('contract exposes one versioned source for limits and exit codes', () => {
  assert.equal(CLI_CONTRACT.schemaVersion, 'v1alpha1')
  assert.equal(CLI_CONTRACT.limits.list.default, 20)
  assert.equal(CLI_CONTRACT.limits.list.max, 100)
  assert.deepEqual(CLI_CONTRACT.exitCodes, {
    success: 0,
    runtime: 1,
    usage: 2,
    notFound: 3,
    conflict: 4,
    denied: 5,
    dataSafety: 6,
  })
})

test('UUIDv5 block id is deterministic and request fingerprint detects changed content', () => {
  const first = idempotencyHashes({
    noteId: 'internal:stream',
    key: 'synthetic-task',
    language: 'markdown',
    content: 'first',
    options: { auto: false },
  })
  const replay = idempotencyHashes({
    noteId: 'internal:stream',
    key: 'synthetic-task',
    language: 'markdown',
    content: 'first',
    options: { auto: false },
  })
  const changed = idempotencyHashes({
    noteId: 'internal:stream',
    key: 'synthetic-task',
    language: 'markdown',
    content: 'second',
    options: { auto: false },
  })

  assert.deepEqual(first, replay)
  assert.equal(first.keyHash, changed.keyHash)
  assert.notEqual(first.payloadHash, changed.payloadHash)
  assert.equal(blockIdForRequest('internal:stream', first.keyHash), '7ad74499-c166-503b-bf21-19a6aaaf4cbb')
})

test('storage paths derive from one explicit user data root', () => {
  assert.deepEqual(notePaths('/tmp/synthetic-vibenote'), {
    userData: '/tmp/synthetic-vibenote',
    notes: '/tmp/synthetic-vibenote/notes',
    snapshots: '/tmp/synthetic-vibenote/backups',
    recovery: '/tmp/synthetic-vibenote/recovery',
    runtime: '/tmp/synthetic-vibenote/runtime',
    locks: '/tmp/synthetic-vibenote/runtime/locks',
  })
})
