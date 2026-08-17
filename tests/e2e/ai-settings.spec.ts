import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function fixtureContent(lines = ['AI setting note']) {
  const created = '2026-07-02T12:00:00.000Z'
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    ...lines,
  ].join('\n')}`
}

async function loadFixture(page: Page, lines?: string[], settings?: Record<string, unknown>) {
  await page.addInitScript(({ content, settings }) => {
    localStorage.clear()
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
    if (settings) {
      localStorage.setItem('vibenote:settings', JSON.stringify({
        theme: 'light',
        fontSize: 13,
        tabSize: 2,
        defaultLanguage: 'markdown',
        ...settings,
      }))
    }
  }, { content: fixtureContent(lines), settings })
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function openSettings(page: Page) {
  await page.getByTitle('设置').click()
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
}

async function clickBlockToolbarAction(page: Page, title: string) {
  const host = page.locator('.editor-host')
  const box = await host.boundingBox()
  if (!box) throw new Error('Editor host not found')
  await page.mouse.move(box.x + box.width - 24, box.y + 24)

  const action = page.getByTitle(title)
  await expect(action).toBeVisible()
  await action.click()
}

async function hasNoVisibleEditorSelection(page: Page) {
  return page.evaluate(() => {
    return !Array.from(document.querySelectorAll<HTMLElement>('.cm-selectionBackground'))
      .some((background) => {
        const rect = background.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
  })
}

test.describe('AI settings', () => {
  test('toggles settings with the preferences shortcut', async ({ page }) => {
    await loadFixture(page)
    await page.keyboard.press(`${modifier}+Comma`)
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
    await expect(page.locator('.settings-panel')).toBeVisible()

    await page.keyboard.press(`${modifier}+Comma`)
    await expect(page.locator('.settings-panel')).toBeHidden()
  })

  test('persists image storage preference', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.getByLabel('图片存储').selectOption('app-data')
    await expect(page.getByLabel('图片存储')).toHaveValue('app-data')

    const stored = await page.evaluate(() => localStorage.getItem('vibenote:settings') || '')
    expect(stored).toContain('"imageStorage":"app-data"')
  })

  test('loads persisted image storage preference on startup', async ({ page }) => {
    await page.addInitScript((content) => {
      localStorage.clear()
      localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
        { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
      ]))
      localStorage.setItem('vibenote:settings', JSON.stringify({
        theme: 'light',
        fontSize: 13,
        tabSize: 2,
        defaultLanguage: 'markdown',
        imageStorage: 'app-data',
      }))
    }, fixtureContent())
    await page.goto('/')
    await expect(page.locator('.cm-editor')).toBeVisible()
    await openSettings(page)
    await expect(page.getByLabel('图片存储')).toHaveValue('app-data')
  })

  test('configures OpenAI-compatible providers without storing API keys in localStorage', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await expect(page.getByRole('heading', { name: 'AI' })).toBeVisible()
    await expect(page.getByLabel('启用 AI')).not.toBeChecked()
    await expect(page.getByRole('button', { name: '测试连接' })).toBeDisabled()

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('服务商').selectOption('deepseek')
    await expect(page.getByLabel('基础 URL')).toHaveValue('https://api.deepseek.com')
    await expect(page.getByLabel('模型')).toHaveValue('deepseek-chat')

    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await expect(page.getByLabel('API 密钥')).toHaveValue('')
    await expect(page.getByLabel('API 密钥')).toHaveAttribute('placeholder', '已保存 API 密钥，粘贴新密钥可替换')
    await page.getByRole('button', { name: '测试连接' }).click()
    await expect(page.getByText('连接成功')).toBeVisible()

    await page.getByLabel('服务商').selectOption('openai')
    await expect(page.getByLabel('基础 URL')).toHaveValue('https://api.openai.com/v1')
    await expect(page.getByLabel('模型')).toHaveValue('gpt-4.1-mini')

    await page.getByLabel('服务商').selectOption('custom-openai-compatible')
    await page.getByLabel('基础 URL').fill('https://llm.example.com/v1')
    await page.getByLabel('模型').fill('custom-chat-model')
    await page.getByLabel('模型').blur()

    const stored = await page.evaluate(() => ({
      settings: localStorage.getItem('vibenote:settings') || '',
      aiKey: localStorage.getItem('vibenote:ai-key') || '',
    }))
    expect(stored.settings).toContain('"provider":"custom-openai-compatible"')
    expect(stored.settings).toContain('"baseUrl":"https://llm.example.com/v1"')
    expect(stored.settings).toContain('"model":"custom-chat-model"')
    expect(stored.settings).not.toContain('test-api-key-value')
    expect(stored.aiKey).toBe('')
    await expect.poll(() => page.evaluate(() => {
      const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
      return buffers[0]?.content || ''
    })).not.toContain('test-api-key-value')
  })

  test('shows a visible error when API key saving fails', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.evaluate(() => {
      window.vibenote.ai.setApiKey = async () => {
        throw new Error('Secure storage is not available')
      }
    })

    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()

    await expect(page.getByText('无法保存 API 密钥：安全存储不可用')).toBeVisible()
    await expect(page.getByLabel('API 密钥')).toHaveValue('test-api-key-value')
  })

  test('shows local fallback key storage and supports clearing the key', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.evaluate(() => {
      window.vibenote.ai.setApiKey = async () => ({
        enabled: false,
        provider: 'deepseek',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        hasApiKey: true,
        keyStorage: 'local-fallback',
      })
    })

    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()

    await page.getByRole('button', { name: '清除' }).click()
    await expect(page.getByText('API 密钥已清除')).toBeVisible()
    await expect(page.getByLabel('API 密钥')).toHaveAttribute('placeholder', '粘贴 API 密钥')
    await expect(page.getByRole('button', { name: '测试连接' })).toBeDisabled()
  })

  test('keeps API key state while switching providers', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()

    await page.getByLabel('服务商').selectOption('openai')
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await expect(page.getByLabel('基础 URL')).toHaveValue('https://api.openai.com/v1')

    await page.getByLabel('服务商').selectOption('custom-openai-compatible')
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
  })

  test('keeps select all scoped to focused settings inputs', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    const modelInput = page.getByLabel('模型')
    await modelInput.click()
    await page.keyboard.press(`${modifier}+A`)

    await expect.poll(() => page.evaluate(() => {
      const active = document.activeElement as HTMLInputElement | null
      return {
        tagName: active?.tagName,
        label: active?.getAttribute('aria-label'),
        value: active?.value,
        selectionStart: active?.selectionStart,
        selectionEnd: active?.selectionEnd,
      }
    })).toEqual({
      tagName: 'INPUT',
      label: null,
      value: 'deepseek-chat',
      selectionStart: 0,
      selectionEnd: 'deepseek-chat'.length,
    })
    await expect.poll(() => hasNoVisibleEditorSelection(page)).toBe(true)
  })

  test('shows a reviewable AI polish suggestion for the current block', async ({ page }) => {
    const blockLines = [
      'first context line',
      '- keep this list item',
      'last context line',
    ]
    await loadFixture(page, blockLines)
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      ;(window as any).__aiPayloads = []
      window.vibenote.ai.complete = async (payload: AiCompletionRequest) => {
        ;(window as any).__aiPayloads.push(payload)
        return { ok: true, message: 'Polished note inserted', content: 'polished from block' }
      }
    })

    await page.getByText('- keep this list item').click()
    await expect.poll(() => hasNoVisibleEditorSelection(page)).toBe(true)
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('表述优化 / 当前块')).toBeVisible()
    await expect(page.getByText('polished from block')).toBeVisible()
    await expect(page.locator('[data-testid="ai-diff-source"] .ai-diff-segment.removed').first()).toBeVisible()
    await expect(page.locator('[data-testid="ai-diff-target"] .ai-diff-segment.added').first()).toBeVisible()
    await expect(page.getByText('first context line')).toHaveCount(2)

    const diffStyles = await page.evaluate(() => {
      const sourceColumn = document.querySelector<HTMLElement>('.ai-suggestion-column')
      const targetColumn = document.querySelector<HTMLElement>('.ai-suggestion-column.suggestion')
      const changedLine = document.querySelector<HTMLElement>('[data-testid="ai-diff-target"] .ai-diff-line.changed')
      const addedSegment = document.querySelector<HTMLElement>('[data-testid="ai-diff-target"] .ai-diff-segment.added')
      return {
        sourceColumnBackground: sourceColumn ? getComputedStyle(sourceColumn).backgroundColor : '',
        targetColumnBackground: targetColumn ? getComputedStyle(targetColumn).backgroundColor : '',
        changedLineBackground: changedLine ? getComputedStyle(changedLine).backgroundColor : '',
        addedSegmentBackground: addedSegment ? getComputedStyle(addedSegment).backgroundColor : '',
        addedSegmentRadius: addedSegment ? getComputedStyle(addedSegment).borderRadius : '',
        addedSegmentShadow: addedSegment ? getComputedStyle(addedSegment).boxShadow : '',
      }
    })

    expect(diffStyles.targetColumnBackground).toBe(diffStyles.sourceColumnBackground)
    expect(diffStyles.changedLineBackground).toBe('rgba(0, 0, 0, 0)')
    expect(diffStyles.addedSegmentBackground).not.toBe('rgba(0, 0, 0, 0)')
    expect(diffStyles.addedSegmentRadius).toBe('0px')
    expect(diffStyles.addedSegmentShadow).toBe('none')

    await expect.poll(() => page.evaluate(() => (window as any).__aiPayloads)).toEqual([
      {
        input: blockLines.join('\n'),
        language: 'markdown',
        mode: 'polish',
        scope: 'block',
      },
    ])

    await page.getByRole('button', { name: '替换原文' }).click()
    await expect(page.getByLabel('AI 表述优化建议')).toHaveCount(0)
    await expect(page.getByText('polished from block')).toBeVisible()
    await expect(page.getByText('- keep this list item')).toHaveCount(0)
  })

  test('keeps an AI suggestion compact while generation is pending', async ({ page }) => {
    await loadFixture(page, ['rough sentence'])
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      window.vibenote.ai.complete = async () => new Promise(() => {})
    })

    await page.getByText('rough sentence').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')

    const popover = page.getByLabel('AI 表述优化建议')
    await expect(popover).toHaveClass(/loading/)
    await expect(popover.getByRole('status')).toHaveText('优化表述中')
    await expect(popover.locator('.ai-suggestion-body')).toHaveCount(0)
    await expect(popover.locator('.ai-suggestion-actions')).toHaveCount(0)

    const box = await popover.boundingBox()
    const editorHostBox = await page.locator('.editor-host').boundingBox()
    expect(box).not.toBeNull()
    expect(editorHostBox).not.toBeNull()
    expect(box!.height).toBeLessThan(120)
    expect(box!.width).toBeLessThanOrEqual(360)
    expect(Math.abs(
      box!.x + box!.width / 2 - (editorHostBox!.x + editorHostBox!.width / 2),
    )).toBeLessThanOrEqual(1)

    const loadingLayout = await popover.evaluate((element) => {
      const status = element.querySelector<HTMLElement>('.ai-suggestion-loading')
      const popoverRect = element.getBoundingClientRect()
      const statusRect = status?.getBoundingClientRect()
      return {
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        popoverBottom: popoverRect.bottom,
        statusBottom: statusRect?.bottom ?? 0,
      }
    })
    expect(loadingLayout.scrollHeight).toBeLessThanOrEqual(loadingLayout.clientHeight)
    expect(loadingLayout.statusBottom).toBeLessThanOrEqual(loadingLayout.popoverBottom + 1)
  })

  test('expands an AI suggestion from the loading card without a horizontal jump', async ({ page }) => {
    await loadFixture(page, ['rough sentence'])
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      ;(window as any).__resolveAiSuggestion = null
      window.vibenote.ai.complete = async () => new Promise((resolve) => {
        ;(window as any).__resolveAiSuggestion = resolve
      })
    })

    await page.getByText('rough sentence').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')

    const popover = page.getByLabel('AI 表述优化建议')
    await expect(popover).toHaveClass(/loading/)
    const loadingBox = await popover.boundingBox()
    expect(loadingBox).not.toBeNull()

    await page.evaluate(() => {
      ;(window as any).__resolveAiSuggestion?.({
        ok: true,
        message: 'Polished note ready',
        content: 'polished sentence',
      })
    })

    await expect(popover).not.toHaveClass(/loading/)
    const expandedBox = await popover.boundingBox()
    expect(expandedBox).not.toBeNull()
    expect(Math.abs(
      loadingBox!.x + loadingBox!.width / 2 - (expandedBox!.x + expandedBox!.width / 2),
    )).toBeLessThanOrEqual(1)
  })

  test('retries a failed AI suggestion with the captured source text', async ({ page }) => {
    await loadFixture(page, ['rough sentence'])
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      ;(window as any).__aiInputs = []
      window.vibenote.ai.complete = async (request) => {
        ;(window as any).__aiInputs.push(request.input)
        if ((window as any).__aiInputs.length === 1) {
          return { ok: false, message: 'fetch failed', content: '' }
        }
        return new Promise((resolve) => {
          ;(window as any).__resolveRetryAiSuggestion = resolve
        })
      }
    })

    await page.getByText('rough sentence').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')

    const popover = page.getByLabel('AI 表述优化建议')
    await expect(popover.locator('.ai-suggestion-error-state')).toContainText('fetch failed')
    await expect(popover.getByRole('button', { name: '重试' })).toBeVisible()
    await expect(popover.locator('.ai-suggestion-body')).toHaveCount(0)

    await popover.getByRole('button', { name: '重试' }).click()
    await expect(popover).toHaveClass(/loading/)
    await page.evaluate(() => {
      ;(window as any).__resolveRetryAiSuggestion?.({
        ok: true,
        message: 'Polished note ready',
        content: 'polished sentence',
      })
    })
    await expect(popover).not.toHaveClass(/loading/)
    await expect(popover.getByText('polished sentence')).toBeVisible()
    await expect(page.getByLabel('AI 表述优化建议')).toHaveCount(1)
    await expect.poll(() => page.evaluate(() => (window as any).__aiInputs)).toEqual([
      'rough sentence',
      'rough sentence',
    ])
  })

  test('keeps a completed AI suggestion at its original source after scrolling during loading', async ({ page }) => {
    await loadFixture(page, Array.from({ length: 72 }, (_, index) => `scrollable line ${index + 1}`))
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      ;(window as any).__resolveScrolledAiSuggestion = null
      window.vibenote.ai.complete = async () => new Promise((resolve) => {
        ;(window as any).__resolveScrolledAiSuggestion = resolve
      })
    })

    await page.getByText('scrollable line 5', { exact: true }).click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')

    const popover = page.getByLabel('AI 表述优化建议')
    await expect(popover).toHaveClass(/loading/)
    await page.locator('.cm-scroller').evaluate(element => {
      element.scrollTop = 900
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(popover).toBeHidden()

    await page.evaluate(() => {
      ;(window as any).__resolveScrolledAiSuggestion?.({
        ok: true,
        message: 'Polished note ready',
        content: 'polished suggestion after scroll',
      })
    })

    await expect(popover).toBeHidden()
    await expect(popover).not.toHaveClass(/loading/)

    await page.locator('.cm-scroller').evaluate(element => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect(popover).toBeVisible()
    await expect(popover.getByText('polished suggestion after scroll')).toBeVisible()
  })

  test('can insert or copy an AI polish suggestion without replacing text', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'http://127.0.0.1:3344',
    })
    const blockLines = ['rough sentence', 'second line']
    await loadFixture(page, blockLines)
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      window.vibenote.ai.complete = async () => ({
        ok: true,
        message: 'Polished note inserted',
        content: 'polished sentence\nkeeps line breaks',
      })
    })

    await page.getByText('rough sentence').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()

    await page.getByRole('button', { name: '复制' }).click()
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('polished sentence\nkeeps line breaks')
    await expect(page.getByText('rough sentence')).toHaveCount(2)

    await page.getByRole('button', { name: '插入新块' }).click()
    await expect(page.getByLabel('AI 表述优化建议')).toHaveCount(0)
    await expect(page.getByText('rough sentence')).toBeVisible()
    await expect(page.getByText('polished sentence')).toBeVisible()
    await expect(page.getByText('keeps line breaks')).toBeVisible()
  })

  test('shows lightweight AI actions for a selection and opens a diff for rewrite', async ({ page }) => {
    await loadFixture(page, ['quick action draft'])
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      window.vibenote.ai.complete = async payload => ({
        ok: true,
        message: 'Polished selection',
        content: payload.instruction ? `custom: ${payload.instruction}` : 'polished selection',
      })
    })

    await page.getByText('quick action draft', { exact: true }).dblclick()
    const actions = page.getByRole('toolbar', { name: 'AI 快捷操作' })
    await expect(actions).toBeVisible()
    const [actionsBox, editorBox] = await Promise.all([
      actions.boundingBox(),
      page.locator('.editor-host').boundingBox(),
    ])
    expect(actionsBox).not.toBeNull()
    expect(editorBox).not.toBeNull()
    expect(Math.abs(
      (actionsBox!.x + actionsBox!.width / 2) - (editorBox!.x + editorBox!.width / 2),
    )).toBeLessThan(3)
    await expect(actions.getByRole('button', { name: '编辑' })).toBeVisible()
    await expect(actions.getByRole('button', { name: '改写' })).toBeVisible()
    await expect(actions.getByRole('button', { name: '提取 Todo' })).toBeVisible()

    await actions.getByRole('button', { name: '编辑', exact: true }).click()
    await expect(actions.getByRole('textbox', { name: '自定义修改或提问' })).toBeVisible()
    await actions.getByRole('textbox', { name: '自定义修改或提问' }).fill('改得更简洁')
    await actions.getByRole('textbox', { name: '自定义修改或提问' }).press('Enter')
    await expect(actions).toBeHidden()
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('custom: 改得更简洁')).toBeVisible()

    await page.getByTitle('关闭建议').click()
    await page.getByText('quick action draft', { exact: true }).dblclick()
    await actions.getByRole('button', { name: '编辑', exact: true }).click()
    await actions.getByRole('textbox', { name: '自定义修改或提问' }).fill('你觉得这一段写得怎么样？')
    await actions.getByRole('textbox', { name: '自定义修改或提问' }).press('Enter')
    const answerPopover = page.getByLabel('AI 表述优化建议')
    await expect(answerPopover.getByText('AI 回复')).toBeVisible()
    await expect(answerPopover.getByText('custom: 你觉得这一段写得怎么样？')).toBeVisible()
    await expect(answerPopover.getByRole('button', { name: '替换原文' })).toHaveCount(0)

    await page.getByTitle('关闭建议').click()
    await expect(page.getByLabel('AI 表述优化建议')).toHaveCount(0)
    await page.getByText('quick action draft', { exact: true }).dblclick()
    await expect(actions).toBeVisible()
    await actions.getByRole('button', { name: '改写' }).click()
    await expect(actions).toBeHidden()
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('polished selection')).toBeVisible()
  })

  test('allows moving and resizing the AI suggestion popover inside the editor', async ({ page }) => {
    await loadFixture(page, ['rough sentence', 'second line'])
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      window.vibenote.ai.complete = async () => ({
        ok: true,
        message: 'Polished note inserted',
        content: 'polished sentence\nkeeps line breaks',
      })
    })

    await page.getByText('rough sentence').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()

    const beforeMove = await page.locator('.ai-suggestion-popover').boundingBox()
    const headerBox = await page.locator('.ai-suggestion-header').boundingBox()
    expect(beforeMove).not.toBeNull()
    expect(headerBox).not.toBeNull()
    await page.mouse.move(headerBox!.x + 80, headerBox!.y + headerBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(headerBox!.x + 210, headerBox!.y + 90)
    await page.mouse.up()

    const afterMove = await page.locator('.ai-suggestion-popover').boundingBox()
    expect(afterMove).not.toBeNull()
    expect(afterMove!.x).toBeGreaterThan(beforeMove!.x + 40)
    expect(afterMove!.y).toBeGreaterThan(beforeMove!.y + 30)

    const handleBox = await page.locator('.ai-suggestion-resize-handle').boundingBox()
    expect(handleBox).not.toBeNull()
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox!.x + 160, handleBox!.y + 120)
    await page.mouse.up()

    const afterResize = await page.locator('.ai-suggestion-popover').boundingBox()
    const hostBox = await page.locator('.editor-host').boundingBox()
    expect(afterResize).not.toBeNull()
    expect(hostBox).not.toBeNull()
    expect(afterResize!.width).toBeGreaterThan(afterMove!.width + 40)
    expect(afterResize!.height).toBeGreaterThan(afterMove!.height + 30)
    expect(afterResize!.x + afterResize!.width).toBeLessThanOrEqual(hostBox!.x + hostBox!.width + 1)
    expect(afterResize!.y + afterResize!.height).toBeLessThanOrEqual(hostBox!.y + hostBox!.height + 1)
  })

  test('anchors AI suggestion popovers to their source text and allows multiple cards', async ({ page }) => {
    await loadFixture(page, Array.from({ length: 72 }, (_, index) => `scrollable line ${index + 1}`))
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      ;(window as any).__aiCallCount = 0
      window.vibenote.ai.complete = async () => {
        const count = ++(window as any).__aiCallCount
        return {
          ok: true,
          message: `Polished note ${count}`,
          content: `polished suggestion ${count}`,
        }
      }
    })

    await page.getByText('scrollable line 5', { exact: true }).click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    const popovers = page.getByLabel('AI 表述优化建议')
    await expect(popovers).toHaveCount(1)
    await expect(page.getByText('polished suggestion 1')).toBeVisible()

    const firstBeforeScroll = await page.locator('.ai-suggestion-popover').first().boundingBox()
    expect(firstBeforeScroll).not.toBeNull()
    await expect(page.locator('.ai-suggestion-popover').first()).toHaveCSS('position', 'absolute')
    expect(await page.locator('.ai-suggestion-popover').first().evaluate(element => element.parentElement?.classList.contains('editor-host'))).toBe(true)
    await page.locator('.cm-scroller').evaluate(element => {
      element.scrollTop = 900
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect.poll(() => page.locator('.cm-scroller').evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await expect(page.locator('.ai-suggestion-popover').first()).toBeHidden()

    await page.locator('.cm-scroller').evaluate(element => {
      element.scrollTop = 0
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
    })
    await expect(page.locator('.ai-suggestion-popover').first()).toBeVisible()
    const firstAfterReturn = await page.locator('.ai-suggestion-popover').first().boundingBox()
    expect(firstAfterReturn).not.toBeNull()
    expect(Math.abs(firstAfterReturn!.x - firstBeforeScroll!.x)).toBeLessThan(2)
    expect(Math.abs(firstAfterReturn!.y - firstBeforeScroll!.y)).toBeLessThan(2)

    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    await expect(popovers).toHaveCount(2)
    await expect(page.getByText('polished suggestion 2')).toBeVisible()
  })

  test('marks an AI suggestion stale instead of replacing changed source text', async ({ page }) => {
    await loadFixture(page, ['rough sentence'])
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      window.vibenote.ai.complete = async () => ({
        ok: true,
        message: 'Polished note inserted',
        content: 'polished sentence',
      })
    })

    await page.locator('.cm-content .cm-line', { hasText: 'rough sentence' }).first().click({ force: true })
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('polished sentence')).toBeVisible()

    await page.locator('.cm-content .cm-line', { hasText: 'rough sentence' }).first().click({ force: true })
    await page.keyboard.press('End')
    await page.keyboard.insertText(' changed')

    await page.getByRole('button', { name: '替换原文' }).click()
    await expect(page.locator('.ai-suggestion-message.stale')).toHaveText('原文已变化，请复制、插入新块或回到原文后重新生成')
    await expect(page.getByText('rough sentence changed')).toBeVisible()
    await expect(page.getByText('polished sentence')).toBeVisible()
  })

  test('highlights only changed tokens in AI suggestion diffs', async ({ page }) => {
    await loadFixture(page, [
      '申请 code-host project-alpha 权限 P0 <member-a>',
      '业务场景分类和标记，进一步标记 P3 <member-b> token 消耗',
    ])
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      window.vibenote.ai.complete = async () => ({
        ok: true,
        message: 'Polished note inserted',
        content: [
          '申请 code-host、project-alpha 权限 P0 <member-a>',
          '业务场景分类和标记，继续推进 P3 <member-b>，关注 token 消耗',
        ].join('\n'),
      })
    })

    await page.getByText('申请 code-host').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()

    const diffState = await page.evaluate(() => {
      const source = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ai-diff-source"] .ai-diff-line'))
      const target = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="ai-diff-target"] .ai-diff-line'))
      return {
        sourceChangedText: source.flatMap(line => Array.from(line.querySelectorAll<HTMLElement>('.removed')).map(segment => segment.textContent || '')),
        targetChangedText: target.flatMap(line => Array.from(line.querySelectorAll<HTMLElement>('.added')).map(segment => segment.textContent || '')),
        targetFirstLineText: target[0]?.textContent || '',
        targetFirstLineChangedText: Array.from(target[0]?.querySelectorAll<HTMLElement>('.added') || []).map(segment => segment.textContent || '').join(''),
      }
    })

    expect(diffState.sourceChangedText.join('')).toContain('进一步标记')
    expect(diffState.targetChangedText.join('')).toContain('继续推进')
    expect(diffState.targetFirstLineText).toContain('申请 code-host')
    expect(diffState.targetFirstLineChangedText).not.toContain('申请 code-host')
  })

  test('explains when AI polish returns unchanged content', async ({ page }) => {
    const blockLines = [
      '- 已经足够清晰',
      '- 保持原样即可',
    ]
    await loadFixture(page, blockLines)
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate((content) => {
      window.vibenote.ai.complete = async () => ({
        ok: true,
        message: 'No visible edits',
        content,
      })
    }, blockLines.join('\n'))

    await page.getByText('已经足够清晰').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')

    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('AI 返回内容与原文基本一致，未检测到文字差异。')).toBeVisible()
    await expect(page.locator('.ai-diff-segment.added')).toHaveCount(0)
    await expect(page.locator('.ai-diff-segment.removed')).toHaveCount(0)
  })

  test('scales the AI suggestion diff with editor font size', async ({ page }) => {
    await loadFixture(page, [
      '申请 code-host project-alpha 权限 P0 <member-a>',
      '业务场景分类和标记，进一步标记 P3 <member-b> token 消耗',
    ], { fontSize: 36 })
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      window.vibenote.ai.complete = async () => ({
        ok: true,
        message: 'Polished note inserted',
        content: [
          '申请 code-host、project-alpha 权限 P0 <member-a>',
          '业务场景分类和标记，继续推进 P3 <member-b>，关注 token 消耗',
          '右侧最后一行需要完整展示',
        ].join('\n'),
      })
    })

    await page.getByText('申请 code-host').click()
    await clickBlockToolbarAction(page, 'AI 优化选区或此块表述')
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('右侧最后一行需要完整展示')).toBeVisible()

    const metrics = await page.evaluate(() => {
      const popover = document.querySelector<HTMLElement>('.ai-suggestion-popover')
      const diff = document.querySelector<HTMLElement>('[data-testid="ai-diff-target"]')
      const body = document.querySelector<HTMLElement>('.ai-suggestion-body')
      return {
        width: popover?.getBoundingClientRect().width ?? 0,
        diffFontSize: diff ? Number.parseFloat(getComputedStyle(diff).fontSize) : 0,
        bodyHeight: body?.getBoundingClientRect().height ?? 0,
      }
    })

    expect(metrics.width).toBeGreaterThan(900)
    expect(metrics.diffFontSize).toBeGreaterThan(20)
    expect(metrics.bodyHeight).toBeGreaterThan(300)
  })

  test('extracts todos from the current block as a Markdown checklist', async ({ page }) => {
    const blockLines = [
      '本周推进发布前检查',
      '- 确认安装提示词可用',
      '- 修复设置保存问题',
      '讨论是否需要发布新版本',
    ]
    await loadFixture(page, blockLines)
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()
    await page.getByTitle('关闭设置').click()

    await page.evaluate(() => {
      ;(window as any).__aiPayloads = []
      window.vibenote.ai.complete = async (payload: AiCompletionRequest) => {
        ;(window as any).__aiPayloads.push(payload)
        return {
          ok: true,
          message: 'Todo list inserted',
          content: [
            '- [ ] 成本中心:',
            '- [ ] e2e case',
            '- [ ] 确认安装提示词可用',
            '- [ ] 修复设置保存问题',
            '- [ ] 判断是否发布新版本',
          ].join('\n'),
        }
      }
    })

    await page.getByText('修复设置保存问题').click()
    await clickBlockToolbarAction(page, 'AI 提取选区或此块 Todo')
    await expect(page.getByText('- 判断是否发布新版本')).toBeVisible()
    await expect(page.getByText('- 确认安装提示词可用')).toHaveCount(2)
    await expect(page.getByText('成本中心:')).toHaveCount(0)
    await expect(page.getByText('e2e case')).toHaveCount(0)

    await expect.poll(() => page.evaluate(() => (window as any).__aiPayloads)).toEqual([
      {
        input: blockLines.join('\n'),
        language: 'markdown',
        mode: 'extract-todos',
        scope: 'block',
      },
    ])
  })

  test('shows readable connection errors without exposing request secrets', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await expect(page.getByText('API 密钥已本地保存并隐藏')).toBeVisible()

    await page.evaluate(() => {
      window.vibenote.ai.testConnection = async () => ({ ok: false, message: 'Connection failed (401)' })
    })
    await page.getByRole('button', { name: '测试连接' }).click()
    await expect(page.getByText('连接失败（401）')).toBeVisible()
    await expect(page.getByText('test-api-key-value')).toHaveCount(0)
    await expect(page.getByText('Authorization')).toHaveCount(0)

    await page.getByLabel('模型').fill('')
    await page.getByLabel('模型').blur()
    await page.evaluate(() => {
      delete (window.vibenote.ai as any).testConnection
    })
  })

  test('rejects empty model names before provider requests are considered valid', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.getByLabel('启用 AI').check()
    await page.getByLabel('API 密钥').fill('test-api-key-value')
    await page.getByRole('button', { name: '保存 API 密钥' }).click()
    await page.getByLabel('模型').fill('')
    await page.getByLabel('模型').blur()
    await page.getByRole('button', { name: '测试连接' }).click()

    await expect(page.getByText('需要填写模型')).toBeVisible()
  })

  test('keeps AI settings usable in a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 560 })
    await loadFixture(page)
    await openSettings(page)

    const panel = page.locator('.settings-panel')
    const aiSection = page.locator('.settings-section', { has: page.getByRole('heading', { name: 'AI' }) })
    await aiSection.scrollIntoViewIfNeeded()

    await expect(page.getByRole('heading', { name: 'AI' })).toBeVisible()
    await expect(page.getByLabel('服务商')).toBeVisible()
    await expect(page.getByLabel('基础 URL')).toBeVisible()
    await expect(page.getByLabel('模型')).toBeVisible()
    await expect(page.getByLabel('API 密钥')).toBeVisible()
    await expect(page.getByRole('button', { name: '保存 API 密钥' })).toBeVisible()

    const panelBox = await panel.boundingBox()
    const buttonBox = await page.getByRole('button', { name: '保存 API 密钥' }).boundingBox()
    expect(panelBox).not.toBeNull()
    expect(buttonBox).not.toBeNull()
    expect(buttonBox!.x).toBeGreaterThanOrEqual(panelBox!.x)
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width)
  })
})
