import assert from 'node:assert/strict'
import test from 'node:test'

import {
  appendBlockToNote,
  contentRevision,
  parseNote,
  serializeNote,
} from '../../core/noteFormat.js'

const legacyNote = '{"formatVersion":"1.0.0","name":"Fixture","cursors":null}\n---block:markdown;auto=1;created=2026-01-01T00:00:00.000Z\nSynthetic content'

test('legacy note round-trips without rewriting bytes', () => {
  const parsed = parseNote(legacyNote)

  assert.equal(parsed.blocks.length, 1)
  assert.equal(parsed.blocks[0].stable, false)
  assert.equal(serializeNote(parsed), legacyNote)
})

test('new delimiter accepts reordered fields and preserves unknown fields', () => {
  const raw = '{"formatVersion":"1.0.0","name":"Fixture"}\n---block:markdown;created=2026-01-01T00:00:00.000Z;future=value;id=550e8400-e29b-41d4-a716-446655440000;auto=0\nSynthetic content'

  const parsed = parseNote(raw)

  assert.equal(parsed.blocks[0].id, '550e8400-e29b-41d4-a716-446655440000')
  assert.equal(parsed.blocks[0].fields.future, 'value')
  assert.equal(serializeNote(parsed), raw)
})

test('delimiter rejects duplicate fields and newline injection', () => {
  assert.throws(
    () => parseNote('---block:markdown;auto=0;auto=1\ncontent'),
    error => error.code === 'INVALID_NOTE_FORMAT',
  )
  assert.throws(
    () => appendBlockToNote(legacyNote, { language: 'markdown\ninvalid', id: '550e8400-e29b-41d4-a716-446655440000', created: '2026-01-01T00:00:00.000Z', content: 'x' }),
    error => error.code === 'INVALID_ARGUMENT',
  )
})

test('content revision ignores UI metadata but includes unknown metadata', () => {
  const first = parseNote(legacyNote)
  const cursorChanged = parseNote(legacyNote.replace('"cursors":null', '"cursors":{"head":4}'))
  const unknownChanged = parseNote(legacyNote.replace('"cursors":null', '"cursors":null,"business":"changed"'))

  assert.equal(contentRevision(first), contentRevision(cursorChanged))
  assert.notEqual(contentRevision(first), contentRevision(unknownChanged))
})
