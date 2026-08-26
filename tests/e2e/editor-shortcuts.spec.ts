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

function imageFixtureContent() {
  const created = '2026-07-01T10:38:41.565Z'
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    'Image note',
    '![image](</tmp/vibenote-e2e-image.png>)',
    'After image',
  ].join('\n')}`
}

function legacyImageFixtureContent() {
  const created = '2026-07-01T10:38:41.565Z'
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    'Legacy image note',
    '![image](vibenote-image://2026-07-01T13-18-21-285Z.png)',
    'After legacy image',
  ].join('\n')}`
}

async function loadFixture(page: Page, content = fixtureContent()) {
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

async function lineColumnPoint(page: Page, text: string, column: number) {
  const point = await page.evaluate(({ text, column }) => {
    const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
      .find(element => (element.textContent || '').includes(text))
    if (!line) return null

    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let remaining = column
    let node = walker.nextNode()
    while (node) {
      const length = node.textContent?.length || 0
      if (remaining <= length) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.collapse(true)
        const rect = range.getBoundingClientRect()
        return { x: rect.left, y: rect.top + rect.height / 2 }
      }
      remaining -= length
      node = walker.nextNode()
    }
    return null
  }, { text, column })

  if (!point) throw new Error(`Line or column not found: ${text}:${column}`)
  return point
}

async function hoverEditorTopRight(page: Page) {
  const host = page.locator('.editor-host')
  const box = await host.boundingBox()
  if (!box) throw new Error('Editor host not found')
  const point = { x: box.x + box.width - 24, y: box.y + 24 }
  const isInsideHost = await page.evaluate(({ x, y }) => {
    return Boolean(document.elementFromPoint(x, y)?.closest('.editor-host'))
  }, point)
  if (!isInsideHost) throw new Error(`Top-right point is outside editor host: ${JSON.stringify(point)}`)
  await page.mouse.move(point.x, point.y)
}

async function hoverBlockTopRight(page: Page, text: string) {
  const point = await page.evaluate((text) => {
    const host = document.querySelector<HTMLElement>('.editor-host')
    const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
      .find(element => (element.textContent || '').includes(text))
    if (!host || !line) return null
    const hostRect = host.getBoundingClientRect()
    const lineRect = line.getBoundingClientRect()
    return { x: hostRect.right - 24, y: lineRect.top + 12 }
  }, text)

  if (!point) throw new Error(`Block line not found: ${text}`)
  await page.mouse.move(point.x, point.y)
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

    const selectionIsContinuous = backgrounds.every((background) => {
      const style = getComputedStyle(background)
      return (
        style.boxShadow === 'none' &&
        style.borderRadius === '0px' &&
        (style.clipPath === 'none' || style.clipPath === '')
      )
    })
    const activeLine = document.querySelector<HTMLElement>('.cm-activeLine')
    const activeLineBackground = activeLine ? getComputedStyle(activeLine).backgroundColor : 'rgba(0, 0, 0, 0)'

    return selectionIsContinuous && activeLineBackground !== 'rgba(0, 0, 0, 0)'
  })
}

async function multilineSelectionReachesRightEdge(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')
    const fills = Array.from(document.querySelectorAll<HTMLElement>('.selection-right-fill'))
    if (!scroller || fills.length === 0) return false

    const rightEdge = scroller.getBoundingClientRect().left + scroller.clientWidth
    return fills.every((fill) => {
      const rect = fill.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && Math.abs(rect.right - rightEdge) <= 2
    })
  })
}

async function selectionHasUniformColorAndVisibleEndpoint(page: Page) {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('.cm-scroller')
    const selectionBackgrounds = Array.from(
      document.querySelectorAll<HTMLElement>('.cm-selectionBackground, .selection-right-fill'),
    )
    const terminalBackground = document.querySelector<HTMLElement>(
      '.cm-selectionBackground.selection-terminal-line',
    )
    if (!scroller || !terminalBackground || selectionBackgrounds.length < 2) {
      return false
    }

    const selectionColors = new Set(
      selectionBackgrounds.map(background => getComputedStyle(background).backgroundColor),
    )
    const terminalRect = terminalBackground.getBoundingClientRect()
    const overlappingFill = Array.from(
      document.querySelectorAll<HTMLElement>('.selection-right-fill'),
    ).some((fill) => {
      const rect = fill.getBoundingClientRect()
      return rect.bottom > terminalRect.top + 1 && rect.top < terminalRect.bottom - 1
    })

    const rightEdge = scroller.getBoundingClientRect().left + scroller.clientWidth
    return selectionColors.size === 1 &&
      terminalRect.right < rightEdge - 20 &&
      !overlappingFill
  })
}

