import { expect, test, type Page } from '@playwright/test'

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

  test('renders the real flow-list branches at their source-aligned stage without changing markdown', async ({ page }) => {
    const fixture = markdownFixture([
      '变更感知 -> 能搜的到、搜的准 -> 从 0 到 1 接入        -> "-" 到 "100分"   （能搜的到、搜得准）',
      '                           -> 从 1 到 N 数据质量优化 -> "x 分" 到 "100分" （搜的准，比如 startTime 没上报，或者）',
      '',
      '防线 -> 有效拦截率 -> 影响面分析 -> 数据：上报数据质量 + 人工经验质量 -> 上报数据质量：能搜的到、搜的准',
      '- plain item',
      '- command `a -> b` stays plain',
    ])
    await loadFixture(page, fixture)

    const flowMap = page.locator('.markdown-flow-map')
    await expect(flowMap).toHaveCount(1)
    await expect(flowMap.locator('.markdown-flow-section')).toHaveCount(2)
    await expect(flowMap.locator('.markdown-flow-lane')).toHaveCount(3)
    await expect(flowMap.locator('.markdown-flow-lane-branch')).toHaveCount(1)
    await expect(flowMap.locator('.markdown-flow-map-node')).toHaveCount(9)
    await expect(flowMap.locator('.markdown-flow-line-number')).toHaveText(['1', '2', '3', '4'])
    await expect(flowMap.locator('.markdown-flow-scroll-hint')).toHaveCount(0)
    await expect(flowMap.locator('.markdown-flow-canvas-viewport')).toHaveCount(0)
    await expect(flowMap.locator('.markdown-flow-rail-mask')).toHaveCount(0)
    await expect(flowMap).toHaveAttribute('aria-keyshortcuts', 'Enter Space')

    const geometry = await page.evaluate(() => {
      const map = document.querySelector<HTMLElement>('.markdown-flow-map')!
      const section = document.querySelector<HTMLElement>('.markdown-flow-section')!
      const stage = section.querySelector<HTMLElement>('.markdown-flow-stage')!
      const svg = section.querySelector<SVGSVGElement>('.markdown-flow-edge-layer')!
      const mainStageTwo = section.querySelector<HTMLElement>('.markdown-flow-lane-main [data-flow-stage="2"]')!
      const branchStageTwo = section.querySelector<HTMLElement>('.markdown-flow-lane-branch [data-flow-stage="2"]')!
      const mainEdge = svg.querySelector<SVGPathElement>('[data-flow-target-stage="2"][data-flow-lane="0"]')!
      const trunk = svg.querySelector<SVGPathElement>('[data-flow-edge="trunk"]')!
      const splitTail = svg.querySelector<SVGPathElement>('[data-flow-edge="split-tail"]')!
      const mainStageOne = section.querySelector<HTMLElement>('.markdown-flow-lane-main [data-flow-stage="1"]')!
      const horizontalLengths = Array.from(svg.querySelectorAll<SVGPathElement>('[marker-end]'))
        .map(edge => edge.getTotalLength())
      const svgRect = svg.getBoundingClientRect()
      const tailStart = splitTail.getPointAtLength(0)
      const tailEnd = splitTail.getPointAtLength(splitTail.getTotalLength())
      const defenseSection = document.querySelectorAll<HTMLElement>('.markdown-flow-section')[1]
      const defenseSvg = defenseSection.querySelector<SVGSVGElement>('.markdown-flow-edge-layer')!
      const defenseSvgRect = defenseSvg.getBoundingClientRect()
      const defenseNodes = Array.from(defenseSection.querySelectorAll<HTMLElement>('.markdown-flow-lane-main .markdown-flow-map-node'))
      const defenseSourceGaps = defenseNodes.slice(0, -1).map((source, index) => {
        const edge = defenseSvg.querySelector<SVGPathElement>(`[data-flow-target-stage="${index + 2}"]`)!
        return edge.getPointAtLength(0).x - (source.getBoundingClientRect().right - defenseSvgRect.left)
      })
      const followingLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('plain item'))!
      return {
        overflow: stage.scrollWidth - stage.clientWidth,
        branchAlignment: Math.abs(mainStageTwo.getBoundingClientRect().left - branchStageTwo.getBoundingClientRect().left),
        trunkTrackDelta: Math.abs(mainEdge.getPointAtLength(0).x - trunk.getPointAtLength(0).x),
        horizontalLengths,
        maxNodeWidth: Number.parseFloat(getComputedStyle(mainStageTwo).maxWidth),
        splitTailLength: splitTail.getTotalLength(),
        splitTailSourceGap: tailStart.x - (mainStageOne.getBoundingClientRect().right - svgRect.left),
        splitTailJoinDelta: Math.abs(tailEnd.x - trunk.getPointAtLength(0).x),
        defenseSourceGaps,
        followingLineOverlap: map.getBoundingClientRect().bottom - followingLine.getBoundingClientRect().top,
      }
    })
    expect(geometry.overflow).toBeLessThanOrEqual(1)
    expect(geometry.branchAlignment).toBeLessThanOrEqual(1)
    expect(geometry.trunkTrackDelta).toBeLessThanOrEqual(1)
    expect(Math.min(...geometry.horizontalLengths)).toBeGreaterThanOrEqual(28)
    expect(Math.max(...geometry.horizontalLengths)).toBeLessThanOrEqual(32)
    expect(Math.max(...geometry.horizontalLengths) - Math.min(...geometry.horizontalLengths)).toBeLessThanOrEqual(2)
    expect(geometry.maxNodeWidth).toBeLessThanOrEqual(180)
    expect(geometry.splitTailLength).toBeGreaterThanOrEqual(18)
    expect(geometry.splitTailLength).toBeLessThanOrEqual(22)
    expect(geometry.splitTailSourceGap).toBeGreaterThanOrEqual(8)
    expect(geometry.splitTailSourceGap).toBeLessThanOrEqual(12)
    expect(geometry.splitTailJoinDelta).toBeLessThanOrEqual(1)
    expect(Math.min(...geometry.defenseSourceGaps)).toBeGreaterThanOrEqual(8)
    expect(Math.max(...geometry.defenseSourceGaps)).toBeLessThanOrEqual(12)
    expect(geometry.followingLineOverlap).toBeLessThanOrEqual(1)

    await flowMap.click()
    await expect(flowMap).toHaveCount(0)
    await expect(page.locator('.cm-line').filter({ hasText: '从 1 到 N 数据质量优化' })).toBeVisible()
    await page.locator('.cm-line').filter({ hasText: 'plain item' }).click()
    await expect(page.locator('.markdown-flow-map')).toHaveCount(1)
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('keeps first-stage merged arrows traceable and visually neutral inside one block', async ({ page }) => {
    await loadFixture(page, markdownFixture([
      '- 变更感知 -> 搜得到 -> 搜得准',
      '  - 0 -> 1: 接入',
      '  - 1 -> N: 数据质量优化',
    ]))

    const evidence = await page.evaluate(() => {
      const map = document.querySelector<HTMLElement>('.markdown-flow-map')!
      const section = map.querySelector<HTMLElement>('.markdown-flow-section')!
      const svg = section.querySelector<SVGSVGElement>('.markdown-flow-edge-layer')!
      const tail = svg.querySelector<SVGPathElement>('[data-flow-edge="split-tail"]')!
      const trunk = svg.querySelector<SVGPathElement>('[data-flow-edge="trunk"]')!
      const tailStart = tail.getPointAtLength(0)
      const tailEnd = tail.getPointAtLength(tail.getTotalLength())
      const trunkStart = trunk.getPointAtLength(0)
      const mapStyle = getComputedStyle(map)
      const nodeStyle = getComputedStyle(section.querySelector<HTMLElement>('.markdown-flow-map-node')!)
      const lineNumber = section.querySelector<HTMLElement>('.markdown-flow-line-number')!
      const root = section.querySelector<HTMLElement>('.markdown-flow-root')!
      const lineNumberRect = lineNumber.getBoundingClientRect()
      const rootRect = root.getBoundingClientRect()
      const gutter = document.querySelector<HTMLElement>('.cm-gutters')!
      const gutterRect = gutter.getBoundingClientRect()
      const gutterBorderWidth = Number.parseFloat(getComputedStyle(gutter).borderRightWidth)
      return {
        laneCount: section.querySelectorAll('.markdown-flow-lane').length,
        lineNumbers: Array.from(map.querySelectorAll('.markdown-flow-line-number')).map(node => node.textContent),
        tailLength: tail.getTotalLength(),
        tailStartX: tailStart.x,
        tailJoinDelta: Math.hypot(tailEnd.x - trunkStart.x, tailEnd.y - trunkStart.y),
        edgeColor: getComputedStyle(svg).color,
        nodeColor: nodeStyle.color,
        background: mapStyle.backgroundColor,
        contentBackground: getComputedStyle(document.querySelector<HTMLElement>('.cm-content')!).backgroundColor,
        lineNumberBackground: getComputedStyle(lineNumber).backgroundColor,
        gutterFillBackground: getComputedStyle(map, '::before').backgroundColor,
        lineNumberText: lineNumber.textContent,
        gutterLeftAlignment: Math.abs(lineNumberRect.left - gutterRect.left),
        gutterRightAlignment: Math.abs(lineNumberRect.right - (gutterRect.right - gutterBorderWidth)),
        lineNumberBorderRight: getComputedStyle(lineNumber).borderRightWidth,
        gutterBorderWidth,
        rowAlignment: Math.abs(
          (lineNumberRect.top + lineNumberRect.height / 2)
            - (rootRect.top + rootRect.height / 2),
        ),
        borderTop: mapStyle.borderTopWidth,
        borderBottom: mapStyle.borderBottomWidth,
      }
    })
    expect(evidence.laneCount).toBe(3)
    expect(evidence.lineNumbers).toEqual(['1', '2', '3'])
    expect(evidence.tailLength).toBeGreaterThanOrEqual(18)
    expect(evidence.tailLength).toBeLessThanOrEqual(22)
    expect(evidence.tailStartX).toBeGreaterThanOrEqual(0)
    expect(evidence.tailJoinDelta).toBeLessThanOrEqual(1)
    expect(evidence.edgeColor).toBe(evidence.nodeColor)
    expect(evidence.background).toBe(evidence.contentBackground)
    expect(evidence.lineNumberBackground).toBe('rgba(0, 0, 0, 0)')
    expect(evidence.gutterFillBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(evidence.lineNumberText).toBe('1')
    expect(evidence.gutterLeftAlignment).toBeLessThanOrEqual(1)
    expect(evidence.gutterRightAlignment).toBeLessThanOrEqual(1)
    expect(evidence.lineNumberBorderRight).toBe('0px')
    expect(evidence.gutterBorderWidth).toBeGreaterThanOrEqual(1)
    expect(evidence.rowAlignment).toBeLessThanOrEqual(1)
    expect(evidence.borderTop).toBe('0px')
    expect(evidence.borderBottom).toBe('0px')
  })

  test('renders plain arrow chains without an extra row before the next block boundary', async ({ page }) => {
    const created = '2026-07-02T09:00:00.000Z'
    const fixture = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
      `---block:markdown;auto=1;created=${created}`,
      '上一个 block',
      `---block:markdown;auto=1;created=${created}`,
      '指标：感知接入率、字段合规率、字段完整率',
      '',
      '变更感知 -> 搜得到 -> 搜得准',
      '0 -> 1：接入',
      '1 -> N：数据质量优化',
      `---block:markdown;auto=1;created=${created}`,
      '下一个 block',
    ].join('\n')}`
    await loadFixture(page, fixture)

    const map = page.locator('.markdown-flow-map')
    await expect(map).toHaveCount(1)
    await expect(map.locator('.markdown-flow-section')).toHaveCount(3)
    await expect(map.locator('.markdown-flow-line-number')).toHaveText(['3', '4', '5'])

    const evidence = await page.evaluate(() => {
      const map = document.querySelector<HTMLElement>('.markdown-flow-map')!
      const root = map.querySelector<HTMLElement>('.markdown-flow-root-label')!
      const precedingLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('指标：'))!
      const followingLine = Array.from(document.querySelectorAll<HTMLElement>('.cm-line'))
        .find(line => line.textContent?.includes('下一个 block'))!
      const gutter = document.querySelector<HTMLElement>('.cm-gutters')!
      const gutterRect = gutter.getBoundingClientRect()
      const gutterBorderWidth = Number.parseFloat(getComputedStyle(gutter).borderRightWidth)
      const lineNumbers = Array.from(map.querySelectorAll<HTMLElement>('.markdown-flow-line-number'))
      const precedingLineStyle = getComputedStyle(precedingLine)
      const precedingTextLeft = precedingLine.getBoundingClientRect().left
        + Number.parseFloat(precedingLineStyle.paddingLeft)
      return {
        mapBackground: getComputedStyle(map).backgroundColor,
        gutterFillBackground: getComputedStyle(map, '::before').backgroundColor,
        sourceGutterBackground: getComputedStyle(document.querySelector<HTMLElement>('.cm-gutterElement.block-gutter-odd')!).backgroundColor,
        rootAlignment: Math.abs(root.getBoundingClientRect().left - precedingTextLeft),
        boundaryGap: followingLine.getBoundingClientRect().top - map.getBoundingClientRect().bottom,
        gutterLeftErrors: lineNumbers.map(number => Math.abs(number.getBoundingClientRect().left - gutterRect.left)),
        gutterRightErrors: lineNumbers.map(number => Math.abs(
          number.getBoundingClientRect().right - (gutterRect.right - gutterBorderWidth),
        )),
      }
    })
    expect(evidence.mapBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(evidence.gutterFillBackground).toBe(evidence.sourceGutterBackground)
    expect(evidence.rootAlignment).toBeLessThanOrEqual(1)
    expect(evidence.boundaryGap).toBeGreaterThanOrEqual(0)
    expect(evidence.boundaryGap).toBeLessThanOrEqual(2)
    expect(Math.max(...evidence.gutterLeftErrors)).toBeLessThanOrEqual(1)
    expect(Math.max(...evidence.gutterRightErrors)).toBeLessThanOrEqual(1)
    await expect.poll(() => savedContent(page)).toBe(fixture)
  })

  test('keeps real flow-list text readable without horizontal overflow at target widths and scales', async ({ browser }) => {
    const fixture = markdownFixture([
      '- 变更感知 -> 能搜的到、搜的准 -> 从 0 到 1 接入        -> "-" 到 "100分"   （能搜的到、搜得准）',
      '                           -> 从 1 到 N 数据质量优化 -> "x 分" 到 "100分" （搜的准，比如 startTime 没上报，或者）',
      '',
      '- 防线 -> 有效拦截率 -> 影响面分析 -> 数据：上报数据质量 + 人工经验质量 -> 上报数据质量：能搜的到、搜的准',
    ])

    for (const deviceScaleFactor of [1, 2]) {
      for (const width of [1100, 360]) {
        const context = await browser.newContext({
          baseURL: 'http://127.0.0.1:3344',
          deviceScaleFactor,
          viewport: { width, height: 900 },
        })
        const targetPage = await context.newPage()
        await loadFixture(targetPage, fixture)
        const evidence = await targetPage.evaluate(() => {
          const map = document.querySelector<HTMLElement>('.markdown-flow-map')!
          const nodes = Array.from(map.querySelectorAll<HTMLElement>('.markdown-flow-map-node'))
          const edges = Array.from(map.querySelectorAll<SVGPathElement>('[marker-end]'))
          const allEdges = Array.from(map.querySelectorAll<SVGPathElement>('.markdown-flow-edge'))
          const mapRect = map.getBoundingClientRect()
          const firstSection = map.querySelector<HTMLElement>('.markdown-flow-section')!
          const stage = firstSection.querySelector<HTMLElement>('.markdown-flow-stage')!
          const stageRect = stage.getBoundingClientRect()
          const mainStageTwo = firstSection.querySelector<HTMLElement>('.markdown-flow-lane-main [data-flow-stage="2"]')!
          const branchStageTwo = firstSection.querySelector<HTMLElement>('.markdown-flow-lane-branch [data-flow-stage="2"]')!
          const mainStageThree = firstSection.querySelector<HTMLElement>('.markdown-flow-lane-main [data-flow-stage="3"]')!
          const branchStageThree = firstSection.querySelector<HTMLElement>('.markdown-flow-lane-branch [data-flow-stage="3"]')!
          const mainEdge = firstSection.querySelector<SVGPathElement>('[data-flow-target-stage="2"][data-flow-lane="0"]')!
          const branchEdge = firstSection.querySelector<SVGPathElement>('[data-flow-target-stage="2"][data-flow-lane="1"]')!
          const trunk = firstSection.querySelector<SVGPathElement>('[data-flow-edge="trunk"]')!
          const mainTrack = firstSection.querySelector<SVGPathElement>('[data-flow-edge="main-track"]')
          const branchTrack = firstSection.querySelector<SVGPathElement>('[data-flow-edge="branch-track"]')
          const trunkStart = trunk.getPointAtLength(0)
          const trunkEnd = trunk.getPointAtLength(trunk.getTotalLength())
          const edgeXs = allEdges.flatMap(edge => Array.from(
            { length: Math.ceil(edge.getTotalLength()) + 1 },
            (_, index) => edge.getPointAtLength(Math.min(index, edge.getTotalLength())).x,
          ))
          return {
            mapOverflow: map.scrollWidth - map.clientWidth,
            stageOverflows: Array.from(map.querySelectorAll<HTMLElement>('.markdown-flow-stage'))
              .map(stage => stage.scrollWidth - stage.clientWidth),
            clippedNodes: nodes.filter(node => {
              const rect = node.getBoundingClientRect()
              return rect.left < mapRect.left - 1 || rect.right > mapRect.right + 1
                || node.scrollWidth > node.clientWidth + 1
            }).length,
            connectorLengths: edges.map(edge => edge.getTotalLength()),
            minEdgeX: Math.min(...edgeXs),
            hasScrollUi: Boolean(map.querySelector('.markdown-flow-canvas-viewport, .markdown-flow-scroll-hint, .markdown-flow-rail-mask')),
            allText: map.textContent,
            narrowTopology: mainTrack
              ? {
                  branchIndent: branchStageTwo.getBoundingClientRect().left - mainStageTwo.getBoundingClientRect().left,
                  mainAttachYDelta: Math.abs(trunkStart.y - (mainStageTwo.getBoundingClientRect().top - stageRect.top + mainStageTwo.getBoundingClientRect().height / 2)),
                  branchAttachYDelta: Math.abs(trunkEnd.y - (branchStageTwo.getBoundingClientRect().top - stageRect.top + branchStageTwo.getBoundingClientRect().height / 2)),
                  mainTrackXDelta: Math.abs(trunkStart.x - mainEdge.getPointAtLength(0).x),
                  branchTrackXDelta: Math.abs(trunkEnd.x - branchEdge.getPointAtLength(0).x),
                  branchTrackEndYDelta: Math.abs(
                    branchTrack!.getPointAtLength(branchTrack!.getTotalLength()).y
                      - (branchStageThree.getBoundingClientRect().top - stageRect.top + branchStageThree.getBoundingClientRect().height / 2),
                  ),
                  branchFinishesBeforeMainResume: branchStageThree.getBoundingClientRect().bottom
                    <= mainStageThree.getBoundingClientRect().top,
                }
              : null,
          }
        })
        expect(evidence.mapOverflow).toBeLessThanOrEqual(1)
        expect(Math.max(...evidence.stageOverflows)).toBeLessThanOrEqual(1)
        expect(evidence.clippedNodes).toBe(0)
        expect(evidence.hasScrollUi).toBe(false)
        expect(evidence.allText).toContain('startTime 没上报')
        expect(Math.min(...evidence.connectorLengths)).toBeGreaterThanOrEqual(28)
        expect(Math.max(...evidence.connectorLengths)).toBeLessThanOrEqual(32)
        expect(Math.max(...evidence.connectorLengths) - Math.min(...evidence.connectorLengths)).toBeLessThanOrEqual(2)
        if (width === 360) {
          expect(evidence.minEdgeX).toBeGreaterThanOrEqual(8)
          expect(evidence.narrowTopology).not.toBeNull()
          expect(evidence.narrowTopology!.branchIndent).toBeGreaterThanOrEqual(12)
          expect(evidence.narrowTopology!.mainAttachYDelta).toBeLessThanOrEqual(1)
          expect(evidence.narrowTopology!.branchAttachYDelta).toBeLessThanOrEqual(1)
          expect(evidence.narrowTopology!.mainTrackXDelta).toBeLessThanOrEqual(1)
          expect(evidence.narrowTopology!.branchTrackXDelta).toBeLessThanOrEqual(1)
          expect(evidence.narrowTopology!.branchTrackEndYDelta).toBeLessThanOrEqual(1)
          expect(evidence.narrowTopology!.branchFinishesBeforeMainResume).toBe(true)
        } else {
          expect(evidence.narrowTopology).toBeNull()
        }
        await context.close()
      }
    }
  })

  test('keeps section stage coordinates independent from longer nodes in another section', async ({ browser }) => {
    const firstSection = [
      '- 变更感知 -> 能搜的到、搜的准 -> 从 0 到 1 接入 -> "-" 到 "100分"',
      '                           -> 从 1 到 N 数据质量优化 -> "x 分" 到 "100分"',
      '',
    ]
    const context = await browser.newContext({
      baseURL: 'http://127.0.0.1:3344',
      viewport: { width: 1100, height: 800 },
    })
    const offsets: number[][] = []
    for (const defenseLine of [
      '- 防线 -> 有效拦截率 -> 影响面分析',
      '- 防线 -> 有效拦截率 -> 这是另一个 section 中故意加长并需要换行的影响面分析节点 -> 数据质量',
    ]) {
      const targetPage = await context.newPage()
      await loadFixture(targetPage, markdownFixture([...firstSection, defenseLine]))
      offsets.push(await targetPage.evaluate(() => {
        const section = document.querySelector<HTMLElement>('.markdown-flow-section')!
        const stageLeft = section.querySelector<HTMLElement>('.markdown-flow-stage')!.getBoundingClientRect().left
        return Array.from(section.querySelectorAll<HTMLElement>('.markdown-flow-lane-main .markdown-flow-map-node'))
          .map(node => node.getBoundingClientRect().left - stageLeft)
      }))
      await targetPage.close()
    }
    expect(offsets[1]).toHaveLength(offsets[0].length)
    for (const [index, offset] of offsets[0].entries()) {
      expect(Math.abs(offsets[1][index] - offset)).toBeLessThanOrEqual(1)
    }
    await context.close()
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
