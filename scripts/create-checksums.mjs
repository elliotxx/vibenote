import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const productName = packageJson.build.productName
const version = packageJson.version
const arch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const distDir = path.join(root, 'dist')
const artifacts = [
  `${productName}-${version}-${arch}.dmg`,
]

function sha256(filePath) {
  const hash = crypto.createHash('sha256')
  hash.update(fs.readFileSync(filePath))
  return hash.digest('hex')
}

const lines = artifacts.map((artifact) => {
  const artifactPath = path.join(distDir, artifact)
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Missing release artifact: ${artifactPath}`)
  }
  return `${sha256(artifactPath)}  ${artifact}`
})

const outputPath = path.join(distDir, 'SHA256SUMS')
fs.writeFileSync(outputPath, `${lines.join('\n')}\n`)
console.log(`Created ${outputPath}`)
