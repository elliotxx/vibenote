#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { releaseArtifactNames, releaseAssetPaths } from './mac-packaging.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const names = releaseArtifactNames({
  productName: packageJson.build.productName,
  version: packageJson.version,
  arch: process.env.VIBENOTE_RELEASE_ARCH || 'arm64',
})
const assets = releaseAssetPaths(root, names, {
  exists: name => fs.existsSync(path.join(root, 'dist', name)),
})
const missing = assets.filter(asset => !fs.existsSync(asset))
if (missing.length > 0) {
  console.error(`Missing release asset: ${missing[0]}`)
  process.exit(1)
}
process.stdout.write(`${assets.join('\n')}\n`)
