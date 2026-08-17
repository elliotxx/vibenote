import { expect, test, type Locator, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
const primaryClickModifier = process.platform === 'darwin' ? 'Meta' : 'Control'

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

async function visibleLineText(page: Page, containing: string) {
  return page.locator('.cm-line').filter({ hasText: containing }).first().innerText()
}

async function renderedLineBackground(page: Page, line: Locator) {
  const screenshot = await line.screenshot()
  return page.evaluate(async source => {
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    return Array.from(context.getImageData(image.width - 8, Math.floor(image.height / 2), 1, 1).data.slice(0, 3))
  }, `data:image/png;base64,${screenshot.toString('base64')}`)
}

async function renderedLineSamples(page: Page, line: Locator) {
  const screenshot = await line.screenshot()
  return page.evaluate(async source => {
    const image = new Image()
    image.src = source
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const sample = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data.slice(0, 3))
    const right = image.width - 8
    const middle = Math.floor(image.height / 2)
    return {
      leftCenter: sample(1, middle),
      rightCenter: sample(right, middle),
      rightTop: sample(right, 0),
    }
  }, `data:image/png;base64,${screenshot.toString('base64')}`)
}

function colorDistance(left: number[], right: number[]) {
  return Math.sqrt(left.reduce((sum, channel, index) => sum + (channel - right[index]) ** 2, 0))
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
    await expect(page.locator('.tok-quote')).toHaveCount(1)
    await expect(page.locator('.tok-link')).toHaveCount(1)
    await expect(page.locator('.tok-image')).toHaveCount(1)
    await expect(page.locator('.tok-code-block').first()).toBeVisible()
    await expect(page.locator('.markdown-task-checkbox')).toHaveCount(1)
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('highlights responsible-person mentions without styling address or code syntax', async ({ page }) => {
    const created = '2026-08-17T09:00:00.000Z'
    const chineseMention = '@\u8d1f\u8d23\u4eba\u7532'
    const fixture = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      `Owners ${chineseMention}, @alice-smith, and @user_01`,
      'Email owner@example.com and URL https://example.com/@route',
      'Inline `@inline-owner` and escaped \\@escaped-owner',
      '[profile](@link-owner) and ![avatar](@image-owner)',
      '```text',
      '@code-owner',
      '```',
      `---block:text;auto=0;created=${created}`,
      'Plain owner @plain-owner',
      `---block:javascript;auto=0;created=${created}`,
      '@decorator',
    ].join('\n')}`
    await loadFixture(page, fixture)

    await expect(page.locator('.tok-mention')).toHaveCount(4)
    await expect(page.locator('.tok-mention').allTextContents()).resolves.toEqual([
      chineseMention,
      '@alice-smith',
      '@user_01',
      '@plain-owner',
    ])
    const mentionStyle = await page.locator('.tok-mention').first().evaluate(element => {
      const style = window.getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        fontWeight: style.fontWeight,
        paddingLeft: style.paddingLeft,
      }
    })
    expect(mentionStyle).toMatchObject({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      fontWeight: '550',
      paddingLeft: '0px',
    })
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('colors uppercase priority markers without styling code or partial tokens', async ({ page }) => {
    const created = '2026-08-17T13:00:00.000Z'
    const fixture = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      'Priorities P0 P1 P2 P3',
      'Ignore p0 P4 P01 XP0 P0Task',
      'Inline `P0` and [linked P1](https://example.com)',
      '```text',
      'P2',
      '```',
      `---block:text;auto=0;created=${created}`,
      'Plain priority P3',
      `---block:javascript;auto=0;created=${created}`,
      'const priority = "P0"',
    ].join('\n')}`
    await loadFixture(page, fixture)

    await expect(page.locator('.tok-priority')).toHaveCount(5)
    await expect(page.locator('.tok-priority').allTextContents()).resolves.toEqual(['P0', 'P1', 'P2', 'P3', 'P3'])
    for (const priority of ['p0', 'p1', 'p2', 'p3']) {
      await expect(page.locator(`.tok-priority-${priority}`)).toHaveCount(priority === 'p3' ? 2 : 1)
    }

    const styles = await page.locator('.tok-priority').evaluateAll(elements => elements.map((element) => {
      const style = window.getComputedStyle(element)
      return {
        color: style.color,
        backgroundColor: style.backgroundColor,
        fontWeight: style.fontWeight,
      }
    }))
    expect(new Set(styles.slice(0, 4).map(style => style.color)).size).toBe(4)
    expect(styles.every(style => style.backgroundColor === 'rgba(0, 0, 0, 0)')).toBe(true)
    expect(styles.every(style => style.fontWeight === '600')).toBe(true)
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('optionally emphasizes priority lines without changing note content', async ({ page }) => {
    const created = '2026-08-17T09:00:00.000Z'
    const fixture = `${markdownFixture([
      'Critical task P0',
      'Important task P1',
      'Planned task P2',
      'Someday task P3',
      'Mixed task P2 then P0',
      'Inline `P0` remains ordinary',
      'Another ordinary line',
    ])}\n${[
      `---block:markdown;auto=0;created=${created}`,
      'Regular block line',
      'Regular block sibling',
    ].join('\n')}`
    await loadFixture(page, fixture)

    const editor = page.locator('.cm-editor')
    const criticalLine = page.locator('.cm-line').filter({ hasText: 'Critical task' })
    await expect(editor).not.toHaveClass(/priority-line-emphasis/)
    await expect(criticalLine).toHaveCSS('background-image', 'none')

    await page.keyboard.press(`${modifier}+,`)
    const toggle = page.getByRole('checkbox', { name: '优先级行强调' })
    await expect(toggle).not.toBeChecked()
    await toggle.check()

    await expect(editor).toHaveClass(/priority-line-emphasis/)
    await expect(criticalLine).toHaveClass(/priority-line-p0/)
    await expect(page.locator('.cm-line').filter({ hasText: 'Important task' })).toHaveClass(/priority-line-p1/)
    await expect(page.locator('.cm-line').filter({ hasText: 'Planned task' })).toHaveClass(/priority-line-p2/)
    await expect(page.locator('.cm-line').filter({ hasText: 'Someday task' })).toHaveClass(/priority-line-p3/)
    await expect(page.locator('.cm-line').filter({ hasText: 'Mixed task' })).toHaveClass(/priority-line-p0/)
    await expect(page.locator('.cm-line').filter({ hasText: 'remains ordinary' })).not.toHaveClass(/priority-line-p0/)
    await expect(criticalLine).toHaveCSS('background-image', 'none')

    await page.keyboard.press(`${modifier}+,`)
    await clickLine(page, 'Another ordinary line')
    await expect(editor).toHaveClass(/priority-line-emphasis/)
    const activeOrdinaryLine = page.locator('.cm-line').filter({ hasText: 'Another ordinary line' })
    await expect(activeOrdinaryLine).toHaveClass(/priority-block-line/)
    const ordinaryColor = await renderedLineBackground(
      page,
      page.locator('.cm-line').filter({ hasText: 'remains ordinary' }),
    )
    const activeOrdinaryColor = await renderedLineBackground(page, activeOrdinaryLine)
    expect(colorDistance(activeOrdinaryColor, ordinaryColor)).toBeLessThanOrEqual(1)
    const activeOrdinarySamples = await renderedLineSamples(page, activeOrdinaryLine)
    expect(colorDistance(activeOrdinarySamples.leftCenter, activeOrdinarySamples.rightCenter)).toBeGreaterThanOrEqual(20)
    expect(colorDistance(activeOrdinarySamples.rightTop, activeOrdinarySamples.rightCenter)).toBeLessThanOrEqual(2)

    const priorityColors = await Promise.all([
      renderedLineBackground(page, criticalLine),
      renderedLineBackground(page, page.locator('.cm-line').filter({ hasText: 'Important task' })),
      renderedLineBackground(page, page.locator('.cm-line').filter({ hasText: 'Planned task' })),
      renderedLineBackground(page, page.locator('.cm-line').filter({ hasText: 'Someday task' })),
    ])
    const priorityDistances = priorityColors.map(color => colorDistance(color, ordinaryColor))
    expect(priorityDistances[0]).toBeGreaterThanOrEqual(18)
    expect(priorityDistances[1]).toBeGreaterThanOrEqual(16)
    expect(priorityDistances[2]).toBeGreaterThanOrEqual(12)
    expect(priorityDistances[3]).toBeGreaterThanOrEqual(7)
    expect(colorDistance(priorityColors[0], priorityColors[1])).toBeGreaterThanOrEqual(12)
    expect(colorDistance(priorityColors[1], priorityColors[2])).toBeGreaterThanOrEqual(12)
    expect(colorDistance(priorityColors[2], priorityColors[3])).toBeGreaterThanOrEqual(8)

    await clickLine(page, 'Critical task')
    const activePriorityColor = await renderedLineBackground(page, criticalLine)
    expect(colorDistance(activePriorityColor, priorityColors[0])).toBeLessThanOrEqual(1)
    const activePrioritySamples = await renderedLineSamples(page, criticalLine)
    expect(colorDistance(activePrioritySamples.leftCenter, activePrioritySamples.rightCenter)).toBeGreaterThanOrEqual(20)
    expect(colorDistance(activePrioritySamples.rightTop, activePrioritySamples.rightCenter)).toBeLessThanOrEqual(2)
    const activeGutter = page.locator('.cm-lineNumbers .cm-gutterElement.cm-activeLineGutter')
    const adjacentGutter = page.locator('.cm-lineNumbers .cm-gutterElement').filter({ hasText: '2' }).first()
    const adjacentGutterColor = await adjacentGutter.evaluate(element => window.getComputedStyle(element).backgroundColor)
    await expect(activeGutter).toHaveCSS('background-color', adjacentGutterColor)
    await expect(activeGutter).toHaveCSS('font-weight', '700')

    const regularLine = page.locator('.cm-line').filter({ hasText: 'Regular block line' })
    const regularSibling = page.locator('.cm-line').filter({ hasText: 'Regular block sibling' })
    await expect(regularLine).not.toHaveClass(/priority-block-line/)
    await clickLine(page, 'Regular block line')
    const activeRegularColor = await renderedLineBackground(page, regularLine)
    const inactiveRegularColor = await renderedLineBackground(page, regularSibling)
    expect(colorDistance(activeRegularColor, inactiveRegularColor)).toBeGreaterThanOrEqual(20)
    const activeRegularSamples = await renderedLineSamples(page, regularLine)
    expect(colorDistance(activeRegularSamples.leftCenter, activeRegularSamples.rightCenter)).toBeLessThanOrEqual(2)

    await expect.poll(() => page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('vibenote:settings') || '{}')
      return settings.priorityLineEmphasis
    })).toBe(true)
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('wraps selections and toggles list prefixes with markdown shortcuts', async ({ page }) => {
    await loadFixture(page, markdownFixture(['bold text']))
    await clickLine(page, 'bold text')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+B`)
    await expect.poll(() => savedContent(page)).toContain('**bold text**')
    await expect(page.locator('.tok-strong-marker')).toHaveCount(2)
    await page.keyboard.press('End')
    await expect(page.locator('.tok-strong-marker')).toHaveCount(0)
    await expect(page.locator('.tok-strong')).toHaveText('bold text')

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

  test('previews strong text and reveals only the fragments touched by the selection', async ({ page }) => {
    const fixture = markdownFixture(['before **one** and **two** after'])
    await loadFixture(page, fixture)

    await expect(page.locator('.tok-strong')).toHaveCount(2)
    await expect(page.locator('.tok-strong-marker')).toHaveCount(0)
    await expect.poll(() => visibleLineText(page, 'before')).toBe('before one and two after')

    await page.locator('.tok-strong').nth(1).click()
    await expect(page.locator('.tok-strong-marker')).toHaveCount(2)
    await expect.poll(() => visibleLineText(page, 'before')).toBe('before one and **two** after')

    await page.keyboard.down('Alt')
    await page.locator('.tok-strong').first().click()
    await page.keyboard.up('Alt')
    await expect(page.locator('.tok-strong-marker')).toHaveCount(4)
    await expect.poll(() => visibleLineText(page, 'before')).toBe('before **one** and **two** after')

    await page.keyboard.press('End')
    await expect(page.locator('.tok-strong-marker')).toHaveCount(0)
    await expect.poll(() => visibleLineText(page, 'before')).toBe('before one and two after')
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('keeps markdown source available to copy and search', async ({ context, page }) => {
    const fixture = markdownFixture(['before **bold** after'])
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:3344',
    })
    await loadFixture(page, fixture)

    await clickLine(page, 'before')
    await page.keyboard.press(`${modifier}+A`)
    await page.evaluate(() => navigator.clipboard.writeText(''))
    await page.keyboard.press(`${modifier}+C`)
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('before **bold** after')

    await page.keyboard.press(`${modifier}+F`)
    await page.keyboard.type('**bold**')
    await expect(page.locator('.editor-search-count')).toHaveText('1 / 1')
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('does not partially preview unsupported or non-markdown strong syntax', async ({ page }) => {
    const created = '2026-07-02T09:00:00.000Z'
    const fixture = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      'valid **bold**',
      '\\**escaped**',
      '`**code**`',
      '***triple***',
      '__underscore__',
      '**unclosed',
      `---block:text;auto=0;created=${created}`,
      '**plain block**',
    ].join('\n')}`
    await loadFixture(page, fixture)

    await expect(page.locator('.tok-strong')).toHaveCount(1)
    await expect.poll(() => visibleLineText(page, 'valid')).toBe('valid bold')
    await expect.poll(() => visibleLineText(page, 'escaped')).toBe('\\**escaped**')
    await expect.poll(() => visibleLineText(page, 'code')).toBe('`**code**`')
    await expect.poll(() => visibleLineText(page, 'triple')).toBe('***triple***')
    await expect.poll(() => visibleLineText(page, 'underscore')).toBe('__underscore__')
    await expect.poll(() => visibleLineText(page, 'unclosed')).toBe('**unclosed')
    await expect.poll(() => visibleLineText(page, 'plain block')).toBe('**plain block**')
    await expect.poll(() => savedContent(page)).toBe(fixture)
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

  test('opens markdown links only with the primary click modifier', async ({ page }) => {
    const fixture = markdownFixture(['Read [docs](https://example.com/docs) before shipping.'])
    await loadFixture(page, fixture)
    await page.evaluate(() => {
      ;(window as any).__openedExternal = []
      ;(window.vibenote as any).shell = {
        openExternal: async (url: string) => {
          ;(window as any).__openedExternal.push(url)
          return true
        },
      }
    })

    const link = page.locator('.tok-link').first()
    await expect(link).toBeVisible()

    await link.click()
    await expect.poll(() => page.evaluate(() => (window as any).__openedExternal)).toEqual([])

    await link.click({ modifiers: [primaryClickModifier] })
    await expect.poll(() => page.evaluate(() => (window as any).__openedExternal)).toEqual(['https://example.com/docs'])
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

})
