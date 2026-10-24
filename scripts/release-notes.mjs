#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { readReleaseMode, renderReleaseNotes } from './mac-packaging.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const outFlag = process.argv.indexOf('--out')
const outputPath = outFlag === -1
  ? path.join(root, 'dist', 'release-notes.md')
  : path.resolve(root, process.argv[outFlag + 1] || '')

if (!outputPath) {
  console.error('Missing path after --out')
  process.exit(1)
}

const notes = renderReleaseNotes({
  version: packageJson.version,
  tag: process.env.GITHUB_REF_NAME || '',
  mode: readReleaseMode(root) || { signed: false, notarized: false, updateFeed: false },
})
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, notes)
console.log(`Wrote ${outputPath}`)
