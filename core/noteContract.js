import crypto from 'node:crypto'

export const CLI_CONTRACT = Object.freeze({
  schemaVersion: 'v1alpha1',
  formatVersion: '1.1.0',
  uuidNamespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  fingerprintVersion: 'v1',
  exitCodes: Object.freeze({
    success: 0,
    runtime: 1,
    usage: 2,
    notFound: 3,
    conflict: 4,
    denied: 5,
    dataSafety: 6,
  }),
  limits: Object.freeze({
    list: Object.freeze({ default: 20, max: 100 }),
    snippetCharacters: 240,
    snapshotMax: 100,
    appendBytes: 256 * 1024,
    noteRawBytes: 1024 * 1024,
    blockRead: Object.freeze({ defaultBytes: 64 * 1024, maxBytes: 256 * 1024 }),
  }),
  commands: Object.freeze([
    'version',
    'capabilities',
    'doctor',
    'notes.list',
    'notes.read',
    'blocks.list',
    'blocks.read',
    'blocks.append',
    'search',
  ]),
})

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]))
  }
  return value
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

export function idempotencyHashes({ noteId, key, language, content, options = {} }) {
  const keyHash = sha256(String(key))
  const payload = canonicalJson({
    version: CLI_CONTRACT.fingerprintVersion,
    noteId,
    language,
    content,
    options,
  })
  return { keyHash, payloadHash: sha256(payload) }
}

function uuidBytes(uuid) {
  const hex = uuid.replaceAll('-', '')
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error('Invalid UUID namespace')
  return Buffer.from(hex, 'hex')
}

function formatUuid(bytes) {
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function uuidV5(namespace, name) {
  const digest = crypto.createHash('sha1').update(uuidBytes(namespace)).update(String(name), 'utf8').digest()
  const bytes = Buffer.from(digest.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return formatUuid(bytes)
}

export function blockIdForRequest(noteId, keyHash) {
  return uuidV5(CLI_CONTRACT.uuidNamespace, `${CLI_CONTRACT.fingerprintVersion}\0${noteId}\0${keyHash}`)
}
