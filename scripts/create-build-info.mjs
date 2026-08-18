#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { collectBuildInfo } from '../electron/buildInfo.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const buildInfo = collectBuildInfo(packageJson.version, root)
const outputPath = path.join(root, 'dist', 'build-info.json')

fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(buildInfo, null, 2)}\n`)
console.log(`Created ${outputPath} (${buildInfo.gitDescribe})`)
