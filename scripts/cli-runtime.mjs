#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-cli-runtime-'))
const notesPath = path.join(root, 'notes')
const streamPath = path.join(notesPath, 'stream.txt')
const cliPath = path.resolve('cli/vibenote.mjs')
const original = '{"formatVersion":"1.0.0","name":"Synthetic Stream","cursors":null}\n---block:markdown;auto=1;created=2026-01-01T00:00:00.000Z\nExisting synthetic content'

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function run(args, input = '') {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, ...args], { env: { ...process.env, NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
    child.on('close', status => resolve({ status, stdout, stderr }))
    child.stdin.end(input)
  })
}

function response(result) {
  const source = result.status === 0 ? result.stdout : result.stderr
  assert.ok(source)
  return JSON.parse(source)
}

try {
  await fs.promises.mkdir(notesPath)
  await fs.promises.writeFile(streamPath, original)
  const base = ['--data-dir', root, '--output', 'json']

  const capabilities = await run(['capabilities', ...base])
  assert.equal(capabilities.status, 0)
  assert.equal(capabilities.stderr, '')
  assert.equal(response(capabilities).data.schemaVersion, 'v1alpha1')

  const listed = await run(['notes', 'list', ...base])
  assert.equal(response(listed).data.items[0].id, 'internal:stream')
  const searched = await run(['search', '--query', 'synthetic content', '--limit', '10', ...base])
  assert.equal(response(searched).data.items.length, 1)
  const blocks = await run(['blocks', 'list', '--note', 'internal:stream', ...base])
  assert.equal(response(blocks).data.items[0].stable, false)

  const beforeDryRun = hash(await fs.promises.readFile(streamPath))
  const dryRun = await run(['blocks', 'append', '--note', 'internal:stream', '--content-stdin', '--idempotency-key', 'runtime-primary', '--dry-run', ...base], 'Runtime appended content')
  const proposal = response(dryRun).data
  assert.equal(proposal.dryRun, true)
  assert.equal(hash(await fs.promises.readFile(streamPath)), beforeDryRun)
  assert.deepEqual((await fs.promises.readdir(root)).sort(), ['notes'])

  const applied = await run(['blocks', 'append', '--note', 'internal:stream', '--content-stdin', '--idempotency-key', 'runtime-primary', '--expected-revision', proposal.expectedRevision, ...base], 'Runtime appended content')
  const appliedData = response(applied).data
  assert.equal(appliedData.blockId, proposal.blockId)
  const afterApply = await fs.promises.readFile(streamPath, 'utf8')
  assert.equal(afterApply.slice(0, original.length), original)
  assert.equal((afterApply.match(/^---block:/gm) || []).length, 2)
  assert.ok((await fs.promises.readdir(path.join(root, 'backups', 'internal_stream'))).some(file => file.endsWith('.vibenote')))
  assert.ok((await fs.promises.readdir(path.join(root, 'recovery'))).some(file => file.endsWith('.vibenote')))

  const replay = await run(['blocks', 'append', '--note', 'internal:stream', '--content-stdin', '--idempotency-key', 'runtime-primary', '--expected-revision', proposal.expectedRevision, ...base], 'Runtime appended content')
  assert.equal(response(replay).data.replayed, true)
  assert.equal(await fs.promises.readFile(streamPath, 'utf8'), afterApply)

  const mismatch = await run(['blocks', 'append', '--note', 'internal:stream', '--content-stdin', '--idempotency-key', 'runtime-primary', '--accept-current', ...base], 'Changed content')
  assert.equal(mismatch.status, 6)
  assert.equal(mismatch.stdout, '')
  assert.equal(response(mismatch).error.code, 'IDEMPOTENCY_MISMATCH')

  const stale = await run(['blocks', 'append', '--note', 'internal:stream', '--content', 'stale', '--idempotency-key', 'runtime-stale', '--expected-revision', proposal.expectedRevision, ...base])
  assert.equal(stale.status, 4)
  assert.equal(response(stale).error.code, 'REVISION_CONFLICT')

  const current = response(await run(['notes', 'read', '--note', 'internal:stream', ...base])).data.revision
  const concurrentArgs = key => ['blocks', 'append', '--note', 'internal:stream', '--content', key, '--idempotency-key', key, '--expected-revision', current, ...base]
  const concurrent = await Promise.all([run(concurrentArgs('runtime-a')), run(concurrentArgs('runtime-b'))])
  assert.equal(concurrent.filter(result => result.status === 0).length, 1)
  assert.equal(concurrent.filter(result => [4].includes(result.status)).length, 1)

  const finalText = await fs.promises.readFile(streamPath, 'utf8')
  assert.equal(finalText.slice(0, original.length), original)
  assert.equal((finalText.match(/^---block:/gm) || []).length, 3)
  console.log('CLI runtime verification passed.')
} finally {
  await fs.promises.rm(root, { recursive: true, force: true })
}
