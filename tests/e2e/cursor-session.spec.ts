import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

const CURSOR_KEY = 'vibenote:cursor-state:v1'
const created = '2026-07-01T10:38:41.565Z'
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function longFixture() {
  const lines = Array.from({ length: 160 }, (_, index) => `Synthetic line ${String(index + 1).padStart(3, '0')}`)
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Cursor Test' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    '# Cursor test',
    ...lines,
  ].join('\n')}`
}

async function loadBuffer(page: Page, bufferPath = 'cursor-test.txt', content = longFixture()) {
  await page.addInitScript(({ bufferPath, content }) => {
    if (sessionStorage.getItem('vibenote:cursor-fixture-loaded')) return
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: bufferPath, name: 'Cursor Test', tags: [], isScratch: true, content },
    ]))
    sessionStorage.setItem('vibenote:cursor-fixture-loaded', '1')
  }, { bufferPath, content })
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function moveToSyntheticLine(page: Page, line: number) {
  await page.locator('.cm-content').click({ position: { x: 80, y: 20 } })
  await page.keyboard.press(`${modifier}+End`)
  for (let index = line; index < 160; index += 1) {
    await page.keyboard.press('ArrowUp')
  }
  await expect.poll(() => activeLineText(page)).toContain(`Synthetic line ${String(line).padStart(3, '0')}`)
}

async function activeLineText(page: Page) {
  return page.locator('.cm-activeLine').innerText()
}

test.describe('cursor session state', () => {
  test.describe.configure({ mode: 'serial', timeout: 45_000 })

  test('restores a cursor in a long note without changing note content', async ({ page }) => {
    const content = longFixture()
    await loadBuffer(page, 'cursor-test.txt', content)

    if (process.env.VIBENOTE_EVIDENCE_DIR) {
      await page.screenshot({ path: path.join(process.env.VIBENOTE_EVIDENCE_DIR, 'before.png') })
    }

    await moveToSyntheticLine(page, 145)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CURSOR_KEY)).not.toBeNull()
    const beforeReload = await page.evaluate(() => localStorage.getItem('vibenote:mock-buffers'))

    await page.reload()
    await expect(page.locator('.cm-editor')).toBeVisible()
    await expect.poll(() => activeLineText(page)).toContain('Synthetic line 145')
    await expect(page.locator('.cm-cursor')).toHaveCount(1)
    await expect(page.locator('.cm-activeLine')).toBeInViewport()
    expect(await page.evaluate(() => localStorage.getItem('vibenote:mock-buffers'))).toBe(beforeReload)

    if (process.env.VIBENOTE_EVIDENCE_DIR) {
      await page.screenshot({ path: path.join(process.env.VIBENOTE_EVIDENCE_DIR, 'after.png') })
    }
  })

  test('keeps cursor positions isolated by buffer identifier', async ({ page }) => {
    await loadBuffer(page, 'first.txt')
    await moveToSyntheticLine(page, 120)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CURSOR_KEY)).not.toBeNull()

    await page.evaluate((content) => {
      localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
        { path: 'second.txt', name: 'Second', tags: [], isScratch: true, content },
      ]))
    }, longFixture())
    await page.reload()

    await expect.poll(() => activeLineText(page)).toContain('# Cursor test')
    await expect(page.locator('.cm-cursor')).toHaveCount(1)
  })

  test('restores only the main position from a selection or multiple cursors', async ({ page }) => {
    await loadBuffer(page)
    await moveToSyntheticLine(page, 90)
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.up('Shift')
    await page.keyboard.press(`${modifier}+Alt+ArrowUp`)
    await expect(page.locator('.cm-cursor')).toHaveCount(2)
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CURSOR_KEY)).not.toBeNull()

    await page.reload()
    await expect(page.locator('.cm-cursor')).toHaveCount(1)
    await expect(page.locator('.cm-selectionBackground')).toHaveCount(0)
    await expect.poll(() => activeLineText(page)).toContain('Synthetic line 089')
  })

  for (const [name, invalidState] of [
    ['corrupt JSON', '{broken-json'],
    ['out-of-range anchor', JSON.stringify({ version: 1, documents: { 'cursor-test.txt': { anchor: 999999, updatedAt: 1 } } })],
    ['delimiter anchor', JSON.stringify({ version: 1, documents: { 'cursor-test.txt': { anchor: 2, updatedAt: 1 } } })],
  ]) {
    test(`falls back safely for ${name}`, async ({ page }) => {
      await page.addInitScript(({ key, invalidState }) => localStorage.setItem(key, invalidState), {
        key: CURSOR_KEY,
        invalidState,
      })
      await loadBuffer(page)
      await expect.poll(() => activeLineText(page)).toContain('# Cursor test')
      await expect(page.locator('.cm-cursor')).toHaveCount(1)
    })
  }

  test('continues editing when cursor storage writes fail', async ({ page }) => {
    await page.addInitScript((cursorKey) => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key === cursorKey) throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
        return original.call(this, key, value)
      }
    }, CURSOR_KEY)
    await loadBuffer(page)
    await moveToSyntheticLine(page, 40)
    await page.keyboard.type('X')
    await expect(page.locator('.cm-content')).toContainText('Synthetic line 040X')
  })
})
