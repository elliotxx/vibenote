import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
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

  await harness.stop()
  const imagePaths = ['Application Support/image.png', '图片/示例.png', 'literal%20/image#1?.png']
    .map(name => path.join(harness.tempPath, name))
  for (const imagePath of imagePaths) {
    fs.mkdirSync(path.dirname(imagePath), { recursive: true })
    fs.writeFileSync(imagePath, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=', 'base64'))
  }
  const imageSources = [...imagePaths, pathToFileURL(imagePaths[0]).href]
  const expectedUrls = [...imagePaths, imagePaths[0]].map(file => pathToFileURL(file).href)
  const imageMarkdown = `# Image fixture\n${imageSources.map(source => `![sample](<${source}>)`).join('\n')}`
  harness.seedStream(noteContent([
    { language: 'markdown', auto: false, content: imageMarkdown },
  ]))
  const imagePage = await harness.launch()
  async function checkImages(selector, mode) {
    await imagePage.waitForFunction(({ selector, count }) => {
      const images = [...document.querySelectorAll(selector)]
      return images.length === count && images.every(image => image.complete)
    }, { selector, count: expectedUrls.length })
    const images = await imagePage.locator(selector).evaluateAll(elements =>
      elements.map(image => ({ src: image.src, loaded: image.naturalWidth > 0 })),
    )
    check(images.every((image, index) => image.loaded && image.src === expectedUrls[index]),
      `${mode} loads local images with spaces, Unicode, literal URL characters, and file URLs`)
  }
  await checkImages('.image-widget img', 'live preview')
  const host = await imagePage.locator('.editor-host').boundingBox()
  const heading = await imagePage.locator('.cm-line').filter({ hasText: 'Image fixture' }).boundingBox()
  await imagePage.mouse.move(host.x + host.width - 24, heading.y + 12)
  await imagePage.getByRole('button', { name: '预览模式', exact: true }).click()
  await checkImages('.markdown-preview img', 'full preview')
  await harness.stop()
  check(harness.readStream().includes(imageMarkdown), 'image mode switching preserves Markdown source')
  console.log('Runtime smoke verification completed.')
} finally {
  await harness.cleanup()
}
