import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const version = packageJson.version
const arch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appPath = path.join(root, 'dist', 'mac-arm64', `${productName}.app`)
const dmgPath = path.join(root, 'dist', `${productName}-${version}-${arch}.dmg`)
const asarPath = path.join(appPath, 'Contents', 'Resources', 'app.asar')
const plistPath = path.join(appPath, 'Contents', 'Info.plist')
const iconPath = path.join(appPath, 'Contents', 'Resources', 'icon.icns')

function check(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
  console.log(`ok - ${message}`)
}

function output(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', ...options })
}

function fileExists(filePath) {
  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
}

function dirExists(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
}

check(dirExists(appPath), `packaged app exists at ${appPath}`)
check(fileExists(dmgPath), `DMG exists at ${dmgPath}`)
check(fs.statSync(dmgPath).size > 10 * 1024 * 1024, 'DMG is not empty')
check(fileExists(iconPath), 'app icon is bundled')

const bundleVersion = output('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plistPath]).trim()
const bundleName = output('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleName', plistPath]).trim()
const bundleIcon = output('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', plistPath]).trim()
check(bundleVersion === version, `Info.plist version is ${version}`)
check(bundleName === productName, `Info.plist bundle name is ${productName}`)
check(bundleIcon.includes('icon'), 'Info.plist points at bundled icon')

const asarList = output('npx', ['asar', 'list', asarPath])
check(asarList.includes('/electron/preload.cjs'), 'asar contains preload.cjs')
check(asarList.includes('/node_modules/@vscode/ripgrep-darwin-arm64/bin/rg'), 'asar contains ripgrep runtime')
check(/\/dist\/assets\/index-.*\.js/.test(asarList), 'asar contains renderer JavaScript')
check(/\/dist\/assets\/index-.*\.css/.test(asarList), 'asar contains renderer CSS')

const identityOutput = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout || ''
if (identityOutput.includes('Developer ID Application')) {
  console.log('ok - Developer ID Application identity is available for notarized distribution')
} else {
  console.log('warn - Developer ID Application identity is not available; notarization cannot be completed on this machine')
}

const mountRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-dmg-'))
let attached = false
try {
  output('hdiutil', ['attach', dmgPath, '-mountpoint', mountRoot, '-nobrowse', '-quiet'])
  attached = true
  check(dirExists(path.join(mountRoot, `${productName}.app`)), 'DMG contains app bundle')
  const applicationsPath = path.join(mountRoot, 'Applications')
  const stat = fs.lstatSync(applicationsPath)
  check(stat.isSymbolicLink(), 'DMG contains Applications symlink')
} finally {
  if (attached) {
    output('hdiutil', ['detach', mountRoot, '-quiet'], { stdio: 'ignore' })
  }
  fs.rmSync(mountRoot, { recursive: true, force: true })
}

console.log('Package verification completed.')
