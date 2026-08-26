import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const created = '2026-08-26T08:00:00.000Z'

function note(blocks: string[], metadata: Record<string, unknown> = {}) {
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Fold fixture', ...metadata })}\n${blocks.join('\n')}`
}

function block(language: string, content: string) {
  return `---block:${language};auto=0;created=${created}\n${content}`
}

async function loadFixture(page: Page, content: string, settings?: Record<string, unknown>) {
  await page.addInitScript(({ value, settings }) => {
    if (localStorage.getItem('vibenote:mock-buffers')) return
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([{
      path: 'fold.txt',
      name: 'Fold fixture',
      tags: [],
      isScratch: true,
      content: value,
    }]))
    if (settings) {
      localStorage.setItem('vibenote:settings', JSON.stringify({
        theme: 'light',
        fontSize: 13,
        tabSize: 2,
        defaultLanguage: 'markdown',
        ...settings,
      }))
    }
  }, { value: content, settings })
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function savedRaw(page: Page) {
  return page.evaluate(() => {
    const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
    return buffers[0]?.content || ''
  })
}

function parseRaw(raw: string) {
  const newline = raw.indexOf('\n')
  return {
    metadata: JSON.parse(raw.slice(0, newline)),
    content: raw.slice(newline + 1),
  }
}

