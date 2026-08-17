import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

const fixture = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
  '---block:markdown;auto=1;created=2026-08-17T12:00:00.000Z',
  'Shortcut panel fixture',
].join('\n')}`

async function loadFixture(page: Page) {
  await page.addInitScript((content) => {
    localStorage.clear()
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
  }, fixture)
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

test.describe('keyboard shortcuts panel', () => {
  test('opens from the status bar and toggles with the shortcut', async ({ page }) => {
    await loadFixture(page)

    await page.getByRole('button', { name: '快捷键' }).click()
    const panel = page.getByRole('dialog', { name: '快捷键' })
    await expect(panel).toBeVisible()

    await page.keyboard.press(`${modifier}+Slash`)
    await expect(panel).toBeHidden()
    await page.keyboard.press(`${modifier}+Slash`)
    await expect(panel).toBeVisible()
  })

  test('replaces settings, closes with Escape, and preserves note content', async ({ page }) => {
    await loadFixture(page)

    await page.getByRole('button', { name: '设置' }).click()
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()

    await page.keyboard.press(`${modifier}+Slash`)
    await expect(page.getByRole('heading', { name: '设置' })).toBeHidden()
    await expect(page.getByRole('dialog', { name: '快捷键' })).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '快捷键' })).toBeHidden()
    await expect.poll(() => page.evaluate(() => {
      const buffers = JSON.parse(localStorage.getItem('vibenote:mock-buffers') || '[]')
      return buffers[0]?.content || ''
    })).toBe(fixture)
  })

  test('shows categorized shortcuts and filters the visible commands', async ({ page }) => {
    await loadFixture(page)
    await page.getByRole('button', { name: '快捷键' }).click()

    const panel = page.getByRole('dialog', { name: '快捷键' })
    await expect(panel.getByRole('heading', { name: '应用' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'Block' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: '编辑' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: '搜索' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: '视图' })).toBeVisible()
    await expect(panel.getByText('显示或隐藏应用')).toBeVisible()
    await expect(panel.getByText('打开或关闭快捷键')).toBeVisible()
    await expect(panel.getByText('⌘ /')).toBeVisible()

    const search = panel.getByRole('searchbox', { name: '搜索快捷键' })
    await expect(search).toBeFocused()
    await search.fill('格式化')
    await expect(panel.locator('.shortcut-row')).toHaveCount(1)
    await expect(panel.getByText('格式化当前 Block')).toBeVisible()
    await expect(panel.getByRole('heading', { name: '应用' })).toBeHidden()
  })

  test('fits a narrow window and restores editor focus after closing', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 620 })
    await loadFixture(page)
    await page.getByRole('button', { name: '快捷键' }).click()

    const panel = page.getByRole('dialog', { name: '快捷键' })
    const panelBox = await panel.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(panelBox!.x).toBeGreaterThanOrEqual(0)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(480)

    const firstRow = panel.locator('.shortcut-row').first()
    const labelBox = await firstRow.locator('> span').first().boundingBox()
    const keysBox = await firstRow.locator('.shortcut-keys').boundingBox()
    expect(labelBox).not.toBeNull()
    expect(keysBox).not.toBeNull()
    expect(keysBox!.y).toBeGreaterThan(labelBox!.y)

    await page.getByRole('button', { name: '关闭快捷键' }).click()
    await expect(panel).toBeHidden()
    await expect(page.locator('.cm-content')).toBeFocused()
  })
})
