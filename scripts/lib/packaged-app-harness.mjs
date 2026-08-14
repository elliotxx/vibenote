import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function noteContent(blocks) {
  return [
    JSON.stringify({ formatVersion: '1.0.0', name: 'Stream', cursors: null, foldedRanges: [] }),
    ...blocks.map((block, index) => [
      `---block:${block.language};auto=${block.auto ? '1' : '0'};created=2026-06-30T00:00:0${index}.000Z`,
      block.content,
    ].join('\n')),
  ].join('\n')
}

export class PackagedAppHarness {
  constructor({ appBundlePath, initialContent, environment = {} }) {
    this.appBundlePath = appBundlePath
    this.executablePath = path.join(appBundlePath, 'Contents', 'MacOS', 'Vibenote')
    this.tempPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-headless-'))
    this.userDataPath = path.join(this.tempPath, 'user-data')
    this.streamPath = path.join(this.userDataPath, 'notes', 'stream.txt')
    this.electronApp = null
    this.page = null
    this.environment = environment
    if (initialContent !== undefined) this.seedStream(initialContent)
  }

  seedStream(content) {
    if (this.electronApp) throw new Error('Cannot seed stream while packaged app is running')
    fs.mkdirSync(path.dirname(this.streamPath), { recursive: true })
    fs.writeFileSync(this.streamPath, content)
  }

  async launch() {
    if (this.electronApp) throw new Error('Packaged app is already running')
    this.electronApp = await electron.launch({
      executablePath: this.executablePath,
      env: {
        ...process.env,
        ...this.environment,
        VIBENOTE_HEADLESS_VERIFY: '1',
        VIBENOTE_USER_DATA_DIR: this.userDataPath,
      },
      timeout: 20_000,
    })
    this.page = await this.electronApp.firstWindow({ timeout: 20_000 })
    await this.page.locator('.cm-editor').waitFor({ state: 'attached', timeout: 20_000 })
    const hasVisibleWindow = await this.electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(window => window.isVisible()),
    )
    if (hasVisibleWindow) throw new Error('Headless verification exposed a visible application window')
    return this.page
  }

  async stop({ force = false } = {}) {
    if (!this.electronApp) return
    const app = this.electronApp
    if (!force) {
      this.electronApp = null
      this.page = null
      await app.close()
      return
    }
    const process = app.process()
    this.electronApp = null
    this.page = null
    const exited = new Promise(resolve => process.once('exit', resolve))
    await Promise.race([
      app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {}),
      sleep(1_000),
    ])
    await Promise.race([exited, sleep(5_000)])
    if (process.exitCode === null && !process.killed) {
      process.kill('SIGKILL')
      await Promise.race([exited, sleep(1_000)])
    }
    if (process.platform === 'darwin') {
      spawnSync('/usr/bin/pkill', ['-KILL', '-f', '--', `--user-data-dir=${this.userDataPath}`], { stdio: 'ignore' })
    }
  }

  async relaunch() {
    await this.stop()
    return this.launch()
  }

  processPath() {
    if (!this.electronApp) return ''
    return this.electronApp.process().spawnfile || ''
  }

  readStream() {
    return fs.readFileSync(this.streamPath, 'utf8')
  }

  async waitForStream(predicate, message, timeoutMs = 8_000) {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      if (fs.existsSync(this.streamPath)) {
        const content = this.readStream()
        if (predicate(content)) return content
      }
      await sleep(100)
    }
    throw new Error(message)
  }

  async cleanup(options) {
    try {
      await this.stop(options)
    } finally {
      fs.rmSync(this.tempPath, { recursive: true, force: true })
    }
  }
}
