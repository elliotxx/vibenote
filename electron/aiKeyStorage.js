// Persist new credentials with the OS keystore; retain legacy reads for migration.
export function encodeApiKey(value, secureStorage) {
  if (!secureStorage?.isEncryptionAvailable() || secureStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('Secure credential storage is unavailable. Unlock your system keychain and try again. Your existing API key has been kept.')
  }
  return { version: 2, storage: 'safeStorage', value: secureStorage.encryptString(value).toString('base64') }
}

export function decodeApiKey(record, secureStorage) {
  if (!record || typeof record.value !== 'string') throw new Error('Invalid API key record. Your existing record has been kept.')
  if (record.storage === 'localFallback') return Buffer.from(record.value, 'base64').toString('utf8')
  if (record.storage !== 'safeStorage') throw new Error('Unsupported API key storage')
  try {
    return secureStorage.decryptString(Buffer.from(record.value, 'base64'))
  } catch {
    throw new Error('The saved API key could not be unlocked. Unlock your system keychain and try again. Your existing record has been kept.')
  }
}
