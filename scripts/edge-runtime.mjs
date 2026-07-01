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
const screenshotPath = path.join(os.tmpdir(), 'vibenote-edge-smoke.png')
const marker = `edge-smoke-${Date.now()}`
let backup = null

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options })
}

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`ok - ${message}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function note(blocks) {
  return [
    JSON.stringify({ formatVersion: '1.0.0', name: 'Stream', cursors: null, foldedRanges: [] }),
    ...blocks.map((block, index) => [
      `---block:${block.language};auto=${block.auto ? '1' : '0'};created=2026-06-30T00:00:0${index}.000Z`,
      block.content,
    ].join('\n')),
  ].join('\n')
}

function blockCount(content) {
  return (content.match(/---block:/g) || []).length
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
      run('pgrep', ['-x', productName])
    } catch {
      return
    }
    await sleep(200)
  }
  throw new Error(`${productName} did not exit before verification setup`)
}

async function activateApp() {
  run('open', ['-n', appBundlePath])
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(300)
    try {
      run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to activate`])
      await sleep(150)
      if (frontmostProcessName() === productName) {
        normalizeWindow()
        return
      }
    } catch {
      // Keep waiting for Launch Services to register the app.
    }
  }
  throw new Error(`${productName} did not become frontmost; frontmost process is ${frontmostProcessName()}`)
}

function normalizeWindow() {
  run('osascript', ['-e', [
    'tell application "System Events"',
    `tell process ${JSON.stringify(productName)}`,
    'set position of window 1 to {80, 90}',
    'set size of window 1 to {980, 700}',
    'end tell',
    'end tell',
  ].join('\n')])
}

async function keyCode(code, modifiers) {
  const modifierText = modifiers.length ? ` using {${modifiers.join(', ')}}` : ''
  run('osascript', ['-e', `tell application "System Events" to key code ${code}${modifierText}`])
  await sleep(250)
}

async function keyStroke(key, modifiers) {
  const modifierText = modifiers.length ? ` using {${modifiers.join(', ')}}` : ''
  run('osascript', ['-e', `tell application "System Events" to keystroke ${JSON.stringify(key)}${modifierText}`])
  await sleep(250)
}

async function verifyDeleteEdges() {
  fs.writeFileSync(streamPath, note([
    { language: 'markdown', auto: true, content: `${marker}-keep` },
    { language: 'markdown', auto: true, content: `${marker}-delete` },
  ]))
  await activateApp()
  await sleep(1200)
  await keyCode(125, ['command down'])
  await keyStroke('d', ['control down', 'shift down'])
  await sleep(900)

  let content = fs.readFileSync(streamPath, 'utf8')
  check(content.includes(`${marker}-keep`), 'delete keeps the non-active block')
  check(!content.includes(`${marker}-delete`), 'delete removes the active block')
  check(blockCount(content) === 1, 'delete persists exactly one remaining block')

  await keyStroke('d', ['control down', 'shift down'])
  await sleep(700)
  content = fs.readFileSync(streamPath, 'utf8')
  check(content.includes(`${marker}-keep`), 'delete refuses to remove the final block')
  check(blockCount(content) === 1, 'final-block delete leaves block structure intact')
  quitApp()
  await sleep(500)
}

async function verifyInvalidFormatEdge() {
  const invalidJson = `{"${marker}": true`
  fs.writeFileSync(streamPath, note([
    { language: 'json', auto: false, content: invalidJson },
  ]))
  await activateApp()
  await keyStroke('f', ['option down', 'shift down'])
  await sleep(900)
  const content = fs.readFileSync(streamPath, 'utf8')
  check(content.includes(invalidJson), 'invalid JSON format attempt preserves original content')
  check(blockCount(content) === 1, 'invalid format attempt preserves block structure')
  run('screencapture', ['-x', '-R300,80,1280,820', screenshotPath])
  console.log(`ok - screenshot captured at ${screenshotPath}`)
}

async function main() {
  check(fs.existsSync(appBundlePath), `packaged app exists at ${appBundlePath}`)
  if (fs.existsSync(streamPath)) backup = fs.readFileSync(streamPath)
  fs.mkdirSync(path.dirname(streamPath), { recursive: true })
  quitApp()
  await waitForAppToExit()
  await verifyDeleteEdges()
  await verifyInvalidFormatEdge()
}

try {
  await main()
  console.log('Edge runtime verification completed.')
} finally {
  quitApp()
  await waitForAppToExit()
  if (backup) {
    fs.writeFileSync(streamPath, backup)
    console.log('ok - note stream file restored after edge verification')
  }
}
