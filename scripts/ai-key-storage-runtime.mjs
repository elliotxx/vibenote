import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const harness = new PackagedAppHarness({
  appBundlePath: path.join(root, 'dist/mac-arm64/Vibenote.app'),
  initialContent: noteContent([{ language: 'markdown', auto: true, content: 'credential verification' }]),
})
const key = 'synthetic-verification-key'
let requestCount = 0
const server = http.createServer((request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${key}`)
  requestCount++
  request.resume()
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end('{"choices":[{"message":{"content":"OK"}}]}')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  const page = await harness.launch()
  // Exercise production IPC and files without accessing the user's real Keychain.
  await harness.electronApp.evaluate(({ safeStorage }) => {
    safeStorage.isEncryptionAvailable = () => true
    safeStorage.encryptString = value => Buffer.from(`test-cipher:${value}`)
    safeStorage.decryptString = bytes => {
      const value = bytes.toString()
      if (!value.startsWith('test-cipher:')) throw new Error('test decryption failed')
      return value.slice('test-cipher:'.length)
    }
  })
  await page.evaluate(baseUrl => window.vibenote.ai.saveSettings({
    enabled: true, provider: 'deepseek', baseUrl, model: 'test-model',
  }), `http://127.0.0.1:${server.address().port}`)
  const keyPath = path.join(harness.userDataPath, 'ai-key.bin')
  const saved = await page.evaluate(value => window.vibenote.ai.setApiKey(value), key)
  assert.equal(saved.keyStorage, 'secure')
  assert.equal(JSON.parse(fs.readFileSync(keyPath)).storage, 'safeStorage')
  assert.equal((await page.evaluate(() => window.vibenote.ai.testConnection())).ok, true)
  console.log('ok - production IPC saves encrypted records and reads them for provider requests')

  fs.writeFileSync(keyPath, JSON.stringify({ version: 1, storage: 'localFallback', value: Buffer.from(key).toString('base64') }))
  assert.equal((await page.evaluate(() => window.vibenote.ai.testConnection())).ok, true)
  assert.equal(JSON.parse(fs.readFileSync(keyPath)).storage, 'safeStorage')
  console.log('ok - legacy base64 credentials migrate through production IPC')

  const before = fs.readFileSync(keyPath)
  await harness.electronApp.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => false })
  await assert.rejects(page.evaluate(value => window.vibenote.ai.setApiKey(value), 'replacement-key'), /Secure credential storage is unavailable/)
  assert.deepEqual(fs.readFileSync(keyPath), before)
  console.log('ok - unavailable encryption rejects replacement without changing the saved record')

  await harness.electronApp.evaluate(({ safeStorage }) => {
    safeStorage.decryptString = () => { throw new Error('test locked keychain') }
  })
  const failed = await page.evaluate(() => window.vibenote.ai.testConnection())
  assert.equal(failed.ok, false)
  assert.match(failed.message, /existing record has been kept/)
  assert.deepEqual(fs.readFileSync(keyPath), before)
  assert.equal(requestCount, 2)
  console.log('ok - decryption failure preserves the saved record and prevents provider requests')
} finally {
  await harness.cleanup()
  await new Promise(resolve => server.close(resolve))
}
