import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const dmgPath = path.join(root, 'dist', `${productName}-${packageJson.version}-arm64.dmg`)
const installedAppPath = `/Applications/${productName}.app`
const screenshotPath = path.join(os.tmpdir(), 'vibenote-install-smoke.png')
let mountedPath = null

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
  throw new Error(`${productName} did not exit before install verification setup`)
}

function mountDmg() {
  const output = run('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly'])
  const mountLine = output.split('\n').find(line => line.includes('/Volumes/'))
  const match = mountLine?.match(/(\/Volumes\/.*)$/)
  if (!match) {
    throw new Error(`Could not find mounted volume in hdiutil output:\n${output}`)
  }
  mountedPath = match[1].trim()
  return mountedPath
}

function detachDmg() {
  if (!mountedPath) return
  try {
    run('hdiutil', ['detach', mountedPath, '-quiet'])
  } catch {
    run('hdiutil', ['detach', mountedPath, '-force', '-quiet'])
  } finally {
    mountedPath = null
  }
}

function appVersion(appPath) {
  return run('defaults', ['read', path.join(appPath, 'Contents', 'Info'), 'CFBundleShortVersionString']).trim()
}

async function activateInstalledApp() {
  run('open', ['-n', installedAppPath])
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(300)
    try {
      run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to activate`])
      await sleep(150)
      const frontmost = run('osascript', ['-e', 'tell application "System Events" to name of first process whose frontmost is true'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      if (frontmost === productName) return
    } catch {
      // Keep waiting for Launch Services to register the installed app.
    }
  }
  throw new Error(`Installed ${productName} did not become frontmost`)
}

function normalizeWindow() {
  run('osascript', ['-e', [
    'tell application "System Events"',
    `tell process ${JSON.stringify(productName)}`,
    'set position of window 1 to {120, 120}',
    'set size of window 1 to {1120, 760}',
    'end tell',
    'end tell',
  ].join('\n')])
}

async function main() {
  check(fs.existsSync(dmgPath), `DMG exists at ${dmgPath}`)
  quitApp()
  await waitForAppToExit()

  const mountPath = mountDmg()
  const appInDmg = path.join(mountPath, `${productName}.app`)
  check(fs.existsSync(appInDmg), `DMG contains ${productName}.app`)
  check(fs.existsSync(path.join(mountPath, 'Applications')), 'DMG contains Applications symlink')

  fs.rmSync(installedAppPath, { recursive: true, force: true })
  run('ditto', [appInDmg, installedAppPath])
  console.log(`ok - installed app copied to ${installedAppPath}`)

  check(appVersion(installedAppPath) === packageJson.version, `installed app version is ${packageJson.version}`)

  await activateInstalledApp()
  normalizeWindow()
  run('osascript', ['-e', `tell application ${JSON.stringify(productName)} to activate`])
  await sleep(900)

  const processList = run('ps', ['-ax', '-o', 'comm=,args='])
  check(processList.includes(`/Applications/${productName}.app/Contents/MacOS/${productName}`), 'installed app process is running from /Applications')
  run('screencapture', ['-x', '-R120,100,1160,820', screenshotPath])
  console.log(`ok - screenshot captured at ${screenshotPath}`)
}

try {
  await main()
  console.log('Install runtime verification completed.')
} finally {
  quitApp()
  await waitForAppToExit()
  detachDmg()
}
