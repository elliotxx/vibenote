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
    await page.getByTitle('AI 优化选区或此块表述').click()
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('当前块表述优化')).toBeVisible()
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
    await page.getByTitle('AI 优化选区或此块表述').click()
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

  test('highlights only changed tokens in AI suggestion diffs', async ({ page }) => {
    await loadFixture(page, [
      '申请 code-host service-alpha service-beta service-gamma 大账号权限 P0 @member-a',
      '业务场景分类和打标，进一步打标 P3 @member-b token 消耗',
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
          '申请 code-host、service-alpha、service-beta、service-gamma 大账号权限 P0 @member-a',
          '业务场景分类和打标，继续推进 P3 @member-b，关注 token 消耗',
        ].join('\n'),
      })
    })

    await page.getByText('申请 code-host').click()
    await page.getByTitle('AI 优化选区或此块表述').click()
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

    expect(diffState.sourceChangedText.join('')).toContain('进一步打标')
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
    await page.getByTitle('AI 优化选区或此块表述').click()

    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('AI 返回内容与原文基本一致，未检测到文字差异。')).toBeVisible()
    await expect(page.locator('.ai-diff-segment.added')).toHaveCount(0)
    await expect(page.locator('.ai-diff-segment.removed')).toHaveCount(0)
  })

  test('scales the AI suggestion diff with editor font size', async ({ page }) => {
    await loadFixture(page, [
      '申请 code-host service-alpha service-beta service-gamma 大账号权限 P0 @member-a',
      '业务场景分类和打标，进一步打标 P3 @member-b token 消耗',
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
          '申请 code-host、service-alpha、service-beta、service-gamma 大账号权限 P0 @member-a',
          '业务场景分类和打标，继续推进 P3 @member-b，关注 token 消耗',
          '右侧最后一行需要完整展示',
        ].join('\n'),
      })
    })

    await page.getByText('申请 code-host').click()
    await page.getByTitle('AI 优化选区或此块表述').click()
    await expect(page.getByLabel('AI 表述优化建议')).toBeVisible()
    await expect(page.getByText('右侧最后一行需要完整展示')).toBeVisible()

    const metrics = await page.evaluate(() => {
      const popover = document.querySelector<HTMLElement>('.ai-suggestion-popover')
      const diff = document.querySelector<HTMLElement>('[data-testid="ai-diff-target"]')
      const body = document.querySelector<HTMLElement>('.ai-suggestion-body')
      return {
        width: popover?.getBoundingClientRect().width ?? 0,
        diffFontSize: diff ? Number.parseFloat(getComputedStyle(diff).fontSize) : 0,
        bodyMaxHeight: body ? Number.parseFloat(getComputedStyle(body).maxHeight) : 0,
      }
    })

    expect(metrics.width).toBeGreaterThan(900)
    expect(metrics.diffFontSize).toBeGreaterThan(20)
    expect(metrics.bodyMaxHeight).toBeGreaterThan(300)
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
    await page.getByTitle('AI 提取选区或此块 Todo').click()
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
