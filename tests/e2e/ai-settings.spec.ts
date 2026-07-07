import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function fixtureContent(lines = ['AI setting note']) {
  const created = '2026-07-02T12:00:00.000Z'
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    ...lines,
  ].join('\n')}`
}

async function loadFixture(page: Page, lines?: string[]) {
  await page.addInitScript((content) => {
    localStorage.clear()
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
  }, fixtureContent(lines))
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function openSettings(page: Page) {
  await page.getByTitle('设置').click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
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
  test('configures OpenAI-compatible providers without storing API keys in localStorage', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await expect(page.getByRole('heading', { name: 'AI' })).toBeVisible()
    await expect(page.getByLabel('Enable AI')).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Test connection' })).toBeDisabled()

    await page.getByLabel('Enable AI').check()
    await page.getByLabel('Provider').selectOption('deepseek')
    await expect(page.getByLabel('Base URL')).toHaveValue('https://api.deepseek.com')
    await expect(page.getByLabel('Model')).toHaveValue('deepseek-chat')

    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()
    await expect(page.getByText('API key saved locally and hidden')).toBeVisible()
    await expect(page.getByLabel('API Key')).toHaveValue('')
    await expect(page.getByLabel('API Key')).toHaveAttribute('placeholder', 'API key saved - paste a new key to replace')
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.getByText('Connection OK')).toBeVisible()

    await page.getByLabel('Provider').selectOption('openai')
    await expect(page.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1')
    await expect(page.getByLabel('Model')).toHaveValue('gpt-4.1-mini')

    await page.getByLabel('Provider').selectOption('custom-openai-compatible')
    await page.getByLabel('Base URL').fill('https://llm.example.com/v1')
    await page.getByLabel('Model').fill('custom-chat-model')
    await page.getByLabel('Model').blur()

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

    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()

    await expect(page.getByText('Could not save API key: Secure storage is not available')).toBeVisible()
    await expect(page.getByLabel('API Key')).toHaveValue('test-api-key-value')
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

    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()
    await expect(page.getByText('API key saved locally and hidden')).toBeVisible()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByText('API key cleared')).toBeVisible()
    await expect(page.getByLabel('API Key')).toHaveAttribute('placeholder', 'Paste API key')
    await expect(page.getByRole('button', { name: 'Test connection' })).toBeDisabled()
  })

  test('keeps API key state while switching providers', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()
    await expect(page.getByText('API key saved locally and hidden')).toBeVisible()

    await page.getByLabel('Provider').selectOption('openai')
    await expect(page.getByText('API key saved locally and hidden')).toBeVisible()
    await expect(page.getByLabel('Base URL')).toHaveValue('https://api.openai.com/v1')

    await page.getByLabel('Provider').selectOption('custom-openai-compatible')
    await expect(page.getByText('API key saved locally and hidden')).toBeVisible()
  })

  test('keeps select all scoped to focused settings inputs', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    const modelInput = page.getByLabel('Model')
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

  test('uses the whole current block as AI context when there is no selection', async ({ page }) => {
    const blockLines = [
      'first context line',
      '- keep this list item',
      'last context line',
    ]
    await loadFixture(page, blockLines)
    await openSettings(page)

    await page.getByLabel('Enable AI').check()
    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()
    await expect(page.getByText('API key saved locally and hidden')).toBeVisible()
    await page.getByTitle('Close settings').click()

    await page.evaluate(() => {
      ;(window as any).__aiPayloads = []
      window.vibenote.ai.complete = async (payload: AiCompletionRequest) => {
        ;(window as any).__aiPayloads.push(payload)
        return { ok: true, message: 'AI suggestion inserted', content: 'generated from block' }
      }
    })

    await page.getByText('- keep this list item').click()
    await expect.poll(() => hasNoVisibleEditorSelection(page)).toBe(true)
    await page.getByTitle('AI 根据选区或当前块生成新块').click()
    await expect(page.getByText('generated from block')).toBeVisible()

    await expect.poll(() => page.evaluate(() => (window as any).__aiPayloads)).toEqual([
      {
        input: blockLines.join('\n'),
        language: 'markdown',
        scope: 'block',
      },
    ])
  })

  test('shows readable connection errors without exposing request secrets', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.getByLabel('Enable AI').check()
    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()
    await expect(page.getByText('API key saved locally and hidden')).toBeVisible()

    await page.evaluate(() => {
      window.vibenote.ai.testConnection = async () => ({ ok: false, message: 'Connection failed (401)' })
    })
    await page.getByRole('button', { name: 'Test connection' }).click()
    await expect(page.getByText('Connection failed (401)')).toBeVisible()
    await expect(page.getByText('test-api-key-value')).toHaveCount(0)
    await expect(page.getByText('Authorization')).toHaveCount(0)

    await page.getByLabel('Model').fill('')
    await page.getByLabel('Model').blur()
    await page.evaluate(() => {
      delete (window.vibenote.ai as any).testConnection
    })
  })

  test('rejects empty model names before provider requests are considered valid', async ({ page }) => {
    await loadFixture(page)
    await openSettings(page)

    await page.getByLabel('Enable AI').check()
    await page.getByLabel('API Key').fill('test-api-key-value')
    await page.getByRole('button', { name: 'Save API key' }).click()
    await page.getByLabel('Model').fill('')
    await page.getByLabel('Model').blur()
    await page.getByRole('button', { name: 'Test connection' }).click()

    await expect(page.getByText('Model is required')).toBeVisible()
  })

  test('keeps AI settings usable in a narrow window', async ({ page }) => {
    await page.setViewportSize({ width: 520, height: 560 })
    await loadFixture(page)
    await openSettings(page)

    const panel = page.locator('.settings-panel')
    const aiSection = page.locator('.settings-section', { has: page.getByRole('heading', { name: 'AI' }) })
    await aiSection.scrollIntoViewIfNeeded()

    await expect(page.getByRole('heading', { name: 'AI' })).toBeVisible()
    await expect(page.getByLabel('Provider')).toBeVisible()
    await expect(page.getByLabel('Base URL')).toBeVisible()
    await expect(page.getByLabel('Model')).toBeVisible()
    await expect(page.getByLabel('API Key')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Save API key' })).toBeVisible()

    const panelBox = await panel.boundingBox()
    const buttonBox = await page.getByRole('button', { name: 'Save API key' }).boundingBox()
    expect(panelBox).not.toBeNull()
    expect(buttonBox).not.toBeNull()
    expect(buttonBox!.x).toBeGreaterThanOrEqual(panelBox!.x)
    expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width)
  })
})
