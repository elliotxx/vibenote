import { _electron } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appExecutable = path.join(root, 'dist', `mac-${releaseArch}`, `${productName}.app`, 'Contents', 'MacOS', productName)

function ok(message) {
  console.log(`ok - ${message}`)
}

function check(condition, message) {
  if (!condition) throw new Error(message)
  ok(message)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

async function main() {
  check(fs.existsSync(appExecutable), `packaged app executable exists at ${appExecutable}`)

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-data-safety-'))
  const notesDir = path.join(userDataDir, 'notes')
  const streamPath = path.join(notesDir, 'stream.txt')
  const recoveryPath = path.join(userDataDir, 'recovery', 'internal_stream.vibenote')
  const recoveryMetaPath = path.join(userDataDir, 'recovery', 'internal_stream.json')
  const backupDir = path.join(userDataDir, 'backups', 'internal_stream')
  const initial = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n---block:markdown;auto=1;created=2026-07-08T00:00:00.000Z\ninitial-safe-content\n`
  const failedAttempt = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n---block:markdown;auto=1;created=2026-07-08T00:00:00.000Z\nfailed-attempt-content\n`
  const saved = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n---block:markdown;auto=1;created=2026-07-08T00:00:00.000Z\nsaved-content\n`
  let app

  try {
    app = await _electron.launch({
      executablePath: appExecutable,
      env: {
        ...process.env,
        VIBENOTE_USER_DATA_DIR: userDataDir,
      },
    })
    const page = await app.firstWindow()
    await page.waitForSelector('.cm-editor', { timeout: 15000 })
    ok('packaged app opened with isolated user data')

    await page.evaluate(async content => window.vibenote.buffer.save('stream.txt', content), initial)
    check(fs.readFileSync(streamPath, 'utf8') === initial, 'initial content saved through production IPC')

    fs.rmSync(path.join(userDataDir, 'backups'), { recursive: true, force: true })
    fs.writeFileSync(path.join(userDataDir, 'backups'), 'not-a-directory')
    let failed = false
    try {
      await page.evaluate(async content => window.vibenote.buffer.save('stream.txt', content), failedAttempt)
    } catch {
      failed = true
    }
    check(failed, 'backup write failure rejects the save')
    check(fs.readFileSync(streamPath, 'utf8') === initial, 'target file is not overwritten when backup fails')
    check(fs.readFileSync(recoveryPath, 'utf8') === failedAttempt, 'recovery draft keeps latest attempted content')
    check(readJson(recoveryMetaPath).contentHash, 'recovery metadata is written')

    const recoveries = await page.evaluate(() => window.vibenote.buffer.listRecoveries())
    check(recoveries.length === 1, 'newer recovery draft is visible to the renderer')
    check(recoveries[0].identifier === 'stream.txt', 'recovery summary identifies the affected buffer')
    const recovery = await page.evaluate(() => window.vibenote.buffer.readRecovery('stream.txt'))
    check(recovery.content === failedAttempt, 'recovery draft content is readable through production IPC')

    fs.rmSync(path.join(userDataDir, 'backups'), { recursive: true, force: true })
    await page.evaluate(async content => window.vibenote.buffer.save('stream.txt', content), saved)
    check(fs.readFileSync(streamPath, 'utf8') === saved, 'save succeeds after backup path is available')

    const manifestPath = path.join(backupDir, 'manifest.json')
    check(fs.existsSync(manifestPath), 'backup manifest exists')
    const manifest = readJson(manifestPath)
    check(manifest.snapshots.some(item => item.reason === 'autosave'), 'autosave snapshot is recorded')
    const previousSnapshot = manifest.snapshots.find(item => item.contentHash)
    check(Boolean(previousSnapshot), 'snapshot metadata includes content hash')
    const snapshotContents = manifest.snapshots
      .map(item => fs.readFileSync(path.join(backupDir, item.fileName), 'utf8'))
      .join('\n')
    check(snapshotContents.includes(initial), 'backup snapshot contains the previous stable content')

    const beforeRiskCount = manifest.snapshots.length
    await page.evaluate(content => window.vibenote.buffer.snapshotSync('stream.txt', content, 'runtime-risk'), saved)
    const afterRiskManifest = readJson(manifestPath)
    check(afterRiskManifest.snapshots.length === beforeRiskCount + 1, 'forced high-risk snapshot is appended')
    check(afterRiskManifest.snapshots.at(-1).reason === 'runtime-risk', 'forced snapshot records the risk reason')
  } finally {
    if (app) await app.close()
    fs.rmSync(userDataDir, { recursive: true, force: true })
  }

  console.log('Data safety runtime verification completed.')
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
