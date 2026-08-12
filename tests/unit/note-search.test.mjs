import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { NoteStore } from '../../core/noteStore.js'

test('search returns bounded fixed-string block results without absolute paths', async t => {
  const userDataPath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-search-'))
  t.after(() => fs.promises.rm(userDataPath, { recursive: true, force: true }))
  await fs.promises.mkdir(path.join(userDataPath, 'notes'), { recursive: true })
  await fs.promises.writeFile(path.join(userDataPath, 'notes', 'stream.txt'), '{"formatVersion":"1.0.0","name":"Stream"}\n---block:markdown;auto=1;created=2026-01-01T00:00:00.000Z\nAlpha Synthetic Needle Omega')
  const store = new NoteStore({ userDataPath })

  const result = await store.search({ query: 'synthetic needle', limit: 1 })

  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].noteId, 'internal:stream')
  assert.equal(result.items[0].legacyIndex, 0)
  assert.match(result.items[0].snippet, /Synthetic Needle/i)
  assert.equal(JSON.stringify(result).includes(userDataPath), false)
})