test.describe('block folding', () => {
  test('reuses the line-number gutter without moving editor content', async ({ page }) => {
    const fixture = note([
      block('markdown', '# Weekly goals\nShip the release\n- Verify runtime'),
      block('text', 'Second block'),
    ])
    const source = parseRaw(fixture).content
    await loadFixture(page, fixture)

    const before = await page.evaluate(() => ({
      gutters: document.querySelectorAll('.cm-gutter').length,
      contentLeft: document.querySelector('.cm-content')?.getBoundingClientRect().left,
    }))
    expect(before.gutters).toBe(1)

    const firstToggle = page.locator('.block-fold-toggle').first()
    await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(firstToggle.locator('.block-fold-line-number')).toHaveText('1')
    await expect(firstToggle.locator('.block-fold-line-number')).toHaveCSS('opacity', '1')
    await expect(firstToggle.locator('.block-fold-chevron')).toHaveCSS('opacity', '0')
    await firstToggle.hover()
    await expect(firstToggle.locator('.block-fold-line-number')).toHaveCSS('opacity', '0')
    await expect(firstToggle.locator('.block-fold-chevron')).toHaveCSS('opacity', '1')
    await firstToggle.click()

    const summary = page.getByRole('button', { name: /展开 Block：Weekly goals/ })
    await expect(summary).toBeVisible()
    await expect(summary.locator('.block-fold-summary-text')).toHaveText('Weekly goals')
    await expect(summary.locator('.block-fold-summary-meta')).toHaveText('Markdown · 3 行')
    await expect(page.locator('.cm-line').filter({ hasText: '# Weekly goals' })).toHaveCount(0)
    if (process.env.VIBENOTE_EVIDENCE_PATH) {
      await page.screenshot({ path: process.env.VIBENOTE_EVIDENCE_PATH, animations: 'disabled' })
    }

    const after = await page.evaluate(() => ({
      gutters: document.querySelectorAll('.cm-gutter').length,
      contentLeft: document.querySelector('.cm-content')?.getBoundingClientRect().left,
    }))
    expect(after).toEqual(before)

    await expect.poll(async () => parseRaw(await savedRaw(page)).metadata.foldedRanges).toHaveLength(1)
    expect(parseRaw(await savedRaw(page)).content).toBe(source)

    await summary.click()
    await expect(page.locator('.cm-line').filter({ hasText: '# Weekly goals' })).toBeVisible()
    await expect.poll(async () => parseRaw(await savedRaw(page)).metadata.foldedRanges).toBeUndefined()
    expect(parseRaw(await savedRaw(page)).content).toBe(source)
  })

  test('persists exact folded ranges and restores them after reload', async ({ page }) => {
    const fixture = note([
      block('markdown', '# Keep source\nBody'),
      block('typescript', 'interface User {\n  id: string\n}'),
    ])
    await loadFixture(page, fixture)

    await page.locator('.block-fold-toggle').nth(1).click()
    await expect(page.getByRole('button', { name: /展开 Block：interface User/ })).toBeVisible()
    await expect.poll(async () => parseRaw(await savedRaw(page)).metadata.foldedRanges).toHaveLength(1)

    await page.reload()
    await expect(page.getByRole('button', { name: /展开 Block：interface User/ })).toBeVisible()
    expect(parseRaw(await savedRaw(page)).content).toBe(parseRaw(fixture).content)
  })

  test('ignores and removes stale persisted ranges', async ({ page }) => {
    const fixture = note(
      [block('text', 'Still visible')],
      { foldedRanges: [{ from: 999, to: 1001 }] },
    )
    await loadFixture(page, fixture)

    await expect(page.locator('.block-fold-summary')).toHaveCount(0)
    await expect(page.locator('.cm-line').filter({ hasText: 'Still visible' })).toBeVisible()
    await expect.poll(async () => parseRaw(await savedRaw(page)).metadata.foldedRanges).toBeUndefined()
  })

  test('keeps preview and folded presentation mutually exclusive', async ({ page }) => {
    const fixture = note([block('markdown', '# Presentation\nBody')])
    await loadFixture(page, fixture)

    const host = page.locator('.editor-host')
    const line = page.locator('.cm-line').filter({ hasText: '# Presentation' })
    const [hostBox, lineBox] = await Promise.all([host.boundingBox(), line.boundingBox()])
    if (!hostBox || !lineBox) throw new Error('Unable to reveal toolbar')
    await page.mouse.move(hostBox.x + hostBox.width - 24, lineBox.y + 10)
    await page.getByRole('button', { name: '渲染此块' }).click()
    await expect(page.locator('.markdown-preview')).toBeVisible()
    await expect(page.locator('.block-fold-toggle')).toHaveCount(0)

    const previewBox = await page.locator('.markdown-preview').boundingBox()
    if (!previewBox) throw new Error('Preview not visible')
    await page.mouse.move(hostBox.x + hostBox.width - 24, previewBox.y + 10)
    await page.locator('.block-toolbar').getByRole('button', { name: '折叠此块' }).click()

    await expect(page.locator('.markdown-preview')).toHaveCount(0)
    await expect(page.locator('.block-fold-summary')).toBeVisible()
    await expect(page.locator('.block-fold-toggle.is-folded')).toBeVisible()
  })

  test('keyboard toggle and search reveal hidden source', async ({ page }) => {
    const fixture = note([
      block('text', 'Visible block'),
      block('markdown', '# Hidden target\nneedle-value'),
    ])
    await loadFixture(page, fixture)

    const target = page.locator('.cm-line').filter({ hasText: '# Hidden target' })
    await target.click()
    await page.keyboard.press(`${modifier}+Alt+BracketLeft`)
    await expect(page.locator('.block-fold-summary')).toBeVisible()

    await page.keyboard.press(`${modifier}+Shift+f`)
    const search = page.locator('.editor-search-field input').first()
    await search.fill('needle-value')
    await page.keyboard.press('Enter')

    await expect(page.locator('.block-fold-summary')).toHaveCount(0)
    await expect(page.locator('.cm-line').filter({ hasText: 'needle-value' })).toBeVisible()
  })

  test('remains usable in a narrow dark editor with reduced motion', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 720 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const fixture = note([block('markdown', '# Compact dark fold\nSecond line')])
    await loadFixture(page, fixture, { theme: 'dark' })

    const host = page.locator('.editor-host')
    await expect(host).toHaveCSS('color-scheme', 'dark')
    const toggle = page.locator('.block-fold-toggle').first()
    await expect(toggle.locator('.block-fold-chevron')).toHaveCSS('transition-duration', '0s')
    await toggle.click()

    const summary = page.locator('.block-fold-summary')
    await expect(summary).toBeVisible()
    const [hostBox, summaryBox] = await Promise.all([host.boundingBox(), summary.boundingBox()])
    expect(hostBox).not.toBeNull()
    expect(summaryBox).not.toBeNull()
    expect(summaryBox!.x).toBeGreaterThanOrEqual(hostBox!.x)
    expect(summaryBox!.x + summaryBox!.width).toBeLessThanOrEqual(hostBox!.x + hostBox!.width + 1)
  })
})
