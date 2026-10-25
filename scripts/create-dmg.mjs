import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readReleaseMode, signingRequested } from './mac-packaging.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const version = packageJson.version
const local = process.argv.includes('--local')
const arch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appPath = path.join(root, 'dist', `mac-${arch}`, `${productName}.app`)
const dmgPath = path.join(root, 'dist', `${productName}-${version}-${arch}${local ? '-local' : ''}.dmg`)

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

function developerIdSigned(target) {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', target], { encoding: 'utf8' })
  return `${result.stdout || ''}\n${result.stderr || ''}`.includes('Developer ID Application')
}

if (!fs.existsSync(appPath)) {
  throw new Error(`Packaged app not found: ${appPath}`)
}
const mode = readReleaseMode(root)
if (local) {
  const { verifyLocalApp } = await import('./local-mac.mjs')
  verifyLocalApp(appPath)
}
if ((!local && ((mode && mode.customDmg === false) || signingRequested(process.env))) || developerIdSigned(appPath)) {
  if (fs.existsSync(dmgPath)) {
    console.log(`Keeping electron-builder DMG for signed app: ${dmgPath}`)
    process.exit(0)
  }
  throw new Error('Refusing to wrap a signed app in a custom unsigned DMG. The signed build must use electron-builder dmg output.')
}

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-dmg-stage-'))
try {
  fs.rmSync(dmgPath, { force: true })
  run('ditto', [appPath, path.join(staging, `${productName}.app`)])
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'))
  run('hdiutil', ['create', '-volname', productName, '-srcfolder', staging, '-ov', '-format', 'UDZO', dmgPath])
  console.log(`Created ${dmgPath}`)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
