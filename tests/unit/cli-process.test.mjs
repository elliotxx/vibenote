import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const cliPath = path.resolve('cli/vibenote.mjs')

function run(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    encoding: 'utf8',
    input: options.input,
    env: { ...process.env, NO_COLOR: '1' },
  })
}

async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-cli-process-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  await fs.promises.mkdir(path.join(root, 'notes'))
  await fs.promises.writeFile(path.join(root, 'notes', 'stream.txt'), '{"formatVersion":"1.0.0","name":"Stream"}\n---block:markdown;auto=1;created=2026-01-01T00:00:00.000Z\nSynthetic needle')
  return root
}

test('no arguments prints help on stdout', () => {
  const result = run([])

  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  assert.match(result.stdout, /^Usage: vibenote /)
  assert.match(result.stdout, /vibenote capabilities/)
})

test('help aliases print the same help on stdout', () => {
  const expected = run([]).stdout

  for (const args of [['help'], ['-h'], ['--help']]) {
    const result = run(args)
    assert.equal(result.status, 0, args.join(' '))
    assert.equal(result.stderr, '', args.join(' '))
    assert.equal(result.stdout, expected, args.join(' '))
  }
})

test('blocks help aliases describe block subcommands', () => {
  for (const flag of ['-h', '--help']) {
    const result = run(['blocks', flag])
    assert.equal(result.status, 0, flag)
    assert.equal(result.stderr, '', flag)
    assert.match(result.stdout, /^Usage: vibenote blocks <command>/)
    assert.match(result.stdout, /blocks append/)
  }
})

test('nested command help describes usage and options', () => {
  const cases = [
    { args: ['notes', '--help'], usage: 'Usage: vibenote notes <command>', option: 'notes read' },
    { args: ['blocks', 'append', '--help'], usage: 'Usage: vibenote blocks append', option: '--dry-run' },
    { args: ['notes', 'read', '-h'], usage: 'Usage: vibenote notes read', option: '--raw' },
    { args: ['search', '--help'], usage: 'Usage: vibenote search', option: '--query' },
  ]

  for (const { args, usage, option } of cases) {
    const result = run(args)
    assert.equal(result.status, 0, args.join(' '))
    assert.equal(result.stderr, '', args.join(' '))
    assert.match(result.stdout, new RegExp(`^${usage}`), args.join(' '))
    assert.match(result.stdout, new RegExp(option), args.join(' '))
  }
})

test('capabilities emits one JSON document on stdout', async t => {
  const root = await fixture(t)
  const result = run(['capabilities', '--data-dir', root, '--output', 'json'])

  assert.equal(result.status, 0)
  assert.equal(result.stderr, '')
  const response = JSON.parse(result.stdout)
  assert.equal(response.ok, true)
  assert.equal(response.schemaVersion, 'v1alpha1')
  assert.equal(response.command, 'capabilities')
  assert.equal(response.data.mutations.append.dryRun, true)
})

test('append requires explicit data directory and reports JSON error only on stderr', () => {
  const result = run(['blocks', 'append', '--note', 'internal:stream', '--content', 'synthetic', '--idempotency-key', 'task', '--accept-current', '--output', 'json'])

  assert.equal(result.status, 5)
  assert.equal(result.stdout, '')
  const response = JSON.parse(result.stderr)
  assert.equal(response.ok, false)
  assert.equal(response.error.code, 'MUTATION_SCOPE_DENIED')
})

test('stdin dry-run and apply share the same block id', async t => {
  const root = await fixture(t)
  const common = ['blocks', 'append', '--data-dir', root, '--note', 'internal:stream', '--content-stdin', '--idempotency-key', 'task', '--output', 'json']
  const dryRun = run([...common, '--dry-run'], { input: 'New synthetic block' })
  const proposal = JSON.parse(dryRun.stdout)
  const apply = run([...common, '--expected-revision', proposal.data.expectedRevision], { input: 'New synthetic block' })
  const written = JSON.parse(apply.stdout)

  assert.equal(dryRun.status, 0)
  assert.equal(apply.status, 0)
  assert.equal(proposal.data.blockId, written.data.blockId)
  assert.equal(written.data.dryRun, false)
})
