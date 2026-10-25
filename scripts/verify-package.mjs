import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile } from '@electron/asar'
import { readReleaseMode } from './mac-packaging.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const version = packageJson.version
const arch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appPath = path.join(root, 'dist', `mac-${arch}`, `${productName}.app`)
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
const unpackedRgCandidates = [
  path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', `@vscode/ripgrep-darwin-${arch}`, 'bin', 'rg'),
  path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked', 'node_modules', '@vscode', 'ripgrep', 'node_modules', `@vscode/ripgrep-darwin-${arch}`, 'bin', 'rg'),
]
const unpackedRg = unpackedRgCandidates.find(fileExists)
check(Boolean(unpackedRg), 'unpacked ripgrep runtime is present')
check(unpackedRg && (fs.statSync(unpackedRg).mode & 0o111) !== 0, 'unpacked ripgrep binary is executable')
check(/\/dist\/assets\/index-.*\.js/.test(asarList), 'asar contains renderer JavaScript')
check(/\/dist\/assets\/index-.*\.css/.test(asarList), 'asar contains renderer CSS')
check(asarList.includes('/dist/build-info.json'), 'asar contains Git build information')

const buildInfo = JSON.parse(extractFile(asarPath, 'dist/build-info.json').toString('utf8'))
check(buildInfo.appVersion === version, `build information version is ${version}`)
check(typeof buildInfo.gitDescribe === 'string' && buildInfo.gitDescribe.length > 0, 'build information contains a Git description')

const releaseMode = readReleaseMode(root)
const identityOutput = spawnSync('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' }).stdout || ''
if (releaseMode?.signed) {
  const verified = spawnSync('codesign', ['--verify', '--strict', '--verbose=2', appPath], { encoding: 'utf8' })
  check(verified.status === 0, 'codesign accepts the signed app')
  const signature = spawnSync('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' })
  const signatureText = `${signature.stdout || ''}\n${signature.stderr || ''}`
  check(signatureText.includes('Developer ID Application'), 'app is signed with Developer ID Application')
  check(/flags=.*runtime/.test(signatureText), 'hardened runtime is enabled')
  const zipPath = path.join(root, 'dist', `${productName}-${version}-${arch}.zip`)
  const blockmapPath = path.join(root, 'dist', `${productName}-${version}-${arch}.zip.blockmap`)
  check(fileExists(zipPath), 'signed release contains a zip update archive')
  check(fileExists(blockmapPath), 'signed release contains a zip blockmap')
} else if (identityOutput.includes('Developer ID Application')) {
  console.log('ok - Developer ID Application identity is available for notarized distribution')
} else {
  console.log('warn - Developer ID Application identity is not available; notarization cannot be completed on this machine')
}

if (releaseMode?.notarized) {
  const appTicket = spawnSync('xcrun', ['stapler', 'validate', appPath], { encoding: 'utf8' })
  check(appTicket.status === 0, 'app notarization ticket is stapled')
  const dmgTicket = spawnSync('xcrun', ['stapler', 'validate', dmgPath], { encoding: 'utf8' })
  check(dmgTicket.status === 0, 'DMG notarization ticket is stapled')
}

const updateConfigPath = path.join(appPath, 'Contents', 'Resources', 'app-update.yml')
if (releaseMode?.updateFeed) {
  check(fileExists(updateConfigPath), 'app-update.yml is embedded')
  const updateConfig = fs.readFileSync(updateConfigPath, 'utf8')
  check(updateConfig.includes('provider: generic'), 'embedded update config uses the generic provider')
  check(/url:\s*https:\/\//.test(updateConfig), 'embedded update config uses https')
  check(!updateConfig.includes('@'), 'embedded update config has no credentials')
  check(fileExists(path.join(root, 'dist', 'latest-mac.yml')), 'latest-mac.yml is present for the update feed')
} else {
  check(!fileExists(updateConfigPath), 'app-update.yml is absent when the update feed is off')
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
