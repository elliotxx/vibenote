import { expect, test } from '@playwright/test'

test('settings can install and uninstall the Agent CLI', async ({ page }) => {
  await page.goto('/')
  await page.getByTitle('设置').click()
  const section = page.locator('.settings-section', { has: page.getByRole('heading', { name: 'Agent CLI' }) })

  await expect(section).toContainText('尚未安装')
  await section.getByRole('button', { name: '安装 Agent CLI' }).click()
  await expect(section).toContainText('已安装')
  await section.getByRole('button', { name: '卸载' }).click()
  await expect(section).toContainText('尚未安装')
})
