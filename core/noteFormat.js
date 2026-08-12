import crypto from 'node:crypto'

import { canonicalJson } from './noteContract.js'
import { noteError } from './noteErrors.js'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LANGUAGE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/i
const UI_METADATA_FIELDS = new Set(['cursors', 'foldedRanges'])
const DELIMITER_LINE = /(^|\n)(---block:([^\n]+)\n)/g

function invalidFormat(message) {
  return noteError('INVALID_NOTE_FORMAT', message)
}

function parseDelimiter(line) {
  const [language, ...segments] = line.split(';')
  if (!LANGUAGE_PATTERN.test(language)) throw invalidFormat('Invalid block language')
  const fields = {}
  const fieldOrder = []
  for (const segment of segments) {
    const equals = segment.indexOf('=')
    if (equals <= 0) throw invalidFormat('Invalid block field')
    const key = segment.slice(0, equals)
    const value = segment.slice(equals + 1)
    if (!FIELD_NAME_PATTERN.test(key) || !value || value.includes('\n')) throw invalidFormat('Invalid block field')
    if (Object.hasOwn(fields, key)) throw invalidFormat('Duplicate block field')
    fields[key] = value
    fieldOrder.push(key)
  }
  if (fields.id && !UUID_PATTERN.test(fields.id)) throw invalidFormat('Invalid block id')
  if (fields.auto && !/^[01]$/.test(fields.auto)) throw invalidFormat('Invalid auto value')
  if (fields.created && Number.isNaN(Date.parse(fields.created))) throw invalidFormat('Invalid created time')
  return { language, fields, fieldOrder }
}

export function parseNote(raw) {
  if (typeof raw !== 'string') throw invalidFormat('Note must be UTF-8 text')
  const matches = [...raw.matchAll(DELIMITER_LINE)]
  let metadata = {}
  let metadataRaw = ''
  if (matches.length > 0) {
    const firstIndex = matches[0].index + (matches[0][1] ? 1 : 0)
    metadataRaw = raw.slice(0, firstIndex).replace(/\n$/, '')
    if (metadataRaw.trim()) {
      try {
        metadata = JSON.parse(metadataRaw.trim())
      } catch {
        throw invalidFormat('Invalid note metadata')
      }
    }
  }

  const blocks = matches.map((match, index) => {
    const delimiterStart = match.index + (match[1] ? 1 : 0)
    const delimiterEnd = match.index + match[0].length
    const contentEnd = index + 1 < matches.length
      ? matches[index + 1].index + (matches[index + 1][1] ? 1 : 0)
      : raw.length
    const parsed = parseDelimiter(match[3])
    return {
      ...parsed,
      id: parsed.fields.id || null,
      stable: Boolean(parsed.fields.id),
      legacyIndex: parsed.fields.id ? null : index,
      delimiterRaw: raw.slice(delimiterStart, delimiterEnd),
      content: raw.slice(delimiterEnd, contentEnd).replace(/\n$/, match[1] && index + 1 < matches.length ? '' : '$&'),
      rawRange: { from: delimiterStart, to: contentEnd },
    }
  })

  return { raw, metadata, metadataRaw, blocks, dirty: false }
}

export function serializeNote(note) {
  if (!note.dirty && typeof note.raw === 'string') return note.raw
  const metadata = Object.keys(note.metadata || {}).length ? `${JSON.stringify(note.metadata)}\n` : ''
  const body = note.blocks.map(block => `${serializeDelimiter(block)}\n${block.content}`).join('\n')
  return `${metadata}${body}`
}

export function serializeDelimiter(block) {
  const fields = block.fields || {}
  const order = block.fieldOrder || Object.keys(fields)
  return `---block:${block.language}${order.map(key => `;${key}=${fields[key]}`).join('')}`
}

export function appendBlockToNote(raw, block) {
  if (!LANGUAGE_PATTERN.test(block.language || '')) throw noteError('INVALID_ARGUMENT', 'Invalid block language')
  if (!UUID_PATTERN.test(block.id || '')) throw noteError('INVALID_ARGUMENT', 'Invalid block id')
  if (Number.isNaN(Date.parse(block.created || ''))) throw noteError('INVALID_ARGUMENT', 'Invalid created time')
  if (typeof block.content !== 'string') throw noteError('INVALID_ARGUMENT', 'Content must be text')
  const fields = {
    id: block.id,
    auto: block.auto ? '1' : '0',
    created: block.created,
    ...(block.requestHash ? { request: `sha256:${block.requestHash}` } : {}),
    ...(block.payloadHash ? { payload: `sha256:${block.payloadHash}` } : {}),
  }
  const delimiter = serializeDelimiter({ language: block.language, fields, fieldOrder: Object.keys(fields) })
  const separator = raw.length === 0 || raw.endsWith('\n') ? '' : '\n'
  return `${raw}${separator}${delimiter}\n${block.content}`
}

export function contentRevision(note) {
  const metadata = Object.fromEntries(
    Object.entries(note.metadata || {}).filter(([key]) => !UI_METADATA_FIELDS.has(key)),
  )
  const blocks = note.blocks.map(block => ({
    language: block.language,
    fields: block.fields,
    content: block.content,
  }))
  return `sha256:${crypto.createHash('sha256').update(canonicalJson({ metadata, blocks })).digest('hex')}`
}

export function storageRevision(raw) {
  return `sha256:${crypto.createHash('sha256').update(raw, 'utf8').digest('hex')}`
}
