import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const dmgPath = path.join(root, 'dist', `${productName}-${packageJson.version}-${releaseArch}.dmg`)
const installedAppPath = `/Applications/${productName}.app`
let mountedPath = null

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options })
}

function check(condition, message) {
  if (!condition) throw new Error(message)
  console.log(`ok - ${message}`)
}

function mountDmg() {
  const output = run('hdiutil', ['attach', dmgPath, '-nobrowse', '-readonly'])
  const mountLine = output.split('\n').find(line => line.includes('/Volumes/'))
  const match = mountLine?.match(/(\/Volumes\/.*)$/)
  if (!match) throw new Error(`Could not find mounted volume in hdiutil output:\n${output}`)
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

let harness = null
try {
  check(fs.existsSync(dmgPath), `DMG exists at ${dmgPath}`)
  const mountPath = mountDmg()
  const appInDmg = path.join(mountPath, `${productName}.app`)
  check(fs.existsSync(appInDmg), `DMG contains ${productName}.app`)
  check(fs.existsSync(path.join(mountPath, 'Applications')), 'DMG contains Applications symlink')

  fs.rmSync(installedAppPath, { recursive: true, force: true })
  run('ditto', [appInDmg, installedAppPath])
  console.log(`ok - installed app copied to ${installedAppPath}`)
  check(appVersion(installedAppPath) === packageJson.version, `installed app version is ${packageJson.version}`)

  harness = new PackagedAppHarness({
    appBundlePath: installedAppPath,
    initialContent: noteContent([
      { language: 'markdown', auto: true, content: 'headless install verification' },
    ]),
  })
  const page = await harness.launch()
  check(harness.processPath() === path.join(installedAppPath, 'Contents', 'MacOS', productName), 'installed app process runs from /Applications')
  check(await page.locator('.cm-content').textContent() === 'headless install verification', 'installed app renders isolated verification content')
  console.log('Install runtime verification completed.')
} finally {
  await harness?.cleanup()
  detachDmg()
}
