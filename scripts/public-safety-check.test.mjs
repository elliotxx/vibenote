import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { scanText, sensitivePathRule } from './public-safety-check.mjs'

test('blocks private and credential file paths', () => {
  assert.equal(sensitivePathRule('.env.production'), 'environment-file')
  assert.equal(sensitivePathRule('private-notes/today.md'), 'private-data-directory')
  assert.equal(sensitivePathRule('tmp/recovery/stream.txt'), 'private-data-directory')
  assert.equal(sensitivePathRule('profile/ai-settings.json'), 'private-data-file')
  assert.equal(sensitivePathRule('sample.vibenote'), 'note-export')
  assert.equal(sensitivePathRule('signing/private.pem'), 'credential-file')
})

test('allows documented environment templates and source files', () => {
  assert.equal(sensitivePathRule('.env.example'), null)
  assert.equal(sensitivePathRule('src/example.ts'), null)
})

test('detects secrets and machine-specific paths without storing real values', () => {
  const homePath = ['', 'Users', 'sample-user', 'Documents', 'note.txt'].join('/')
  const token = `${['gh', 'p_'].join('')}${'A'.repeat(36)}`
  const findings = scanText('fixture.txt', `${homePath}\n${token}\n`)
  assert.deepEqual(findings.map(finding => finding.rule).sort(), ['github-token', 'macos-home-path'])
})

test('allows localhost and placeholder paths used by public documentation', () => {
  const text = 'http://127.0.0.1:3344\n$HOME/example\n/Users/<username>/example\n'
  assert.deepEqual(scanText('README.md', text), [])
})

test('blocks Chinese person mentions while allowing synthetic member placeholders', () => {
  const personMention = ['@', '示例', '用户'].join('')
  assert.deepEqual(scanText('fixture.txt', personMention), [{
    path: 'fixture.txt',
    line: 1,
    rule: 'chinese-person-mention',
  }])
  assert.deepEqual(scanText('fixture.txt', '<member-a>'), [])
})

test('reports rule and location without returning matched content', () => {
  const privateUrl = ['https://', 'name', ':', 'password', '@', 'example.com'].join('')
  const [finding] = scanText('fixture.txt', `safe\n${privateUrl}\n`)
  assert.deepEqual(finding, {
    path: 'fixture.txt',
    line: 2,
    rule: 'credential-bearing-url',
  })
  assert.equal(Object.hasOwn(finding, 'match'), false)
})

test('staged mode scans the Git index instead of the working tree', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vibenote-public-safety-'))
  const checkerSource = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public-safety-check.mjs')
  const checkerTarget = path.join(directory, 'public-safety-check.mjs')
  const fixturePath = path.join(directory, 'fixture.txt')
  const token = `${['gh', 'p_'].join('')}${'B'.repeat(36)}`

  try {
    execFileSync('git', ['init', '-q'], { cwd: directory })
    fs.copyFileSync(checkerSource, checkerTarget)
    fs.writeFileSync(fixturePath, 'public sample\n')
    execFileSync('git', ['add', 'fixture.txt'], { cwd: directory })

    fs.writeFileSync(fixturePath, `${token}\n`)
    const stagedSafe = spawnSync(process.execPath, [checkerTarget, '--staged'], {
      cwd: directory,
      encoding: 'utf8',
    })
    assert.equal(stagedSafe.status, 0)

    execFileSync('git', ['add', 'fixture.txt'], { cwd: directory })
    fs.writeFileSync(fixturePath, 'public sample\n')
    const stagedSensitive = spawnSync(process.execPath, [checkerTarget, '--staged'], {
      cwd: directory,
      encoding: 'utf8',
    })
    assert.equal(stagedSensitive.status, 1, JSON.stringify({
      stdout: stagedSensitive.stdout,
      stderr: stagedSensitive.stderr,
    }))
    assert.match(stagedSensitive.stderr, /github-token/)
    assert.equal(stagedSensitive.stderr.includes(token), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})
