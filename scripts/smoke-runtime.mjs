import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appBundlePath = path.join(root, 'dist', `mac-${releaseArch}`, `${productName}.app`)
const streamPath = path.join(os.homedir(), 'Library', 'Application Support', productName, 'notes', 'stream.txt')
const screenshotPath = path.join(os.tmpdir(), 'vibenote-runtime-smoke.png')
const marker = `runtime-smoke-${Date.now()}`
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

async function paste(text) {
  run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to activate`])
  await sleep(150)
  runShell(`printf %s ${JSON.stringify(text)} | pbcopy`)
  run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'])
  await sleep(250)
}

async function keyCode(code, modifiers) {
  const modifierText = modifiers.length ? ` using {${modifiers.join(', ')}}` : ''
  run('osascript', ['-e', `tell application "System Events" to key code ${code}${modifierText}`])
  await sleep(250)
}

function frontmostProcessName() {
  try {
    return run('osascript', ['-e', 'tell application "System Events" to name of first process whose frontmost is true'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
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

function quitApp() {
  try {
    run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to quit`])
  } catch {
    // The app may have already quit.
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
  throw new Error(`${productName} did not exit before runtime verification setup`)
}

async function main() {
  check(fs.existsSync(appBundlePath), `packaged app exists at ${appBundlePath}`)
  quitApp()
  await waitForAppToExit()
  if (fs.existsSync(streamPath)) {
    backup = fs.readFileSync(streamPath)
  }

  await activateApp()
  console.log(`ok - ${productName} accepted activation before keyboard smoke`)

  await paste(`${marker}-one`)
  await keyCode(36, ['command down'])
  await paste(`${marker}-two`)
  await keyCode(36, ['option down'])
  await paste(`${marker}-before`)
  await sleep(1000)

  run('screencapture', ['-x', '-R300,80,1280,820', screenshotPath])
  console.log(`ok - screenshot captured at ${screenshotPath}`)

  const content = fs.readFileSync(streamPath, 'utf8')
  const markerCount = (content.match(new RegExp(marker, 'g')) || []).length
  const blockCount = (content.match(/---block:/g) || []).length
  check(markerCount >= 1, 'runtime smoke text was saved')
  check(blockCount >= 1, 'runtime smoke preserves block structure')
  check(!content.includes(`${marker}-before---block:`), 'block-before shortcut keeps delimiters on separate lines')
}

try {
  await main()
  console.log('Runtime smoke verification completed.')
} finally {
  quitApp()
  await waitForAppToExit()
  if (backup) {
    fs.mkdirSync(path.dirname(streamPath), { recursive: true })
    fs.writeFileSync(streamPath, backup)
    console.log('ok - note stream file restored after smoke verification')
  }
}
