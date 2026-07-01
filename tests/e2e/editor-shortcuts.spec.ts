import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function fixtureContent() {
  const created = '2026-07-01T10:38:41.565Z'
  const body = [
    `---block:markdown;auto=1;created=${created}`,
    '# Stream',
    '',
    'Drop plain text notes here.',
    `---block:json;auto=0;created=${created}`,
    '{"service":"api","ok":true}',
    `---block:sql;auto=0;created=${created}`,
    'select * from users where active = true',
    `---block:math;auto=0;created=${created}`,
    '2 + 2 * 10',
  ].join('\n')
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${body}`
}

async function loadFixture(page: Page) {
  await page.addInitScript((content) => {
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
  }, fixtureContent())
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

async function linePoint(page: Page, text: string, offset = 8) {
  const point = await page.evaluate(({ text, offset }) => {
    const line = Array.from(document.querySelectorAll('.cm-line'))
      .find((element) => (element.textContent || '').includes(text))
    if (!line) return null
    const rect = line.getBoundingClientRect()
    return { x: rect.left + offset, y: rect.top + rect.height / 2 }
  }, { text, offset })

  if (!point) throw new Error(`Line not found: ${text}`)
  return point
}

async function copySelection(page: Page) {
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await page.keyboard.press(`${modifier}+C`)
  return page.evaluate(() => navigator.clipboard.readText())
}

async function visibleEditorText(page: Page) {
  return page.locator('.cm-content').innerText()
}

async function hasVisibleSelectionHighlight(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('.cm-selectionLayer')
    const backgrounds = Array.from(document.querySelectorAll<HTMLElement>('.cm-selectionBackground'))
    if (!layer || backgrounds.length === 0) return false

    const layerZIndex = Number.parseInt(getComputedStyle(layer).zIndex || '0', 10)
    return layerZIndex > 0 && backgrounds.some((background) => {
      const rect = background.getBoundingClientRect()
      const color = getComputedStyle(background).backgroundColor
      return rect.width > 0 && rect.height > 0 && color !== 'rgba(0, 0, 0, 0)'
    })
  })
}

async function hasNaturalSelectionStyling(page: Page) {
  return page.evaluate(() => {
    const backgrounds = Array.from(document.querySelectorAll<HTMLElement>('.cm-selectionBackground'))
    if (backgrounds.length === 0) return false

    const selectionIsFlat = backgrounds.every((background) => {
      const style = getComputedStyle(background)
      return style.boxShadow === 'none' && style.borderRadius === '0px'
    })
    const activeLine = document.querySelector<HTMLElement>('.cm-activeLine')
    const activeLineBackground = activeLine ? getComputedStyle(activeLine).backgroundColor : 'rgba(0, 0, 0, 0)'

    return selectionIsFlat && activeLineBackground === 'rgba(0, 0, 0, 0)'
  })
}

async function hasNoVisibleSelectionHighlight(page: Page) {
  return page.evaluate(() => {
    return !Array.from(document.querySelectorAll<HTMLElement>('.cm-selectionBackground'))
      .some((background) => {
        const rect = background.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
  })
}

test.describe('editor text selection shortcuts', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:3344',
    })
    await loadFixture(page)
  })

  test('supports block-aware select all without copying hidden delimiters', async ({ page }) => {
    await clickLine(page, '# Stream')

    await page.keyboard.press(`${modifier}+A`)
    await expect.poll(() => hasVisibleSelectionHighlight(page)).toBe(true)
    await expect.poll(() => hasNaturalSelectionStyling(page)).toBe(true)
    await expect.poll(() => copySelection(page)).toBe('# Stream\n\nDrop plain text notes here.')

    await page.keyboard.press(`${modifier}+A`)
    await expect.poll(() => hasVisibleSelectionHighlight(page)).toBe(true)
    await expect.poll(() => hasNaturalSelectionStyling(page)).toBe(true)
    const copied = await copySelection(page)

    expect(copied).toContain('# Stream')
    expect(copied).toContain('{"service":"api","ok":true}')
    expect(copied).toContain('select * from users where active = true')
    expect(copied).toContain('2 + 2 * 10')
    expect(copied).not.toContain('---block:')

    await clickLine(page, 'select * from users', 40)
    await expect.poll(() => hasNoVisibleSelectionHighlight(page)).toBe(true)
  })

  test('does not reserve visible space for hidden block delimiters', async ({ page }) => {
    const layout = await page.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.cm-content')
      const firstVisibleLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => !line.classList.contains('block-delimiter-line') && (line.textContent || '').includes('# Stream'))
      const delimiterLines = Array.from(document.querySelectorAll<HTMLElement>('.cm-line.block-delimiter-line'))
      const delimiterGutters = Array.from(document.querySelectorAll<HTMLElement>('.cm-gutterElement.block-gutter-delimiter'))

      if (!content || !firstVisibleLine) return null

      return {
        firstLineOffset: firstVisibleLine.getBoundingClientRect().top - content.getBoundingClientRect().top,
        maxDelimiterHeight: Math.max(0, ...delimiterLines.map(line => line.getBoundingClientRect().height)),
        maxDelimiterGutterHeight: Math.max(0, ...delimiterGutters.map(gutter => gutter.getBoundingClientRect().height)),
      }
    })

    expect(layout).not.toBeNull()
    expect(layout!.firstLineOffset).toBeLessThanOrEqual(2)
    expect(layout!.maxDelimiterHeight).toBeLessThanOrEqual(1)
    expect(layout!.maxDelimiterGutterHeight).toBeLessThanOrEqual(1)
  })

  test('supports keyboard and mouse selection like a plain text editor', async ({ page }) => {
    await clickLine(page, '# Stream')

    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await expect.poll(() => hasVisibleSelectionHighlight(page)).toBe(true)
    await expect.poll(() => hasNaturalSelectionStyling(page)).toBe(true)
    await expect.poll(() => copySelection(page)).toBe('# ')

    const dragStart = await linePoint(page, 'Drop plain text', 8)
    const dragEnd = await linePoint(page, 'Drop plain text', 185)
    await page.mouse.move(dragStart.x, dragStart.y)
    await page.mouse.down()
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => hasVisibleSelectionHighlight(page)).toBe(true)
    await expect.poll(() => hasNaturalSelectionStyling(page)).toBe(true)
    await expect.poll(() => copySelection(page)).toBe('Drop plain text notes ')

    await clickLine(page, '# Stream')
    const word = await linePoint(page, 'Drop plain text', 55)
    await page.mouse.dblclick(word.x, word.y)
    await expect.poll(() => hasVisibleSelectionHighlight(page)).toBe(true)
    await expect.poll(() => hasNaturalSelectionStyling(page)).toBe(true)
    await expect.poll(() => copySelection(page)).toBe('plain')
  })

  test('supports cross-block mouse selection without exposing delimiters', async ({ page }) => {
    const dragStart = await linePoint(page, '# Stream', 8)
    const dragEnd = await linePoint(page, '{"service"', 160)

    await page.mouse.move(dragStart.x, dragStart.y)
    await page.mouse.down()
    await page.mouse.move(dragEnd.x, dragEnd.y, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => hasVisibleSelectionHighlight(page)).toBe(true)
    await expect.poll(() => hasNaturalSelectionStyling(page)).toBe(true)

    const copied = await copySelection(page)
    expect(copied).toContain('# Stream')
    expect(copied).toContain('Drop plain text notes here.')
    expect(copied).toContain('{"service":"api","o')
    expect(copied).not.toContain('---block:')
  })

  test('supports cut, paste, and undo while preserving hidden block structure', async ({ page }) => {
    await clickLine(page, '# Stream')
    const beforeCut = await visibleEditorText(page)

    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.press(`${modifier}+X`)

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe('# Stream\n\nDrop plain text notes here.')
    expect(clipboard).not.toContain('---block:')
    await expect(page.locator('.cm-content')).not.toContainText('# Stream')

    await page.keyboard.press(`${modifier}+Z`)
    await expect.poll(() => visibleEditorText(page)).toBe(beforeCut)

    await page.evaluate(() => navigator.clipboard.writeText('paste-smoke'))
    await clickLine(page, '# Stream')
    await page.keyboard.press(`${modifier}+V`)
    await expect(page.locator('.cm-content')).toContainText('paste-smoke')

    await page.keyboard.press(`${modifier}+Z`)
    await expect.poll(() => visibleEditorText(page)).toBe(beforeCut)

    const saved = await page.evaluate(() => {
      const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
      return buffers[0]?.content || ''
    })
    expect(saved).toContain('---block:markdown;')
    expect(saved).not.toContain('paste-smoke')
  })
})
