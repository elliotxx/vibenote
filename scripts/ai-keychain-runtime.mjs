import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const original = process.env.VIBENOTE_KEYCHAIN_BASE_APP || '/Applications/Vibenote.app'
const upgrade = process.env.VIBENOTE_KEYCHAIN_UPGRADE_APP || original
const harness = new PackagedAppHarness({
  appBundlePath: original,
  initialContent: noteContent([{ language: 'markdown', auto: true, content: 'synthetic credential upgrade verification' }]),
})
const key = 'synthetic-native-keychain-test'
let requests = 0
const server = http.createServer((request, response) => {
  assert.equal(request.headers.authorization, `Bearer ${key}`)
  requests++
  request.resume()
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end('{"choices":[{"message":{"content":"OK"}}]}')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
try {
  let page = await harness.launch()
  assert.equal(await harness.electronApp.evaluate(({ safeStorage }) => safeStorage.isEncryptionAvailable()), true)
  await page.evaluate(baseUrl => window.vibenote.ai.saveSettings({
    enabled: true, provider: 'deepseek', baseUrl, model: 'test-model',
  }), `http://127.0.0.1:${server.address().port}`)
  assert.equal((await page.evaluate(value => window.vibenote.ai.setApiKey(value), key)).keyStorage, 'secure')
  const keyPath = path.join(harness.userDataPath, 'ai-key.bin')
  const record = fs.readFileSync(keyPath)
  const parsed = JSON.parse(record)
  assert.equal(parsed.storage, 'safeStorage')
  assert.equal(record.includes(key), false)
  assert.notEqual(parsed.value, Buffer.from(key).toString('base64'))
  assert.equal((await page.evaluate(() => window.vibenote.ai.testConnection())).ok, true)
  console.log('ok - native Keychain encrypts synthetic credentials and production IPC decrypts them')
  await harness.stop()
  harness.appBundlePath = upgrade
  harness.executablePath = path.join(upgrade, 'Contents/MacOS/Vibenote')
  page = await harness.launch()
  assert.equal((await page.evaluate(() => window.vibenote.ai.testConnection())).ok, true)
  assert.deepEqual(fs.readFileSync(keyPath), record)
  console.log('ok - second signed app reads the unchanged native encrypted record')
  await harness.relaunch()
  assert.equal((await harness.page.evaluate(() => window.vibenote.ai.testConnection())).ok, true)
  assert.equal(requests, 3)
  console.log('ok - native encrypted credentials survive relaunch; all requests stayed on loopback')
} finally {
  await harness.cleanup()
  await new Promise(resolve => server.close(resolve))
}
