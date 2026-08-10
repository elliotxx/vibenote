import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appBundlePath = path.join(root, 'dist', `mac-${releaseArch}`, `${productName}.app`)
const marker = `runtime-smoke-${Date.now()}`
const primary = process.platform === 'darwin' ? 'Meta' : 'Control'

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
  const page = await harness.launch()
  check(await page.locator('.cm-editor').count() === 1, `${productName} starts in headless verification mode`)

  await page.locator('.cm-content').click({ position: { x: 24, y: 24 } })
  await page.keyboard.insertText(`${marker}-one`)
  await page.keyboard.press(`${primary}+Enter`)
  await page.keyboard.insertText(`${marker}-two`)
  await page.keyboard.press('Alt+Enter')
  await page.keyboard.insertText(`${marker}-before`)

  const markerVariants = [`${marker}-one`, `${marker}-two`, `${marker}-before`]
  const content = await harness.waitForStream(
    value => markerVariants.every(item => value.includes(item)),
    'Runtime smoke text was not persisted',
  )
  const blockCount = (content.match(/---block:/g) || []).length
  const markerBlocks = content.split(/---block:[^\n]+\n/).filter(block => markerVariants.some(value => block.includes(value)))
  check(blockCount >= 3, 'runtime shortcuts create separate blocks')
  check(markerBlocks.length >= 3, 'runtime shortcut markers are distributed across blocks')
  check(!content.includes(`${marker}-before---block:`), 'block-before shortcut keeps delimiters on separate lines')
  console.log('Runtime smoke verification completed.')
} finally {
  await harness.cleanup()
}
