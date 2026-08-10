import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appBundlePath = path.join(root, 'dist', `mac-${releaseArch}`, `${productName}.app`)
const marker = `edge-smoke-${Date.now()}`
const primary = process.platform === 'darwin' ? 'Meta' : 'Control'

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`ok - ${message}`)
}

function blockCount(content) {
  return (content.match(/---block:/g) || []).length
}

const harness = new PackagedAppHarness({
  appBundlePath,
  initialContent: noteContent([
    { language: 'markdown', auto: true, content: `${marker}-delete` },
    { language: 'markdown', auto: true, content: `${marker}-keep` },
  ]),
})

try {
  check(fs.existsSync(appBundlePath), `packaged app exists at ${appBundlePath}`)
  let page = await harness.launch()
  await page.locator('.cm-line').filter({ hasText: `${marker}-delete` }).click()
  await page.keyboard.press(`${primary}+Shift+d`)

  let content = await harness.waitForStream(
    value => !value.includes(`${marker}-delete`),
    'Current block deletion was not persisted',
  )
  check(content.includes(`${marker}-keep`), 'delete keeps the non-active block')
  check(blockCount(content) === 1, 'delete persists exactly one remaining block')

  await page.keyboard.press(`${primary}+Shift+d`)
  await page.waitForTimeout(500)
  content = harness.readStream()
  check(content.includes(`${marker}-keep`), 'delete refuses to remove the final block')
  check(blockCount(content) === 1, 'final-block delete leaves block structure intact')

  await harness.stop()
  const invalidJson = `{"${marker}": true`
  harness.seedStream(noteContent([
    { language: 'json', auto: false, content: invalidJson },
  ]))
  page = await harness.launch()
  await page.locator('.cm-line').filter({ hasText: marker }).click()
  await page.keyboard.press('Alt+Shift+f')
  await page.waitForTimeout(500)
  content = harness.readStream()
  check(content.includes(invalidJson), 'invalid JSON format attempt preserves original content')
  check(blockCount(content) === 1, 'invalid format attempt preserves block structure')
  console.log('Edge runtime verification completed.')
} finally {
  await harness.cleanup()
}
