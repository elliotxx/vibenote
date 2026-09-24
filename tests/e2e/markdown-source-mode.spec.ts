import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const source = [
  '# Raw source',
  '**bold** and *italic*',
  '- [ ] task',
  '- [x] done',
  '[link](https://example.com)',
  '![sample](</tmp/vibenote-source-test.png>)',
  '> quote',
  '`inline code`',
  '```markdown',
  '**literal**',
  '```',
  'P1 @sample',
].join('\n')

function note(...blocks: string[]) {
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Modes' })}\n${blocks.map(content =>
    `---block:markdown;auto=0;created=2026-01-01T00:00:00.000Z\n${content}`,
  ).join('\n')}`
}

async function loadFixture(page: Page, content: string) {
  await page.addInitScript(content => {
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Modes', tags: [], isScratch: true, content },
    ]))
  }, content)
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function saved(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')[0].content)
}

async function revealToolbar(page: Page, title = 'Raw source') {
  const block = page.locator('.markdown-preview, .block-fold-summary, .cm-line:not(.block-delimiter-line)')
    .filter({ hasText: title }).first()
  const box = await block.boundingBox()
  const host = await page.locator('.editor-host').boundingBox()
  if (!box || !host) throw new Error('Missing block or editor host')
  await page.mouse.move(host.x + host.width - 24, box.y + 12)
  await expect(page.locator('.block-toolbar')).toBeVisible()
}

async function selectMode(page: Page, mode: '源码模式' | '半预览模式' | '预览模式', title = 'Raw source') {
  await revealToolbar(page, title)
  await page.getByRole('button', { name: mode, exact: true }).click()
}

test('defaults to live preview and switches losslessly among all three modes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const fixture = note(source)
  await loadFixture(page, fixture)
  await revealToolbar(page)
  await expect(page.getByRole('button', { name: '半预览模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.image-widget')).toHaveCount(1)
  await expect(page.locator('.markdown-task-checkbox')).toHaveCount(2)
  await expect(page.locator('.tok-strong')).toHaveText('bold')

  await selectMode(page, '源码模式')
  await expect(page.getByRole('button', { name: '源码模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.image-widget, .markdown-task-checkbox, .tok-strong, .tok-heading, .tok-priority')).toHaveCount(0)
  expect((await page.locator('.cm-line:not(.block-delimiter-line)').allTextContents()).join('\n')).toBe(source)
  await page.keyboard.press(`${modifier}+A`)
  await page.keyboard.press(`${modifier}+C`)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(source)

  await selectMode(page, '预览模式')
  await expect(page.locator('.markdown-preview h1')).toHaveText('Raw source')
  await expect(page.getByRole('button', { name: '预览模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await selectMode(page, '半预览模式')
  await expect(page.locator('.markdown-preview')).toHaveCount(0)
  await expect(page.locator('.image-widget')).toHaveCount(1)
  await expect(page.locator('.markdown-task-checkbox')).toHaveCount(2)
  await selectMode(page, '预览模式')
  await selectMode(page, '源码模式')
  await expect(page.locator('.image-widget, .markdown-task-checkbox, .markdown-preview')).toHaveCount(0)
  expect(await saved(page)).toBe(fixture)

  await page.reload()
  await expect(page.locator('.markdown-task-checkbox')).toHaveCount(2)
  await revealToolbar(page)
  await expect(page.getByRole('button', { name: '半预览模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('source mode allows character-level editing of image syntax and bold markers', async ({ page }) => {
  const fixture = note(source)
  await loadFixture(page, fixture)
  await page.locator('.image-widget').click()
  await selectMode(page, '源码模式')
  await expect(page.locator('.cm-editor')).not.toHaveClass(/image-line-focused/)
  await page.keyboard.press('Delete')
  await expect(page.locator('.cm-line').filter({ hasText: '[sample]' })).toHaveText('[sample](</tmp/vibenote-source-test.png>)')
  await page.keyboard.press(`${modifier}+Z`)
  const image = page.locator('.cm-line').filter({ hasText: '![sample]' })
  await image.click({ position: { x: 12, y: 8 } })
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.status-coordinate')).toHaveText('6:2')
  await page.keyboard.press('Backspace')
  await expect(image).toHaveCount(0)
  await expect(page.locator('.cm-line').filter({ hasText: '[sample]' })).toHaveText('[sample](</tmp/vibenote-source-test.png>)')
  await page.keyboard.press(`${modifier}+Z`)
  await expect(image).toHaveText('![sample](</tmp/vibenote-source-test.png>)')
  await expect(page.locator('.image-widget')).toHaveCount(0)

  await page.locator('.cm-line').filter({ hasText: '**bold** and *italic*' }).click()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.status-coordinate')).toHaveText('2:2')
  await page.keyboard.insertText('x')
  await expect(page.locator('.cm-line').filter({ hasText: '*x*bold**' })).toBeVisible()
  await page.keyboard.press(`${modifier}+Z`)
  await expect.poll(() => saved(page)).toBe(fixture)
})

test('source mode stays with its block after earlier edits, preview and folding', async ({ page }) => {
  const target = '# Second block\n**second**\n- [ ] second task'
  await loadFixture(page, note('# First block\n**first**', target))
  await page.locator('.cm-line').filter({ hasText: '# Second block' }).click()
  await selectMode(page, '源码模式', 'Second block')
  await expect(page.locator('.tok-strong')).toHaveText('first')
  await page.locator('.cm-line').filter({ hasText: '# First block' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type(' extra')
  await page.locator('.cm-line').filter({ hasText: '# Second block' }).click()
  await revealToolbar(page, 'Second block')
  await expect(page.getByRole('button', { name: '源码模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await selectMode(page, '预览模式', 'Second block')
  await page.locator('.markdown-preview').dblclick()
  await expect(page.locator('.markdown-task-checkbox')).toHaveCount(0)
  await expect(page.locator('.cm-line').filter({ hasText: '**second**' })).toBeVisible()
  await page.keyboard.press(`${modifier}+Alt+BracketLeft`)
  await expect(page.locator('.block-fold-summary')).toBeVisible()
  await page.locator('.block-fold-summary').click()
  await expect(page.locator('.cm-line').filter({ hasText: '**second**' })).toBeVisible()
  await revealToolbar(page, 'Second block')
  await expect(page.getByRole('button', { name: '源码模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('deleting a source block does not transfer its mode to the next block', async ({ page }) => {
  await loadFixture(page, note('# Raw source\n**first**', '# Next block\n**next**\n- [ ] next task'))
  await selectMode(page, '源码模式')
  await page.keyboard.press(`${modifier}+Shift+D`)
  await expect(page.locator('.cm-line').filter({ hasText: '# Raw source' })).toHaveCount(0)
  await expect(page.locator('.tok-strong')).toHaveText('next')
  await expect(page.locator('.markdown-task-checkbox')).toHaveCount(1)
  await revealToolbar(page, 'Next block')
  await expect(page.getByRole('button', { name: '半预览模式', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
