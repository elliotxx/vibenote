import { _electron } from 'playwright'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const appExecutable = path.join(rootDir, 'dist/mac-arm64/Vibenote.app/Contents/MacOS/Vibenote')

function ok(message) {
  console.log(`ok - ${message}`)
}

function fail(message) {
  throw new Error(message)
}

function readBody(request) {
  return new Promise(resolve => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', chunk => {
      body += chunk
    })
    request.on('end', () => resolve(body))
  })
}

async function createMockProvider() {
  const requests = []
  const server = http.createServer(async (request, response) => {
    const body = await readBody(request)
    requests.push({
      url: request.url,
      authorization: request.headers.authorization || '',
      body,
    })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }))
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => server.close(),
  }
}

async function main() {
  if (!fs.existsSync(appExecutable)) {
    fail('packaged app executable is missing; run npm run build:mac first')
  }

  const provider = await createMockProvider()
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-ai-runtime-user-data-'))
  fs.writeFileSync(path.join(userDataDir, 'ai-settings.json'), '{broken json', { mode: 0o600 })
  fs.writeFileSync(
    path.join(userDataDir, 'ai-key.bin'),
    JSON.stringify({ version: 1, storage: 'safeStorage', value: 'legacy-keychain-record' }),
    { mode: 0o600 },
  )
  let app

  try {
    app = await _electron.launch({
      executablePath: appExecutable,
      args: [`--user-data-dir=${userDataDir}`],
    })
    const page = await app.firstWindow()
    await page.waitForSelector('.cm-editor', { timeout: 15000 })
    ok('packaged app opened with an isolated user data directory')

    await page.getByRole('button', { name: 'Settings' }).click()
    await page.getByRole('heading', { name: 'AI' }).waitFor({ timeout: 10000 })
    ok('AI settings section is visible')

    await page.getByText(/API key saved/).waitFor({ timeout: 10000 })
    await page.getByRole('button', { name: 'Clear' }).click()
    await page.getByText('API key cleared').waitFor({ timeout: 10000 })
    ok('legacy Keychain API key records can be cleared without prompting')

    await page.getByLabel('Enable AI').check()
    await page.getByLabel('Provider').selectOption('custom-openai-compatible')
    await page.getByLabel('Base URL').fill(`${provider.baseUrl}/v1/`)
    await page.getByLabel('Model').fill('mock-chat')
    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()
    await page.getByText(/API key saved/).waitFor({ timeout: 10000 })
    ok('API key can be saved from the packaged app')

    const localStorageDump = await page.evaluate(() => JSON.stringify(localStorage))
    if (localStorageDump.includes('test-api-key-value')) {
      fail('API key leaked to renderer localStorage')
    }
    ok('renderer localStorage does not contain the API key')

    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText('Connection OK').waitFor({ timeout: 10000 })

    await page.getByLabel('Base URL').fill(`${provider.baseUrl}/v1/chat/completions`)
    await page.getByLabel('Base URL').blur()
    await page.getByRole('button', { name: 'Test connection' }).click()
    await page.getByText('Connection OK').waitFor({ timeout: 10000 })

    if (provider.requests.length !== 2) {
      fail(`expected 2 provider requests, got ${provider.requests.length}`)
    }

    for (const request of provider.requests) {
      if (request.url !== '/v1/chat/completions') {
        fail(`unexpected provider request path: ${request.url}`)
      }
      if (!request.authorization.startsWith('Bearer ')) {
        fail('provider request is missing bearer authorization')
      }
      if (request.body.includes('Drop plain text notes here') || request.body.includes('AI setting note')) {
        fail('provider request leaked note content')
      }
      if (!request.body.includes('Reply with OK.')) {
        fail('provider request did not use the connection-test smoke prompt')
      }
    }
    ok('provider requests use the normalized chat completions path')
    ok('connection test sends only the short smoke prompt')

    await page.getByRole('button', { name: 'Clear' }).click()
    await page.getByText('API key cleared').waitFor({ timeout: 10000 })
    ok('API key can be cleared from the packaged app')
  } finally {
    if (app) await app.close()
    provider.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }

  console.log('AI runtime verification completed.')
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
