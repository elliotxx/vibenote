import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeApiKey, decodeApiKey } from '../../electron/aiKeyStorage.js'

const key = 'synthetic-api-key'
function keystore(overrides = {}) {
  return {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`encrypted:${value}`),
    decryptString: bytes => {
      const value = bytes.toString()
      if (!value.startsWith('encrypted:')) throw new Error('invalid ciphertext')
      return value.slice('encrypted:'.length)
    },
    ...overrides,
  }
}

test('new credentials use encrypted records and can be unlocked', () => {
  const record = encodeApiKey(key, keystore())
  assert.equal(record.storage, 'safeStorage')
  assert.notEqual(record.value, Buffer.from(key).toString('base64'))
  assert.equal(decodeApiKey(record, keystore()), key)
})

test('missing or plaintext OS backend cannot create a plaintext fallback', () => {
  assert.throws(() => encodeApiKey(key, keystore({ isEncryptionAvailable: () => false })), /Secure credential storage is unavailable/)
  assert.throws(() => encodeApiKey(key, keystore({ getSelectedStorageBackend: () => 'basic_text' })), /Secure credential storage is unavailable/)
})

test('legacy base64 records remain readable and can migrate to encrypted records', () => {
  const legacy = { version: 1, storage: 'localFallback', value: Buffer.from(key).toString('base64') }
  const before = JSON.stringify(legacy)
  const migrated = encodeApiKey(decodeApiKey(legacy, keystore()), keystore())
  assert.equal(decodeApiKey(migrated, keystore()), key)
  assert.equal(JSON.stringify(legacy), before)
})

test('legacy encrypted records can be unlocked without clearing and reentering', () => {
  const legacy = { version: 0, storage: 'safeStorage', value: Buffer.from(`encrypted:${key}`).toString('base64') }
  assert.equal(decodeApiKey(legacy, keystore()), key)
})

test('decryption and encryption failures preserve the old record', () => {
  const legacy = { version: 1, storage: 'safeStorage', value: 'invalid-record' }
  const before = JSON.stringify(legacy)
  assert.throws(() => decodeApiKey(legacy, keystore()), /existing record has been kept/)
  assert.equal(JSON.stringify(legacy), before)
  assert.throws(() => encodeApiKey(key, keystore({ encryptString: () => { throw new Error('locked') } })), /locked/)
  assert.equal(JSON.stringify(legacy), before)
})
