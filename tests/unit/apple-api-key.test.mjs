import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/materialize-apple-api-key.py')

function pem() {
  const header = `-----BEGIN ${'PRIVATE KEY'}-----`
  const footer = `-----END ${'PRIVATE KEY'}-----`
  return `${header}\nAAAA\n${footer}\n`
}

test('materialize script writes a private API key file and exports its path', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-api-key-'))
  const githubEnv = path.join(directory, 'github.env')
  const result = spawnSync('python3', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APPLE_API_KEY_P8: Buffer.from(pem()).toString('base64'),
      RUNNER_TEMP: directory,
      GITHUB_ENV: githubEnv,
    },
  })

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout.includes('AAAA'), false)
  const exported = fs.readFileSync(githubEnv, 'utf8')
  assert.match(exported, /^APPLE_API_KEY=.+\/AuthKey\.p8\n$/)
  const keyPath = exported.slice('APPLE_API_KEY='.length).trim()
  assert.equal(fs.readFileSync(keyPath, 'utf8'), pem())
  assert.equal(fs.statSync(keyPath).mode & 0o777, 0o600)
  fs.rmSync(directory, { recursive: true, force: true })
})

test('materialize script leaves the environment alone when no key is configured', () => {
  const result = spawnSync('python3', [script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      APPLE_API_KEY_P8: '',
    },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /empty/)
})
