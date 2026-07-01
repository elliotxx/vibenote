import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const version = packageJson.version
const arch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appPath = path.join(root, 'dist', `mac-${arch}`, `${productName}.app`)
const dmgPath = path.join(root, 'dist', `${productName}-${version}-${arch}.dmg`)
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-dmg-stage-'))

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

try {
  if (!fs.existsSync(appPath)) {
    throw new Error(`Packaged app not found: ${appPath}`)
  }
  fs.rmSync(dmgPath, { force: true })
  run('ditto', [appPath, path.join(staging, `${productName}.app`)])
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'))
  run('hdiutil', ['create', '-volname', productName, '-srcfolder', staging, '-ov', '-format', 'UDZO', dmgPath])
  console.log(`Created ${dmgPath}`)
} finally {
  fs.rmSync(staging, { recursive: true, force: true })
}
