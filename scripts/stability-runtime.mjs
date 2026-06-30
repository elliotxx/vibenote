import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const appBundlePath = path.join(root, 'dist', 'mac-arm64', `${productName}.app`)
const streamPath = path.join(os.homedir(), 'Library', 'Application Support', productName, 'notes', 'stream.txt')
const screenshotPath = path.join(os.tmpdir(), 'vibenote-stability-smoke.png')
const marker = `stability-smoke-${Date.now()}`
const longPayload = [
  `${marker}-start`,
  ...Array.from({ length: 360 }, (_, index) => `${marker}-line-${String(index + 1).padStart(3, '0')} ${'x'.repeat(72)}`),
  `${marker}-end`,
].join('\n')
let backup = null

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options })
}

function runShell(script) {
  return execFileSync('/bin/zsh', ['-lc', script], { cwd: root, encoding: 'utf8' })
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
  console.log(`ok - ${message}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function frontmostProcessName() {
  try {
    return run('osascript', ['-e', 'tell application "System Events" to name of first process whose frontmost is true'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function quitApp() {
  try {
    run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to quit`])
  } catch {
    // The app may not be running.
  }
}

async function waitForAppToExit() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      run('pgrep', ['-x', productName], { stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      return
    }
    await sleep(200)
  }
  throw new Error(`${productName} did not exit before stability verification setup`)
}

async function activateApp() {
  run('open', ['-n', appBundlePath])
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(300)
    try {
      run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to activate`])
      await sleep(150)
      if (frontmostProcessName() === productName) return
    } catch {
      // Keep waiting for Launch Services to register the app.
    }
  }
  throw new Error(`${productName} did not become frontmost; frontmost process is ${frontmostProcessName()}`)
}

async function paste(text) {
  run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to activate`])
  await sleep(500)
  runShell(`cat <<'PAYLOAD' | pbcopy\n${text}\nPAYLOAD`)
  run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'])
  await sleep(500)
}

async function main() {
  check(fs.existsSync(appBundlePath), `packaged app exists at ${appBundlePath}`)
  quitApp()
  await waitForAppToExit()
  if (fs.existsSync(streamPath)) {
    backup = fs.readFileSync(streamPath)
  }

  await activateApp()
  console.log(`ok - ${productName} accepted activation before stability smoke`)
  await paste(longPayload)
  quitApp()
  await waitForAppToExit()

  const saved = fs.readFileSync(streamPath, 'utf8')
  check(saved.includes(`${marker}-start`), 'rapid-quit save includes payload start')
  check(saved.includes(`${marker}-end`), 'rapid-quit save includes payload end')
  check((saved.match(new RegExp(marker, 'g')) || []).length >= 360, 'rapid-quit save preserves long payload')

  await activateApp()
  await sleep(500)
  run('screencapture', ['-x', '-R300,80,1280,820', screenshotPath])
  console.log(`ok - screenshot captured at ${screenshotPath}`)
  const reloaded = fs.readFileSync(streamPath, 'utf8')
  check(reloaded.includes(`${marker}-end`), 'relaunch keeps persisted payload')
}

try {
  await main()
  console.log('Stability runtime verification completed.')
} finally {
  quitApp()
  await waitForAppToExit()
  if (backup) {
    fs.mkdirSync(path.dirname(streamPath), { recursive: true })
    fs.writeFileSync(streamPath, backup)
    console.log('ok - note stream file restored after stability verification')
  }
}
