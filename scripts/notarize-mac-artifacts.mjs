#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MacPackagingError,
  createMacPackagingPlan,
  githubReleaseFeedUrl,
  notarizeRequest,
  releaseArtifactNames,
} from './mac-packaging.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

let plan
try {
  plan = createMacPackagingPlan(process.env, {
    defaultGithubFeed: githubReleaseFeedUrl(packageJson.repository?.url || ''),
  })
} catch (error) {
  if (error instanceof MacPackagingError) {
    console.error(error.message)
    process.exit(1)
  }
  throw error
}

if (!plan.notarize) {
  console.log('Skipping DMG notarization.')
  process.exit(0)
}

const names = releaseArtifactNames({
  productName: packageJson.build.productName,
  version: packageJson.version,
  arch: plan.arch,
})
const dmgPath = path.join(root, 'dist', names.dmgName)
if (!fs.existsSync(dmgPath)) {
  console.error(`Cannot notarize missing DMG: ${dmgPath}`)
  process.exit(1)
}

const request = notarizeRequest(dmgPath, process.env)
if (!request) {
  console.error('Notarization credentials are incomplete.')
  process.exit(1)
}
if (request.appleApiKey && !fs.existsSync(request.appleApiKey)) {
  console.error('APPLE_API_KEY does not point at an existing App Store Connect API key file.')
  process.exit(1)
}

const imported = await import('@electron/notarize')
const notarize = imported.notarize || imported.default?.notarize
if (typeof notarize !== 'function') {
  console.error('@electron/notarize did not provide a notarize function.')
  process.exit(1)
}

console.log(`Submitting ${names.dmgName} for notarization. The zip update archive keeps the app ticket from electron-builder so its blockmap stays valid.`)
await notarize(request)
console.log(`Stapled notarization ticket to ${names.dmgName}.`)