async function wrappedSelectionUsesUniformActiveOverlay(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.cm-editor')
    const activeLine = document.querySelector<HTMLElement>('.cm-line.cm-activeLine')
    const backgrounds = Array.from(
      document.querySelectorAll<HTMLElement>('.cm-selectionBackground'),
    )
    if (!editor || !activeLine || backgrounds.length < 2) return false

    const lineRect = activeLine.getBoundingClientRect()
    const lineHeight = Number.parseFloat(getComputedStyle(activeLine).lineHeight)
    const probe = document.createElement('div')
    document.body.append(probe)
    probe.style.background = activeLine.classList.contains('block-odd')
      ? 'var(--surface-block-alt)'
      : 'var(--surface-editor)'
    const expectedLineBackground = getComputedStyle(probe).backgroundColor
    probe.remove()
    const colors = new Set(backgrounds.map(background => (
      getComputedStyle(background).backgroundColor
    )))

    return editor.classList.contains('has-text-selection') &&
      getComputedStyle(activeLine).backgroundColor === expectedLineBackground &&
      lineRect.height > lineHeight * 2 &&
      colors.size === 1
  })
}

async function activeLineHighlightIsRestored(page: Page) {
  return page.evaluate(() => {
    const editor = document.querySelector<HTMLElement>('.cm-editor')
    const activeLine = document.querySelector<HTMLElement>('.cm-line.cm-activeLine')
    if (!editor || !activeLine) return false

    const probe = document.createElement('div')
    document.body.append(probe)
    probe.style.background = 'var(--active-line-bg)'
    const expectedBackground = getComputedStyle(probe).backgroundColor
    probe.remove()

    return !editor.classList.contains('has-text-selection') &&
      getComputedStyle(activeLine).backgroundColor === expectedBackground
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

async function hasVisibleCursor(page: Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('.cm-cursorLayer')
    const cursor = document.querySelector<HTMLElement>('.cm-cursor')
    if (!layer || !cursor) return false
    const layerStyle = getComputedStyle(layer)
    const cursorStyle = getComputedStyle(cursor)
    const rect = cursor.getBoundingClientRect()
    return layerStyle.opacity !== '0' &&
      cursorStyle.display !== 'none' &&
      rect.width > 0 &&
      rect.height > 0
  })
}

async function hasVisibleImageCursor(page: Page, side: 'left' | 'right') {
  return page.evaluate((side) => {
    const image = document.querySelector<HTMLElement>(`.image-widget-cursor-${side}`)
    if (!image) return false
    const style = getComputedStyle(image, side === 'left' ? '::before' : '::after')
    return style.content !== 'none' &&
      style.opacity !== '0' &&
      style.backgroundColor !== 'rgba(0, 0, 0, 0)'
  }, side)
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
    await expect.poll(() => multilineSelectionReachesRightEdge(page)).toBe(true)
    await expect.poll(() => selectionHasUniformColorAndVisibleEndpoint(page)).toBe(true)
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

  test('inserts four spaces when pressing Tab with default settings', async ({ page }) => {
    await clickLine(page, 'Drop plain text notes here.')
    await page.keyboard.press('Home')
    await page.keyboard.press('Tab')

    const lineText = await page.locator('.cm-line')
      .filter({ hasText: 'Drop plain text notes here.' })
      .textContent()
    expect(lineText).toBe('    Drop plain text notes here.')
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

  test('keeps arithmetic-like notes out of auto math mode', async ({ page }) => {
    await clickLine(page, '# Stream')
    await page.keyboard.press(`${modifier}+A`)
    await page.keyboard.type('1+1')

    await expect(page.locator('.math-result')).toHaveCount(1)
    const mathResults = await page.locator('.math-result').allTextContents()
    expect(mathResults).not.toContain(' = 2')

    const saved = await page.evaluate(() => {
      const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
      return buffers[0]?.content || ''
    })
    expect(saved).toContain('---block:markdown;auto=1;')
    expect(saved).not.toContain('---block:math;auto=1;')
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

  test('keeps selection color uniform across a wrapped active line', async ({ page }) => {
    const created = '2026-07-01T10:38:41.565Z'
    const longLine = 'Wrapped selection text stays readable and visually consistent. '.repeat(8)
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      longLine,
    ].join('\n')}`

    await page.setViewportSize({ width: 640, height: 600 })
    await page.goto('about:blank')
    await loadFixture(page, content)

    const start = await lineColumnPoint(page, 'Wrapped selection text', 4)
    const end = await lineColumnPoint(page, 'Wrapped selection text', 220)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 12 })
    await page.mouse.up()

    await expect.poll(() => wrappedSelectionUsesUniformActiveOverlay(page)).toBe(true)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => activeLineHighlightIsRestored(page)).toBe(true)
  })

  test('highlights other occurrences of the selected word', async ({ page }) => {
    const created = '2026-07-01T10:38:41.565Z'
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      'alpha one',
      'plain alpha',
      'alphabets',
      `---block:markdown;auto=1;created=${created}`,
      'alpha two',
    ].join('\n')}`
    await page.goto('about:blank')
    await loadFixture(page, content)

    const word = await lineColumnPoint(page, 'alpha one', 2)
    await page.mouse.dblclick(word.x, word.y)
    await expect.poll(() => copySelection(page)).toBe('alpha')
    await expect(page.locator('.cm-selectionMatch')).toHaveCount(2)
    await expect(page.locator('.cm-line', { hasText: 'alphabets' }).locator('.cm-selectionMatch')).toHaveCount(0)

    const start = await lineColumnPoint(page, 'alphabets', 0)
    const end = await lineColumnPoint(page, 'alphabets', 3)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => copySelection(page)).toBe('alp')
    await expect(page.locator('.cm-selectionMatch')).toHaveCount(3)
  })

  test('adds multiple cursors with Option-click', async ({ page }) => {
    const first = await lineColumnPoint(page, '# Stream', 1)
    const second = await lineColumnPoint(page, 'Drop plain text notes here.', 1)

    await page.mouse.click(first.x, first.y)
    await page.keyboard.down('Alt')
    await page.mouse.click(second.x, second.y)
    await page.keyboard.up('Alt')

    await expect(page.locator('.cm-cursor')).toHaveCount(2)
    await page.keyboard.type('X')
    await expect(page.locator('.cm-content')).toContainText('#X Stream')
    await expect(page.locator('.cm-content')).toContainText('DXrop plain text notes here.')
  })

  test('replaces a rectangular Option-drag selection on every covered line', async ({ page }) => {
    const created = '2026-07-01T10:38:41.565Z'
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      'alpha one',
      'bravo two',
      'charlie three',
    ].join('\n')}`
    await page.goto('about:blank')
    await loadFixture(page, content)

    const start = await lineColumnPoint(page, 'alpha one', 1)
    const end = await lineColumnPoint(page, 'charlie three', 5)
    await page.keyboard.down('Alt')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Alt')

    await expect(page.locator('.cm-selectionBackground')).toHaveCount(3)
    await expect.poll(() => copySelection(page)).toBe('lpha\nravo\nharl')

    await page.keyboard.type('X')
    await expect(page.locator('.cm-content')).toContainText('aX one')
    await expect(page.locator('.cm-content')).toContainText('bX two')
    await expect(page.locator('.cm-content')).toContainText('cXie three')
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

  test('supports selecting and editing pasted image markdown', async ({ page }) => {
    await page.goto('about:blank')
    await loadFixture(page, imageFixtureContent())

    const image = page.locator('.image-widget').first()
    await expect(image).toBeVisible()

    await image.click()
    await expect.poll(() => hasNoVisibleSelectionHighlight(page)).toBe(true)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => copySelection(page)).toBe('![image](</tmp/vibenote-e2e-image.png>)')

    await page.keyboard.press('Delete')
    await expect(page.locator('.image-widget')).toHaveCount(0)
    await expect(page.locator('.cm-content')).not.toContainText('![image](</tmp/vibenote-e2e-image.png>)')

    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('.image-widget')).toHaveCount(1)

    await image.click()
    await page.evaluate(() => navigator.clipboard.writeText('replacement image line'))
    await page.keyboard.press(`${modifier}+V`)
    await expect(page.locator('.cm-content')).toContainText('replacement image line')
    await expect(page.locator('.image-widget')).toHaveCount(0)

    await page.keyboard.press(`${modifier}+Z`)
    await expect(page.locator('.image-widget')).toHaveCount(1)

    await image.dblclick()
    await expect(page.locator('.cm-content')).toContainText('![image](</tmp/vibenote-e2e-image.png>)')
    await expect(page.locator('.image-widget')).toHaveCount(0)
    await expect.poll(() => hasVisibleCursor(page)).toBe(true)

    await clickLine(page, 'After image')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect(page.locator('.cm-content')).not.toContainText('![image](</tmp/vibenote-e2e-image.png>)')
  })

  test('normalizes legacy image urls to absolute paths', async ({ page }) => {
    await page.goto('about:blank')
    await loadFixture(page, legacyImageFixtureContent())

    await expect(page.locator('.image-widget')).toHaveCount(1)

    const saved = await page.evaluate(() => {
      const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
      return buffers[0]?.content || ''
    })
    expect(saved).toContain('![image](</tmp/vibenote-images/2026-07-01T13-18-21-285Z.png>)')
    expect(saved).not.toContain('vibenote-image://')
  })

  test('reveals the cursor around a focused image with arrow keys', async ({ page }) => {
    await page.goto('about:blank')
    await loadFixture(page, imageFixtureContent())

    const image = page.locator('.image-widget').first()
    await image.click()
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(true)
    await expect(page.locator('.cm-content')).not.toContainText('![image](</tmp/vibenote-e2e-image.png>)')

    await page.keyboard.press('Enter')
    await page.keyboard.type('after arrow image')
    await expect(page.locator('.cm-content')).toContainText('after arrow image')

    await page.goto('about:blank')
    await loadFixture(page, imageFixtureContent())
    await page.locator('.image-widget').first().click()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(true)
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'left')).toBe(true)

    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'left')).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(true)

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'left')).toBe(true)

    await page.goto('about:blank')
    await loadFixture(page, imageFixtureContent())
    await page.locator('.image-widget').first().click()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(true)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(false)
    await page.keyboard.type('next-line ')
    await expect(page.locator('.cm-content')).toContainText('next-line After image')
    await expect(page.locator('.cm-content')).not.toContainText('![image](</tmp/vibenote-e2e-image.png>)')

    await page.goto('about:blank')
    await loadFixture(page, imageFixtureContent())
    await clickLine(page, 'After image')
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(true)

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'left')).toBe(true)

    await page.goto('about:blank')
    await loadFixture(page, imageFixtureContent())
    await clickLine(page, 'After image')
    await page.keyboard.press('End')
    for (let i = 0; i < 'After image'.length; i += 1) {
      await page.keyboard.press('ArrowLeft')
    }
    await expect.poll(() => hasVisibleCursor(page)).toBe(true)

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(true)

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'right')).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'left')).toBe(true)

    await page.goto('about:blank')
    await loadFixture(page, imageFixtureContent())
    await page.locator('.image-widget').first().click()
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(false)
    await expect.poll(() => hasVisibleImageCursor(page, 'left')).toBe(true)
    await expect(page.locator('.cm-content')).not.toContainText('![image](</tmp/vibenote-e2e-image.png>)')

    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.image-widget')).toHaveCount(1)
    await expect.poll(() => hasVisibleCursor(page)).toBe(true)
    await expect.poll(() => hasVisibleImageCursor(page, 'left')).toBe(false)
    await page.keyboard.type(' tail')
    await expect(page.locator('.cm-content')).toContainText('Image note tail')
    await expect(page.locator('.cm-content')).not.toContainText('![image](</tmp/vibenote-e2e-image.png>)')
  })

  test('keeps status actions visible at max editor font size', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 520 })
    await page.addInitScript(() => {
      localStorage.setItem('vibenote:settings', JSON.stringify({
        theme: 'light',
        fontSize: 48,
        tabSize: 2,
        defaultLanguage: 'markdown',
      }))
    })
    await loadFixture(page)

    const actions = page.locator('.statusbar-actions .status-icon-button')
    await expect(actions).toHaveCount(3)
    for (let index = 0; index < 3; index += 1) {
      await expect(actions.nth(index)).toBeVisible()
    }

    const layout = await page.evaluate(() => {
      const viewportWidth = window.innerWidth
      const footer = document.querySelector<HTMLElement>('.statusbar')?.getBoundingClientRect()
      const boxes = Array.from(document.querySelectorAll<HTMLElement>('.statusbar-actions .status-icon-button'))
        .map(button => button.getBoundingClientRect())
      return {
        viewportWidth,
        footerRight: footer?.right ?? 0,
        actionRights: boxes.map(box => box.right),
      }
    })

    expect(layout.footerRight).toBeLessThanOrEqual(layout.viewportWidth)
    expect(Math.max(...layout.actionRights)).toBeLessThanOrEqual(layout.viewportWidth)
  })

  test('keeps routine autosave feedback hidden while typing', async ({ page }) => {
    await loadFixture(page)
    await clickLine(page, 'Drop plain text notes here.')
    await page.keyboard.press('End')

    const statusFeedback = page.locator('.statusbar-center .status-feedback')
    await page.keyboard.type(' continuously typing', { delay: 80 })
    await expect(statusFeedback).toHaveCount(0)

    await page.waitForTimeout(500)
    await expect(statusFeedback).toHaveCount(0)
    await expect(page.locator('.cm-content')).toContainText('Drop plain text notes here. continuously typing')
  })

  test('reveals block actions only while scrolling or hovering the top-right hot zone', async ({ page }) => {
    await loadFixture(page)

    const toolbar = page.locator('.block-toolbar')
    await expect(toolbar).toHaveCount(0)

    await hoverEditorTopRight(page)
    await expect(toolbar).toBeVisible()
    await expect(toolbar.locator('.block-action-button')).toHaveCount(7)
    await page.waitForTimeout(500)
    await expect(toolbar).toBeVisible()

    const toolbarBox = await toolbar.boundingBox()
    expect(toolbarBox).not.toBeNull()
    await page.mouse.move(
      toolbarBox!.x + toolbarBox!.width / 2,
      toolbarBox!.y + toolbarBox!.height / 2,
      { steps: 8 },
    )
    await page.waitForTimeout(300)
    await expect(toolbar).toBeVisible()

    const hostBox = await page.locator('.editor-host').boundingBox()
    expect(hostBox).not.toBeNull()
    await page.mouse.move(hostBox!.x + hostBox!.width / 2, hostBox!.y + hostBox!.height / 2)
    await expect(toolbar).toHaveCount(0)

    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')
      if (!scroller) throw new Error('Missing editor scroller')
      scroller.scrollTop = 40
      scroller.dispatchEvent(new Event('scroll'))
    })
    await expect(toolbar).toBeVisible()
    await expect(toolbar).toHaveCount(0, { timeout: 2_000 })
  })

  test('reveals block actions from the active block top-right corner', async ({ page }) => {
    await loadFixture(page)
    await clickLine(page, '2 + 2 * 10')

    const toolbar = page.locator('.block-toolbar')
    await expect(toolbar).toHaveCount(0)

    await hoverBlockTopRight(page, '2 + 2 * 10')
    await expect(toolbar).toBeVisible()

    const [toolbarBox, hostBox] = await Promise.all([
      toolbar.boundingBox(),
      page.locator('.editor-host').boundingBox(),
    ])
    expect(toolbarBox).not.toBeNull()
    expect(hostBox).not.toBeNull()
    expect(toolbarBox!.y).toBeGreaterThan(hostBox!.y + 88)

    await page.mouse.move(
      toolbarBox!.x + toolbarBox!.width / 2,
      toolbarBox!.y + toolbarBox!.height / 2,
    )
    await page.waitForTimeout(300)
    await expect(toolbar).toBeVisible()
  })

  test('keeps block actions floating above long wrapped text', async ({ page }) => {
    const created = '2026-07-01T10:38:41.565Z'
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      '本周目标：功能交付 2 人日（成员甲 1、成员乙 0.7、成员丙 0.3）、稳定性收敛 1 人日（成员乙 0.3、成员丙 0.7）、评测与成本 1 人日（成员丁 1）',
      '2026.7.6-26.7.10',
    ].join('\n')}`

    await loadFixture(page, content)
    await clickLine(page, '本周目标')
    await hoverEditorTopRight(page)

    const layout = await page.evaluate(() => {
      const toolbar = document.querySelector<HTMLElement>('.block-toolbar')?.getBoundingClientRect()
      const line = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(element => (element.textContent || '').includes('本周目标'))
      if (!toolbar || !line) return null
      return {
        lineRight: line.getBoundingClientRect().right,
        linePaddingRight: Number.parseFloat(getComputedStyle(line).paddingRight || '0'),
        toolbarPosition: getComputedStyle(document.querySelector<HTMLElement>('.block-toolbar')!).position,
        toolbarRight: toolbar.right,
      }
    })

    expect(layout).not.toBeNull()
    expect(layout!.linePaddingRight).toBeLessThanOrEqual(20)
    expect(layout!.toolbarPosition).toBe('absolute')
    expect(layout!.lineRight).toBeGreaterThan(layout!.toolbarRight)
  })

  test('keeps block actions pinned while scrolling inside a long focused block', async ({ page }) => {
    const created = '2026-07-01T10:38:41.565Z'
    const lines = Array.from({ length: 90 }, (_, index) => `line ${String(index + 1).padStart(2, '0')} long block content`)
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      ...lines,
      `---block:markdown;auto=1;created=${created}`,
      'after long block',
    ].join('\n')}`

    await loadFixture(page, content)
    await clickLine(page, 'line 01')

    const toolbar = page.locator('.block-toolbar')
    await expect(toolbar).toHaveCount(0)

    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')
      if (!scroller) throw new Error('Missing editor scroller')
      scroller.scrollTop = 900
      scroller.dispatchEvent(new Event('scroll'))
    })

    await expect(toolbar).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
      const toolbarRect = document.querySelector<HTMLElement>('.block-toolbar')?.getBoundingClientRect()
      const hostRect = document.querySelector<HTMLElement>('.editor-host')?.getBoundingClientRect()
      if (!toolbarRect || !hostRect) return null
      return Math.round(toolbarRect.top - hostRect.top)
    })).toBeLessThanOrEqual(12)
  })

  test('offers contextual top and bottom jumps after fast scrolling', async ({ page }) => {
    const created = '2026-07-01T10:38:41.565Z'
    const lines = Array.from({ length: 5_000 }, (_, index) => `scroll target ${String(index + 1).padStart(4, '0')}`)
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      ...lines,
    ].join('\n')}`

    await loadFixture(page, content)

    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')
      if (!scroller) throw new Error('Missing editor scroller')
      scroller.scrollTop = 900
      scroller.dispatchEvent(new Event('scroll'))
    })

    const bottomJump = page.getByRole('button', { name: '直达底部' })
    await expect(bottomJump).toBeVisible()
    await bottomJump.click()
    await expect.poll(() => page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')!
      return Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop)
    })).toBeLessThanOrEqual(2)

    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')
      if (!scroller) throw new Error('Missing editor scroller')
      scroller.scrollTop = Math.max(0, scroller.scrollTop - 900)
      scroller.dispatchEvent(new Event('scroll'))
    })

    const topJump = page.getByRole('button', { name: '回到顶部' })
    await expect(topJump).toBeVisible()
    await topJump.click()
    await expect.poll(() => page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')!
      return Math.round(scroller.scrollTop)
    })).toBeLessThanOrEqual(2)

    await page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')
      if (!scroller) throw new Error('Missing editor scroller')
      scroller.scrollTop = 900
      scroller.dispatchEvent(new Event('scroll'))
    })
    await expect(bottomJump).toBeVisible()
    await expect(bottomJump).toBeHidden({ timeout: 2200 })
  })

  test('allows the final block to scroll to the top of the editor viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    const created = '2026-07-27T10:00:00.000Z'
    const precedingLines = Array.from(
      { length: 120 },
      (_, index) => `preceding line ${String(index + 1).padStart(3, '0')}`,
    )
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      ...precedingLines,
      `---block:markdown;auto=1;created=${created}`,
      'final block anchor',
    ].join('\n')}`

    await loadFixture(page, content)

    const maximumScroll = await page.evaluate(async () => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')
      if (!scroller) throw new Error('Missing editor scroller')
      for (let frame = 0; frame < 6; frame += 1) {
        scroller.scrollTop = scroller.scrollHeight
        scroller.dispatchEvent(new Event('scroll'))
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      }
      return scroller.scrollHeight - scroller.clientHeight
    })
    expect(maximumScroll).toBeGreaterThan(500)
    await expect(page.locator('.cm-line', { hasText: 'final block anchor' })).toBeVisible()

    await expect.poll(() => page.evaluate(() => {
      const scroller = document.querySelector<HTMLElement>('.cm-scroller')
      const finalLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent === 'final block anchor')
      if (!scroller || !finalLine) return Number.POSITIVE_INFINITY
      return Math.abs(Math.round(finalLine.getBoundingClientRect().top - scroller.getBoundingClientRect().top))
    })).toBeLessThanOrEqual(8)
  })

  test('supports editor font size shortcuts without page zoom', async ({ page }) => {
    await loadFixture(page)

    const editorFontSize = () => page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.cm-editor')
      return Number.parseFloat(getComputedStyle(editor!).getPropertyValue('--editor-font-size'))
    })

    await expect.poll(editorFontSize).toBe(13)

    await page.keyboard.down(modifier)
    await page.keyboard.down('Shift')
    await page.keyboard.press('=')
    await page.keyboard.up('Shift')
    await page.keyboard.up(modifier)
    await expect.poll(editorFontSize).toBe(14)

    await page.keyboard.press(`${modifier}+-`)
    await expect.poll(editorFontSize).toBe(13)

    await page.keyboard.down(modifier)
    await page.keyboard.down('Shift')
    await page.keyboard.press('=')
    await page.keyboard.up('Shift')
    await page.keyboard.up(modifier)
    await expect.poll(editorFontSize).toBe(14)

    await page.keyboard.press(`${modifier}+0`)
    await expect.poll(editorFontSize).toBe(13)
    await expect.poll(() => page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1)
  })

  test('extends the last remaining block background after deleting a trailing block', async ({ page }) => {
    const created = '2026-07-03T10:00:00.000Z'
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      'first block',
      `---block:markdown;auto=1;created=${created}`,
      'last visible block',
      `---block:markdown;auto=1;created=${created}`,
      'delete me',
    ].join('\n')}`
    await loadFixture(page, content)
    await clickLine(page, 'delete me')
    await page.getByTitle('删除当前块（Cmd/Ctrl+Shift+D）').click()

    await expect(page.locator('.cm-content')).not.toContainText('delete me')
    await expect(page.locator('.cm-editor')).toHaveClass(/last-block-odd/)

    const colors = await page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.cm-editor')!
      const content = document.querySelector<HTMLElement>('.cm-content')!
      const gutter = document.querySelector<HTMLElement>('.cm-gutters')!
      const probe = document.createElement('div')
      document.body.append(probe)
      probe.style.background = 'var(--surface-block-alt)'
      const expectedContentBackground = getComputedStyle(probe).backgroundColor
      probe.style.background = 'var(--surface-gutter-odd)'
      const expectedGutterBackground = getComputedStyle(probe).backgroundColor
      probe.remove()
      return {
        editorClass: editor.className,
        contentBackground: getComputedStyle(content).backgroundColor,
        expectedContentBackground,
        gutterBackground: getComputedStyle(gutter).backgroundColor,
        expectedGutterBackground,
      }
    })

    expect(colors.contentBackground).toBe(colors.expectedContentBackground)
    expect(colors.gutterBackground).toBe(colors.expectedGutterBackground)
  })

  test('keeps markdown block row backgrounds consistent outside the active line', async ({ page }) => {
    const created = '2026-07-03T10:00:00.000Z'
    const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:text;auto=0;created=${created}`,
      'first block',
      `---block:markdown;auto=1;created=${created}`,
      '- hello',
      '- 你好啊',
      '',
      '[text](https://baidu.com)',
      '',
      '- [ ] fdsafds',
      '- [ ] fdsafdsfdsaf',
      '- [x] xxx',
      '',
      '1. dfsafds',
      '2. dfsaf',
      '',
      '---',
      '',
      '> fdsafdsa',
    ].join('\n')}`
    await loadFixture(page, content)
    await clickLine(page, 'xxx')

    const colors = await page.evaluate(() => {
      const probe = document.createElement('div')
      document.body.append(probe)
      probe.style.background = 'var(--surface-block-alt)'
      const expectedBlockBackground = getComputedStyle(probe).backgroundColor
      probe.remove()

      return Array.from(document.querySelectorAll<HTMLElement>('.cm-line.block-odd'))
        .filter(line => !line.classList.contains('cm-activeLine'))
        .map(line => ({
          text: line.textContent || '',
          background: getComputedStyle(line).backgroundColor,
          expectedBlockBackground,
        }))
    })

    const checkedRows = colors.filter(row =>
      row.text.includes('[text]') ||
      row.text.includes('fdsafds') ||
      row.text.includes('dfsafds') ||
      row.text.includes('---') ||
      row.text.includes('fdsafdsa')
    )
    expect(checkedRows.length).toBeGreaterThanOrEqual(5)
    expect(checkedRows.every(row => row.background === row.expectedBlockBackground)).toBe(true)

    for (const text of ['fdsafds', 'dfsafds', '---']) {
      await clickLine(page, text)
      await expect(page.locator('.cm-activeLine')).toContainText(text)
      const activeLineColors = await page.evaluate(() => {
        const activeLine = document.querySelector<HTMLElement>('.cm-activeLine')!
        const probe = document.createElement('div')
        document.body.append(probe)
        probe.style.background = 'var(--active-line-bg)'
        const expectedActiveBackground = getComputedStyle(probe).backgroundColor
        probe.style.background = 'var(--surface-block-alt)'
        const blockBackground = getComputedStyle(probe).backgroundColor
        probe.style.background = 'var(--surface-editor)'
        const evenBackground = getComputedStyle(probe).backgroundColor
        probe.remove()
        return {
          text: activeLine.textContent || '',
          background: getComputedStyle(activeLine).backgroundColor,
          expectedActiveBackground,
          blockBackground,
          evenBackground,
        }
      })
      expect(activeLineColors.text).toContain(text)
      expect(activeLineColors.background).toBe(activeLineColors.expectedActiveBackground)
      expect(activeLineColors.background).not.toBe(activeLineColors.blockBackground)
      expect(activeLineColors.background).not.toBe(activeLineColors.evenBackground)
    }
  })
})

