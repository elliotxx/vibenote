import { expect, test, type Page } from '@playwright/test'

const created = '2026-08-11T12:00:00.000Z'
const content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n---block:markdown;auto=1;created=${created}\nBackup fixture`

async function load(page: Page, settings?: Partial<GitBackupSettings>, status?: Partial<GitBackupStatus>) {
  await page.addInitScript(({ content, settings, status }) => {
    localStorage.clear()
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
    if (settings) localStorage.setItem('vibenote:mock-git-backup-settings', JSON.stringify(settings))
    if (status) localStorage.setItem('vibenote:mock-git-backup-status', JSON.stringify(status))
  }, { content, settings, status })
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
  await page.getByTitle('设置').click()
  await expect(page.getByRole('heading', { name: 'Git 自动备份' })).toBeVisible()
}

test.describe('Git backup settings', () => {
  test('chooses a repository, enables backup, and persists status', async ({ page }) => {
    await load(page)

    const toggle = page.getByLabel('启用自动快照与安全推送')
    await expect(toggle).toBeDisabled()
    await expect(page.getByText('尚未选择仓库')).toBeVisible()

    await page.getByRole('button', { name: '选择 Git 仓库' }).click()
    await expect(page.getByText('Demo Git repository')).toBeVisible()
    await expect(toggle).toBeEnabled()
    await toggle.check()
    await expect(page.getByText('已创建本地快照提交')).toBeVisible()

    const saved = await page.evaluate(() => localStorage.getItem('vibenote:mock-git-backup-settings'))
    expect(saved).toContain('"enabled":true')
  })

  test('shows safe persistent states without exposing Git management controls', async ({ page }) => {
    const states = [
      ['pushed', '已安全推送'],
      ['push-failed', '本地提交已保留，推送失败'],
      ['push-manual-required', '本地提交已保留，请手动检查远端'],
      ['mirror-conflict', '备份快照被外部修改，已停止更新'],
      ['repository-unavailable', '备份仓库不可用'],
      ['conflict', 'Git 仓库存在未解决操作'],
    ] as const

    for (const [lastResult, label] of states) {
      await load(page, { repositoryPath: 'Synthetic repository' }, { lastResult })
      await expect(page.getByText(label)).toBeVisible()
    }

    for (const absent of ['周期', '分支', 'Remote', '凭据', '用户名', '邮箱']) {
      await expect(page.getByText(absent, { exact: true })).toHaveCount(0)
    }
  })

  test('keeps the controls readable at the minimum window width', async ({ page }) => {
    await page.setViewportSize({ width: 420, height: 640 })
    await load(page, {
      repositoryPath: 'Synthetic repository with an intentionally long display name',
      enabled: true,
    }, {
      lastResult: 'committed-local',
      lastCommitAt: created,
    })

    const panel = page.locator('.settings-panel')
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(420)
    await expect(page.getByRole('button', { name: '选择 Git 仓库' })).toBeVisible()
    await expect(page.getByText('已创建本地快照提交')).toBeVisible()
  })

  test('flushes the editor once and acknowledges the same quit request', async ({ page }) => {
    await load(page)
    await page.getByTitle('关闭设置').click()

    const result = await page.evaluate(async () => {
      let saves = 0
      const originalSave = window.vibenote.buffer.saveSync
      window.vibenote.buffer.saveSync = (...args) => {
        saves += 1
        return originalSave(...args)
      }
      const acknowledged = new Promise<string>(resolve => {
        window.addEventListener('vibenote:mock-flush-complete', event => {
          resolve((event as CustomEvent<string>).detail)
        }, { once: true })
      })
      window.dispatchEvent(new CustomEvent('vibenote:mock-flush-before-quit', { detail: 'quit-request-1' }))
      return { saves, requestId: await acknowledged }
    })

    expect(result).toEqual({ saves: 1, requestId: 'quit-request-1' })
  })
})
