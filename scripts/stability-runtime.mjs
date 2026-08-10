import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appBundlePath = path.join(root, 'dist', `mac-${releaseArch}`, `${productName}.app`)
const marker = `stability-smoke-${Date.now()}`
const longPayload = [
  `${marker}-start`,
  ...Array.from({ length: 360 }, (_, index) => `${marker}-line-${String(index + 1).padStart(3, '0')} ${'x'.repeat(72)}`),
  `${marker}-end`,
].join('\n')

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`ok - ${message}`)
}

const harness = new PackagedAppHarness({
  appBundlePath,
  initialContent: noteContent([
    { language: 'markdown', auto: true, content: '' },
  ]),
})

try {
  check(fs.existsSync(appBundlePath), `packaged app exists at ${appBundlePath}`)
  let page = await harness.launch()
  await page.locator('.cm-content').click({ position: { x: 24, y: 24 } })
  await page.keyboard.insertText(longPayload)

  const autosaved = await harness.waitForStream(
    content => content.includes(`${marker}-start`) && content.includes(`${marker}-end`),
    'Autosave did not persist the stability payload',
  )
  check((autosaved.match(new RegExp(marker, 'g')) || []).length >= 360, 'autosave preserves the long payload')

  await harness.stop()
  const saved = harness.readStream()
  check(saved.includes(`${marker}-start`), 'quit-time save includes payload start')
  check(saved.includes(`${marker}-end`), 'quit-time save includes payload end')

  page = await harness.launch()
  await page.locator('.cm-content').waitFor({ state: 'attached' })
  const reloadedText = await page.locator('.cm-content').textContent()
  check(reloadedText?.includes(`${marker}-start`), 'relaunch loads the persisted payload into the editor')
  check(harness.readStream().includes(`${marker}-end`), 'relaunch preserves the complete payload on disk')
  console.log('Stability runtime verification completed.')
} finally {
  await harness.cleanup()
}