test.describe('editor search and replace', () => {
  const created = '2026-07-01T10:38:41.565Z'
  const searchFixture = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    'alpha one',
    'alpha two',
    `---block:markdown;auto=1;created=${created}`,
    'alpha three',
  ].join('\n')}`

  test('switches between current-block and document search while preserving the query', async ({ page }) => {
    await loadFixture(page, searchFixture)
    await page.keyboard.press(`${modifier}+F`)

    const panel = page.locator('.editor-search-panel')
    const query = panel.getByLabel('搜索内容')
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: '当前块', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('替换内容')).toHaveCount(0)
    await expect(panel.getByRole('button', { name: '展开替换' })).toHaveAttribute('aria-expanded', 'false')

    await query.fill('alpha')
    await expect(panel.locator('.editor-search-count')).toHaveText('1 / 2')
    await expect(page.locator('.vibenote-search-match')).toHaveCount(2)

    await panel.getByRole('button', { name: '全文', exact: true }).click()
    await expect(query).toHaveValue('alpha')
    await expect(panel.locator('.editor-search-count')).toHaveText('1 / 3')
    await expect(page.locator('.vibenote-search-match')).toHaveCount(3)

    await panel.getByRole('button', { name: '展开替换' }).click()
    await panel.getByLabel('替换内容').fill('beta')
    await panel.getByRole('button', { name: '当前块', exact: true }).click()
    await panel.getByRole('button', { name: '替换当前块' }).click()
    await expect(panel.locator('.editor-search-count')).toHaveText('无结果')

    await panel.getByRole('button', { name: '全文', exact: true }).click()
    await expect(panel.locator('.editor-search-count')).toHaveText('1 / 1')
    await panel.getByRole('button', { name: '替换全文' }).click()
    await expect(panel.locator('.editor-search-count')).toHaveText('无结果')

    const readSaved = () => page.evaluate(() => {
      const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
      return buffers[0]?.content || ''
    })
    await expect.poll(readSaved).toContain('beta')
    const saved = await readSaved()
    expect(saved.match(/beta/g)).toHaveLength(3)
    expect(saved.match(/---block:/g)).toHaveLength(2)

    await query.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(page.locator('.vibenote-search-match')).toHaveCount(0)

    await page.keyboard.press(`${modifier}+Shift+F`)
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: '全文', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('替换内容')).toHaveCount(0)

    await page.keyboard.press(`${modifier}+R`)
    await expect(panel.getByRole('button', { name: '当前块', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('替换内容')).toBeVisible()
    await expect(panel.getByRole('button', { name: '折叠替换' })).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press(`${modifier}+Shift+R`)
    await expect(panel.getByRole('button', { name: '全文', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('替换内容')).toBeVisible()

    await page.keyboard.press(`${modifier}+F`)
    await expect(panel.getByRole('button', { name: '当前块', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('替换内容')).toHaveCount(0)

    await panel.getByRole('button', { name: '全文', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)

    await page.locator('.windowbar').click()
    await page.keyboard.press(`${modifier}+Shift+R`)
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('button', { name: '全文', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.getByLabel('替换内容')).toBeVisible()
  })

  test('keeps the search controls inside a narrow editor viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 720 })
    await loadFixture(page, searchFixture)
    await page.keyboard.press(`${modifier}+F`)
    const panel = page.locator('.editor-search-panel')
    await panel.getByLabel('搜索内容').fill('alpha')
    await panel.getByRole('button', { name: '展开替换' }).click()
    const rect = await panel.boundingBox()
    expect(rect).not.toBeNull()
    expect(rect!.x).toBeGreaterThanOrEqual(0)
    expect(rect!.x + rect!.width).toBeLessThanOrEqual(360)
    await expect(panel.getByRole('button', { name: '替换当前块' })).toBeVisible()
  })

  test('keeps search toolbar typography in sync with editor zoom', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('vibenote:settings', JSON.stringify({
        theme: 'light',
        fontSize: 18,
        tabSize: 2,
        defaultLanguage: 'markdown',
      }))
    })
    await loadFixture(page, searchFixture)
    await page.keyboard.press(`${modifier}+F`)

    const typography = () => page.evaluate(() => {
      const editor = document.querySelector<HTMLElement>('.cm-editor')!
      const panel = document.querySelector<HTMLElement>('.editor-search-panel')!
      const input = document.querySelector<HTMLElement>('.editor-search-field input')!
      const scope = document.querySelector<HTMLElement>('.editor-search-scope button')!
      const count = document.querySelector<HTMLElement>('.editor-search-count')!
      return {
        editor: Number.parseFloat(getComputedStyle(editor).fontSize),
        panel: Number.parseFloat(getComputedStyle(panel).fontSize),
        input: Number.parseFloat(getComputedStyle(input).fontSize),
        scope: Number.parseFloat(getComputedStyle(scope).fontSize),
        count: Number.parseFloat(getComputedStyle(count).fontSize),
      }
    })

    await expect.poll(typography).toEqual({ editor: 18, panel: 18, input: 18, scope: 18, count: 18 })

    await page.keyboard.press('Escape')
    await expect(page.locator('.editor-search-panel')).toHaveCount(0)
    await page.keyboard.press(`${modifier}+=`)
    await page.keyboard.press(`${modifier}+F`)
    await expect.poll(typography).toEqual({ editor: 19, panel: 19, input: 19, scope: 19, count: 19 })
  })

  test('caps the search toolbar scale and keeps it anchored at the top right', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('vibenote:settings', JSON.stringify({
        theme: 'light',
        fontSize: 48,
        tabSize: 2,
        defaultLanguage: 'markdown',
      }))
    })
    await loadFixture(page, searchFixture)
    await page.keyboard.press(`${modifier}+F`)

    const layout = await page.locator('.editor-search-panel').evaluate((panel) => {
      const node = panel as HTMLElement
      const input = node.querySelector<HTMLElement>('.editor-search-field input')!
      const rect = node.getBoundingClientRect()
      const style = getComputedStyle(node)
      return {
        fontSize: Number.parseFloat(style.fontSize),
        inputFontSize: Number.parseFloat(getComputedStyle(input).fontSize),
        width: rect.width,
        right: style.right,
        top: style.top,
      }
    })

    expect(layout.fontSize).toBe(24)
    expect(layout.inputFontSize).toBe(24)
    expect(layout.width).toBeLessThanOrEqual(880)
    expect(layout.right).toBe('12px')
    expect(layout.top).toBe('12px')
  })

  test('wraps long unbroken text without a horizontal editor scrollbar', async ({ page }) => {
    const longToken = `LS0t${'S1CR'.repeat(1500)}`
    const longLineFixture = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      '# Encoded payload',
      longToken,
    ].join('\n')}`

    await page.setViewportSize({ width: 1100, height: 720 })
    await loadFixture(page, longLineFixture)
    await expect(page.locator('.cm-content')).toContainText(longToken.slice(0, 64))

    const scroller = await page.locator('.cm-scroller').evaluate((element) => {
      const node = element as HTMLElement
      return {
        overflowX: getComputedStyle(node).overflowX,
        overflowWidth: node.scrollWidth - node.clientWidth,
        scrollLeft: node.scrollLeft,
      }
    })

    expect(scroller.overflowX).toBe('hidden')
    expect(scroller.overflowWidth).toBeLessThanOrEqual(1)
    expect(scroller.scrollLeft).toBe(0)
  })
})

test.describe('external Vibenote files', () => {
  test.beforeEach(async ({ page }) => {
    await loadFixture(page)
  })

  test('creates and opens external notes from app shortcuts', async ({ page }) => {
    await page.keyboard.press(`${modifier}+N`)
    await expect(page.locator('.window-title')).toContainText('New External Note')
    await expect(page.locator('.cm-content')).toContainText('New external note')

    await page.keyboard.press(`${modifier}+O`)
    await expect(page.locator('.window-title')).toContainText('Opened Note')
    await expect(page.locator('.cm-content')).toContainText('Opened external note')
  })
})
