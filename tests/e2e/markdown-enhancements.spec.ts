import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function markdownFixture(lines: string[]) {
  const created = '2026-07-02T09:00:00.000Z'
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    ...lines,
  ].join('\n')}`
}

async function loadFixture(page: Page, content: string) {
  await page.addInitScript((content) => {
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
  }, content)
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function clickLine(page: Page, text: string, offset = 8) {
  const point = await page.evaluate(({ text, offset }) => {
    const line = Array.from(document.querySelectorAll('.cm-line'))
      .find((element) => (element.textContent || '').includes(text))
    if (!line) return null
    const rect = line.getBoundingClientRect()
    return { x: rect.left + offset, y: rect.top + rect.height / 2 }
  }, { text, offset })

  if (!point) throw new Error(`Line not found: ${text}`)
  await page.mouse.click(point.x, point.y)
}

async function savedContent(page: Page) {
  return page.evaluate(() => {
    const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
    return buffers[0]?.content || ''
  })
}

test.describe('markdown block writing enhancements', () => {
  test('highlights common markdown syntax while keeping the block as plain text', async ({ page }) => {
    const fixture = markdownFixture([
      '# Heading',
      '- list item',
      '1. ordered item',
      '- [ ] task item',
      '> quoted note',
      '[docs](https://example.com)',
      '![diagram](relative-image.png)',
      '---',
      '```ts',
      'const value = true',
      '```',
    ])
    await loadFixture(page, fixture)

    await expect(page.locator('.tok-heading')).toHaveCount(1)
    await expect(page.locator('.tok-list')).toHaveCount(2)
    await expect(page.locator('.tok-task')).toHaveCount(1)
    await expect(page.locator('.tok-quote')).toHaveCount(1)
    await expect(page.locator('.tok-link')).toHaveCount(1)
    await expect(page.locator('.tok-image')).toHaveCount(1)
    await expect(page.locator('.tok-hr')).toHaveCount(1)
    await expect(page.locator('.tok-code-block').first()).toBeVisible()
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('wraps selections and toggles list prefixes with markdown shortcuts', async ({ page }) => {
    await loadFixture(page, markdownFixture(['bold text']))
    await clickLine(page, 'bold text')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+B`)
    await expect.poll(() => savedContent(page)).toContain('**bold text**')

    await page.goto('about:blank')
    await loadFixture(page, markdownFixture(['italic text']))
    await clickLine(page, 'italic text')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+I`)
    await expect.poll(() => savedContent(page)).toContain('*italic text*')

    await page.goto('about:blank')
    await loadFixture(page, markdownFixture(['link text']))
    await clickLine(page, 'link text')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+K`)
    await expect.poll(() => savedContent(page)).toContain('[link text](url)')

    await page.goto('about:blank')
    await loadFixture(page, markdownFixture(['list me']))
    await clickLine(page, 'list me')
    await page.keyboard.press(`${modifier}+Shift+8`)
    await expect.poll(() => savedContent(page)).toContain('- list me')

    await page.goto('about:blank')
    await loadFixture(page, markdownFixture(['ordered me']))
    await clickLine(page, 'ordered me')
    await page.keyboard.press(`${modifier}+Shift+7`)
    await expect.poll(() => savedContent(page)).toContain('1. ordered me')
  })

  test('continues and exits markdown lists from the Enter key', async ({ page }) => {
    await loadFixture(page, markdownFixture(['- first']))
    await clickLine(page, 'first', 80)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')
    await expect.poll(() => savedContent(page)).toContain('- first\n- second')

    await page.goto('about:blank')
    await loadFixture(page, markdownFixture(['1. first']))
    await clickLine(page, 'first', 90)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('second')
    await expect.poll(() => savedContent(page)).toContain('1. first\n2. second')

    await page.goto('about:blank')
    await loadFixture(page, markdownFixture(['- first']))
    await clickLine(page, 'first', 80)
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('after')
    await expect.poll(() => savedContent(page)).toContain('- first\nafter')
    await expect.poll(() => savedContent(page)).not.toContain('- after')
  })

  test('toggles task list checkboxes without leaving plain text markdown', async ({ page }) => {
    await loadFixture(page, markdownFixture(['- [ ] task item']))

    const checkbox = page.locator('.markdown-task-checkbox').first()
    await expect(checkbox).toBeVisible()
    await expect(checkbox).not.toBeChecked()

    await checkbox.click()
    await expect(checkbox).toBeChecked()
    await expect.poll(() => savedContent(page)).toContain('- [x] task item')

    await checkbox.click()
    await expect(checkbox).not.toBeChecked()
    await expect.poll(() => savedContent(page)).toContain('- [ ] task item')
  })
})
