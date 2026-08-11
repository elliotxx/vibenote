import { _electron as electron } from 'playwright'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const executablePath = path.join(root, 'dist', `mac-${releaseArch}`, 'Vibenote.app', 'Contents', 'MacOS', 'Vibenote')

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`ok - ${message}`)
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (result.status !== 0) throw new Error('isolated Git fixture command failed')
  return result.stdout.trim()
}

function hashFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

async function main() {
  check(fs.existsSync(executablePath), 'packaged app executable is available')
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-git-runtime-'))
  const userDataPath = path.join(fixtureRoot, 'user-data')
  const notesPath = path.join(userDataPath, 'notes')
  const streamPath = path.join(notesPath, 'stream.txt')
  const repositoryPath = path.join(fixtureRoot, 'backup-repository')
  const remotePath = path.join(fixtureRoot, 'backup-remote.git')
  const marker = `quit-backup-${Date.now()}`
  let app

  try {
    fs.mkdirSync(notesPath, { recursive: true })
    fs.mkdirSync(repositoryPath)
    fs.mkdirSync(remotePath)
    fs.writeFileSync(streamPath, `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n---block:markdown;auto=1;created=2026-08-11T00:00:00.000Z\nInitial backup note`)
    git(repositoryPath, ['init'])
    git(repositoryPath, ['config', 'user.name', 'Vibenote Backup Test'])
    git(repositoryPath, ['config', 'user.email', 'vibenote-backup-test@users.noreply.github.com'])
    git(remotePath, ['init', '--bare'])
    git(repositoryPath, ['remote', 'add', 'origin', remotePath])
    fs.writeFileSync(path.join(userDataPath, 'git-backup-settings.json'), `${JSON.stringify({
      version: 1,
      enabled: false,
      repositoryPath,
      repositoryInitializedByApp: true,
    }, null, 2)}\n`, { mode: 0o600 })

    app = await electron.launch({
      executablePath,
      env: {
        ...process.env,
        VIBENOTE_HEADLESS_VERIFY: '1',
        VIBENOTE_USER_DATA_DIR: userDataPath,
      },
      timeout: 20_000,
    })
    const page = await app.firstWindow({ timeout: 20_000 })
    await page.locator('.cm-editor').waitFor({ state: 'attached', timeout: 20_000 })
    await page.getByTitle('设置').click()
    await page.getByLabel('启用自动快照与安全推送').check()
    await page.getByText('已安全推送').waitFor({ timeout: 15_000 })
    check(git(repositoryPath, ['rev-list', '--count', 'HEAD']) === '1', 'enabling creates one scoped snapshot commit')
    const branch = git(repositoryPath, ['branch', '--show-current'])
    const remoteHeadAfterEnable = git(repositoryPath, ['--git-dir', remotePath, 'rev-parse', `refs/heads/${branch}`])
    check(git(repositoryPath, ['rev-parse', 'HEAD']) === remoteHeadAfterEnable, 'safe automatic push reaches the isolated remote')

    await page.getByTitle('关闭设置').click()
    await page.locator('.cm-content').click()
    await page.keyboard.insertText(marker)
    const persisted = await page.waitForFunction(marker => {
      const buffers = localStorage.getItem('unused')
      void buffers
      return document.querySelector('.cm-content')?.textContent?.includes(marker)
    }, marker)
    await persisted.dispose()
    await new Promise(resolve => setTimeout(resolve, 500))
    check(fs.readFileSync(streamPath, 'utf8').includes(marker), 'renderer autosave reaches the source note before quit')
    const sourceHashBeforeQuit = hashFile(streamPath)

    const exited = new Promise(resolve => app.process().once('exit', resolve))
    const quitStartedAt = Date.now()
    await app.evaluate(({ app }) => { setTimeout(() => app.quit(), 0) })
    await Promise.race([
      exited,
      new Promise((_, reject) => setTimeout(() => reject(new Error('packaged app did not quit within its fixed budget')), 6_500)),
    ])
    app = null
    check(Date.now() - quitStartedAt <= 6_500, 'quit flush completes within the fixed total budget')
    check(hashFile(streamPath) === sourceHashBeforeQuit, 'backup processing leaves the source note unchanged')
    check(git(repositoryPath, ['rev-list', '--count', 'HEAD']) === '2', 'quit flush creates one additional local commit')
    check(git(repositoryPath, ['rev-parse', 'HEAD']) !== remoteHeadAfterEnable, 'quit flush remains local and does not push')

    const manifest = JSON.parse(fs.readFileSync(path.join(repositoryPath, 'vibenote-backup', 'manifest.json'), 'utf8'))
    const streamDocument = manifest.documents.find(document => document.relativePath === 'stream.txt')
    check(Boolean(streamDocument), 'packaged snapshot manifest includes the internal stream')
    const exported = fs.readFileSync(path.join(repositoryPath, 'vibenote-backup', streamDocument.exportPath), 'utf8')
    check(exported.includes(marker), 'quit-time snapshot includes the last saved editor content')
    check(!JSON.stringify(manifest).includes(userDataPath), 'snapshot manifest contains no source absolute path')
    console.log('Git backup packaged runtime verification completed.')
  } finally {
    if (app) await app.close().catch(() => {})
    fs.rmSync(fixtureRoot, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
