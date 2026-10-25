#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MacPackagingError,
  createMacPackagingPlan,
  describeMacPackagingPlan,
  electronBuilderArgs,
  electronBuilderEnv,
  githubReleaseFeedUrl,
  readReleaseMode,
  releaseArtifactNames,
  renderLatestMacYml,
  writeReleaseMode,
} from './mac-packaging.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const planOnly = process.argv.includes('--plan')
const signedFlag = process.argv.includes('--signed')
const localFlag = process.argv.includes('--local')
if (localFlag && signedFlag) throw new Error('--local and --signed cannot be combined.')
if (localFlag) {
  process.env.VIBENOTE_MAC_SIGN = '0'
  process.env.VIBENOTE_UPDATE_FEED_URL = 'off'
}
if (signedFlag) process.env.VIBENOTE_MAC_SIGN = '1'

function fail(message) {
  console.error(message)
  process.exit(1)
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    stdio: 'inherit',
  })
  if (result.error) fail(result.error.message)
  if (result.status !== 0) process.exit(result.status || 1)
}

function distFile(name) {
  return path.join(root, 'dist', name)
}

function writeFinalUpdateManifest(plan) {
  if (!plan.feedUrl) return
  const names = releaseArtifactNames({
    productName: packageJson.build.productName,
    version: packageJson.version,
    arch: plan.arch,
  })
  const zipPath = distFile(names.zipName)
  if (!fs.existsSync(zipPath)) {
    fail(`Update feed is configured but ${names.zipName} is missing.`)
  }
  const zip = fs.readFileSync(zipPath)
  const manifest = renderLatestMacYml({
    version: packageJson.version,
    zipName: names.zipName,
    sha512: crypto.createHash('sha512').update(zip).digest('base64'),
    size: zip.length,
    releaseDate: new Date().toISOString(),
  })
  fs.writeFileSync(distFile(names.updateInfoName), manifest)
}

let plan
try {
  plan = createMacPackagingPlan(process.env, {
    signedFlag,
    defaultGithubFeed: githubReleaseFeedUrl(packageJson.repository?.url || ''),
  })
} catch (error) {
  if (error instanceof MacPackagingError) fail(error.message)
  throw error
}

if (localFlag && !planOnly) {
  // Resolve the stable certificate before rebuilding or removing any artifacts.
  const { resolveLocalIdentity } = await import('./local-mac.mjs')
  process.env.VIBENOTE_LOCAL_SIGNING_IDENTITY = resolveLocalIdentity().hash
}

if (planOnly) {
  process.stdout.write(`${JSON.stringify(describeMacPackagingPlan(plan), null, 2)}\n`)
  process.exit(0)
}

if (process.platform !== 'darwin') {
  fail('macOS packaging requires darwin. On this machine, run `node scripts/build-mac.mjs --plan` to inspect the unsigned or signed plan.')
}

const names = releaseArtifactNames({
  productName: packageJson.build.productName,
  version: packageJson.version,
  arch: plan.arch,
})
for (const name of [names.dmgName, names.zipName, names.blockmapName, names.updateInfoName, 'release-mode.json', 'local-mode.json']) {
  fs.rmSync(distFile(name), { force: true })
}

const summary = plan.sign
  ? `macOS ${plan.arch} signed build (${plan.notarize ? 'notarized' : 'signature only'}, ${plan.feedUrl ? 'update feed on' : 'update feed off'})`
  : `macOS ${plan.arch} unsigned build`
console.log(summary)

run('npm', ['run', 'build'], process.env)
run(process.execPath, ['scripts/create-build-info.mjs'], process.env)

const builderEnv = electronBuilderEnv(plan, process.env)
const builderArgs = electronBuilderArgs(plan, {
  electronDist: fs.existsSync(path.join(root, '.electron-dist')),
})
const builderBin = path.join(root, 'node_modules', '.bin', 'electron-builder')
run(builderBin, builderArgs, builderEnv)

if (localFlag) {
  run(process.execPath, ['scripts/local-mac.mjs', '--sign'], builderEnv)
  run(process.execPath, ['scripts/create-dmg.mjs', '--local'], builderEnv)
  run(process.execPath, ['scripts/local-mac.mjs', '--verify'], builderEnv)
  console.log('Local Apple Development build complete (not notarized, update feed disabled).')
  process.exit(0)
}

if (plan.customDmg) {
  run(process.execPath, ['scripts/create-dmg.mjs'], process.env)
} else if (!fs.existsSync(distFile(names.dmgName))) {
  fail(`electron-builder did not create ${names.dmgName}.`)
}

if (plan.notarize) {
  run(process.execPath, ['scripts/notarize-mac-artifacts.mjs'], builderEnv)
}

writeFinalUpdateManifest(plan)
writeReleaseMode(root, {
  signed: plan.sign,
  notarized: plan.notarize,
  updateFeed: Boolean(plan.feedUrl),
  customDmg: plan.customDmg,
  arch: plan.arch,
})

const mode = readReleaseMode(root)
if (!mode) fail('release-mode.json was not written.')
console.log(`Packaging complete (${mode.signed ? 'signed' : 'unsigned'}${mode.notarized ? ', notarized' : ''}).`)
