import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { signAsync } from '@electron/osx-sign'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const arch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appPath = path.join(root, 'dist', `mac-${arch}`, 'Vibenote.app')
const modePath = path.join(root, 'dist', 'local-mode.json')

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}

export function selectLocalIdentity(output, requested = '') {
  const identities = [...output.matchAll(/\b([A-Fa-f0-9]{40}) "(Apple Development:[^"\n]+)"/g)]
    .map(match => ({ hash: match[1].toUpperCase(), name: match[2] }))
  const unique = [...new Map(identities.map(value => [value.hash, value])).values()]
  const matches = requested ? unique.filter(value => value.hash === requested.toUpperCase() || value.name === requested) : unique
  if (matches.length !== 1) {
    throw new Error('Select exactly one valid Apple Development certificate with VIBENOTE_LOCAL_SIGNING_IDENTITY (SHA-1 or full name). Ad-hoc signing is not allowed.')
  }
  return matches[0]
}

export function resolveLocalIdentity() {
  return selectLocalIdentity(run('security', ['find-identity', '-v', '-p', 'codesigning']), process.env.VIBENOTE_LOCAL_SIGNING_IDENTITY)
}

export function verifyLocalApp(target, expectedHash) {
  run('codesign', ['--verify', '--deep', '--strict', target])
  const result = spawnSync('codesign', ['-dv', '--verbose=4', target], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error('Could not inspect the local signature.')
  const details = result.stderr
  if (!/^Authority=Apple Development:/m.test(details) || !/^Identifier=com\.elliotxx\.vibenote$/m.test(details) || !/flags=.*\(runtime\)/.test(details)) {
    throw new Error('Local app must have the Vibenote bundle ID, Apple Development signature, and hardened runtime.')
  }
  const team = details.match(/^TeamIdentifier=(\w+)$/m)?.[1]
  if (!team) throw new Error('Local signature has no Team ID.')
  const requirement = `=anchor apple generic and certificate leaf[subject.OU] = "${team}"${expectedHash ? ` and certificate leaf = H"${expectedHash}"` : ''}`
  run('codesign', ['--verify', '-R', requirement, target])
  if (fs.existsSync(path.join(target, 'Contents/Resources/app-update.yml'))) throw new Error('Local builds must not contain an update feed.')
  return team
}

function readMode() {
  const mode = JSON.parse(fs.readFileSync(modePath, 'utf8'))
  if (mode.signing !== 'Apple Development' || mode.notarized !== false || mode.updateFeed !== false || !/^[A-F0-9]{40}$/.test(mode.identityHash) || mode.arch !== arch) {
    throw new Error('Invalid local signing manifest.')
  }
  return mode
}

async function signLocal() {
  const identity = resolveLocalIdentity()
  await signAsync({
    app: appPath, identity: identity.hash, platform: 'darwin', type: 'development',
    preAutoEntitlements: false, preEmbedProvisioningProfile: false, strictVerify: true,
    optionsForFile: file => ({
      entitlements: path.join(root, 'build', file === appPath ? 'entitlements.mac.plist' : 'entitlements.mac.inherit.plist'),
      hardenedRuntime: true, timestamp: 'none',
    }),
  })
  const team = verifyLocalApp(appPath, identity.hash)
  fs.writeFileSync(modePath, JSON.stringify({
    signing: 'Apple Development', identityHash: identity.hash, team, arch,
    notarized: false, updateFeed: false,
    revision: run('git', ['-C', root, 'rev-parse', 'HEAD']),
    dirty: Boolean(run('git', ['-C', root, 'status', '--porcelain'])),
    dmg: `Vibenote-${pkg.version}-${arch}-local.dmg`,
  }, null, 2) + '\n')
}

function verify() {
  const mode = readMode()
  if (verifyLocalApp(appPath, mode.identityHash) !== mode.team) throw new Error('Team ID does not match the manifest.')
  const dmg = path.join(root, 'dist', `Vibenote-${pkg.version}-${arch}-local.dmg`)
  run('hdiutil', ['verify', dmg])
  const volume = fs.mkdtempSync(path.join(root, 'dist', '.local-dmg-verify-'))
  let mounted = false
  try {
    run('hdiutil', ['attach', dmg, '-readonly', '-nobrowse', '-mountpoint', volume])
    mounted = true
    const imageApp = path.join(volume, 'Vibenote.app')
    if (verifyLocalApp(imageApp, mode.identityHash) !== mode.team) throw new Error('DMG app has a different Team ID.')
    const signedHash = target => {
      const result = spawnSync('codesign', ['-dv', '--verbose=4', target], { encoding: 'utf8' })
      const value = result.stderr?.match(/^CDHash=(.+)$/m)?.[1]
      if (result.status !== 0 || !value) throw new Error('Could not read the code directory hash.')
      return value
    }
    if (signedHash(imageApp) !== signedHash(appPath)) throw new Error('DMG contains a different build.')
  } finally {
    if (mounted) run('hdiutil', ['detach', volume, '-quiet'])
    fs.rmSync(volume, { recursive: true, force: true })
  }
  console.log('Verified local Apple Development app and disk image; not notarized.')
  return mode
}

function install() {
  const mode = verify()
  const target = '/Applications/Vibenote.app'
  if (fs.existsSync(target) && (fs.lstatSync(target).isSymbolicLink() || !fs.lstatSync(target).isDirectory())) throw new Error('Unsafe installation target.')
  const running = spawnSync('pgrep', ['-f', '^/Applications/Vibenote.app/Contents/MacOS/Vibenote($| )'])
  if (running.status !== 1) throw new Error('Quit Vibenote before installing so pending notes can finish saving.')
  if (fs.existsSync(target)) verifyLocalApp(target, mode.identityHash)
  const stage = fs.mkdtempSync('/Applications/.vibenote-install-')
  const candidate = path.join(stage, 'Vibenote.app')
  const backup = path.join(root, 'backups', 'local-apps', `${Date.now()}-${process.pid}.app`)
  let moved = false
  let activated = false
  try {
    run('ditto', [appPath, candidate])
    verifyLocalApp(candidate, mode.identityHash)
    if (fs.existsSync(target)) {
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      fs.renameSync(target, backup)
      moved = true
    }
    fs.renameSync(candidate, target)
    activated = true
    verifyLocalApp(target, mode.identityHash)
    console.log(`Installed ${target}; previous app retained in backups/local-apps. User data was not modified.`)
  } catch (error) {
    if (activated) fs.renameSync(target, path.join(stage, 'failed.app'))
    if (moved) fs.renameSync(backup, target)
    throw error
  } finally {
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--sign')) await signLocal()
  else if (process.argv.includes('--install')) install()
  else if (process.argv.includes('--verify')) verify()
  else throw new Error('Expected --sign, --verify, or --install.')
}
