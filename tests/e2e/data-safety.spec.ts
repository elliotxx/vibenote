import { expect, test, type Page } from '@playwright/test'

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'

function fixtureContent() {
  const created = '2026-07-08T00:00:00.000Z'
  return `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${[
    `---block:markdown;auto=1;created=${created}`,
    'first protected block',
    `---block:markdown;auto=1;created=${created}`,
    'second protected block',
  ].join('\n')}`
}

async function loadFixture(page: Page) {
  await page.addInitScript((content) => {
    localStorage.clear()
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
  }, fixtureContent())
  await page.goto('/')
  await expect(page.locator('.cm-editor')).toBeVisible()
}

async function loadFixtureWithRecovery(page: Page) {
  const recoveryContent = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream Recovery' })}\n${[
    '---block:markdown;auto=1;created=2026-07-08T00:00:00.000Z',
    'recovered draft block',
  ].join('\n')}`
  await page.addInitScript(({ content, recoveryContent }) => {
    localStorage.clear()
    localStorage.setItem('vibenote:mock-buffers', JSON.stringify([
      { path: 'stream.txt', name: 'Stream', tags: [], isScratch: true, content },
    ]))
    localStorage.setItem('vibenote:mock-recoveries', JSON.stringify([
      {
        documentId: 'internal:stream',
        identifier: 'stream.txt',
        filePath: '/tmp/vibenote-test/stream.txt',
        kind: 'internal',
        targetExists: true,
        updatedAt: '2026-07-08T00:01:00.000Z',
        content: recoveryContent,
      },
    ]))
  }, { content: fixtureContent(), recoveryContent })
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

test.describe('data safety guardrails', () => {
  test('creates a high-risk snapshot before deleting a block', async ({ page }) => {
    await loadFixture(page)
    await page.evaluate(() => {
      ;(window as any).__snapshots = []
      window.vibenote.buffer.snapshotSync = (path, content, reason) => {
        ;(window as any).__snapshots.push({ path, content, reason })
        return true
      }
    })

    await clickLine(page, 'first protected block')
    await page.keyboard.press(`${modifier}+Shift+D`)

    await expect(page.getByText('first protected block')).toHaveCount(0)
    await expect(page.getByText('second protected block')).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__snapshots)).toEqual([
      expect.objectContaining({
        path: 'stream.txt',
        reason: 'delete-block',
      }),
    ])
    const snapshotContent = await page.evaluate(() => (window as any).__snapshots[0].content)
    expect(snapshotContent).toContain('first protected block')
    expect(snapshotContent).toContain('second protected block')
  })

  test('stops destructive block deletion when snapshot creation fails', async ({ page }) => {
    await loadFixture(page)
    await page.evaluate(() => {
      window.vibenote.buffer.snapshotSync = () => {
        throw new Error('snapshot disk is full')
      }
    })

    await clickLine(page, 'first protected block')
    await page.keyboard.press(`${modifier}+Shift+D`)

    await expect(page.getByText('first protected block')).toBeVisible()
    await expect(page.getByText('second protected block')).toBeVisible()
    await expect(page.getByText('数据保护失败：snapshot disk is full')).toBeVisible()
  })

  test('inserts a recovery draft as new block without replacing current content', async ({ page }) => {
    await loadFixtureWithRecovery(page)
    await page.getByRole('button', { name: '恢复草稿' }).click()

    await expect(page.getByText('first protected block')).toBeVisible()
    await expect(page.getByText('second protected block')).toBeVisible()
    await expect(page.getByText('recovered draft block')).toBeVisible()
    await expect(page.getByText('已插入恢复草稿')).toBeVisible()
  })
})
