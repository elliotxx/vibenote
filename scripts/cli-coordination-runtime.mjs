#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { PackagedAppHarness, noteContent } from './lib/packaged-app-harness.mjs'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
const releaseArch = process.env.VIBENOTE_RELEASE_ARCH || 'arm64'
const appBundlePath = path.join(projectRoot, 'dist', `mac-${releaseArch}`, `${packageJson.build.productName}.app`)
const cliPath = path.join(projectRoot, 'cli', 'vibenote.mjs')
const initial = noteContent([{ language: 'markdown', auto: true, content: 'Synthetic coordination base' }])

function cli(userDataPath, args, input = '') {
  const result = spawnSync(process.execPath, [cliPath, ...args, '--data-dir', userDataPath, '--output', 'json'], {
    encoding: 'utf8',
    input,
    env: { ...process.env, NO_COLOR: '1' },
  })
  const payload = JSON.parse(result.status === 0 ? result.stdout : result.stderr)
  if (result.status !== 0) throw new Error(`${payload.error.code}: ${payload.error.message}`)
  return payload.data
}

const harness = new PackagedAppHarness({ appBundlePath, initialContent: initial })

try {
  assert.ok(fs.existsSync(appBundlePath), 'packaged app must exist')
  const page = await harness.launch()
  await page.getByText('Synthetic coordination base').waitFor()

  const cleanProposal = cli(harness.userDataPath, [
    'blocks', 'append', '--note', 'internal:stream', '--content-stdin',
    '--idempotency-key', 'coordination-clean', '--dry-run',
  ], 'CLI clean marker')
  cli(harness.userDataPath, [
    'blocks', 'append', '--note', 'internal:stream', '--content-stdin',
    '--idempotency-key', 'coordination-clean', '--expected-revision', cleanProposal.expectedRevision,
  ], 'CLI clean marker')
  await page.getByText('CLI clean marker').waitFor({ timeout: 8_000 })
  assert.match(harness.readStream(), /CLI clean marker/)

  await page.evaluate(() => {
    const original = window.setTimeout.bind(window)
    window.setTimeout = (handler, timeout, ...args) =>
      original(handler, timeout === 350 ? 5_000 : timeout, ...args)
  })
  await page.locator('.cm-content').click()
  await page.keyboard.press('Meta+End')
  await page.keyboard.insertText('Local dirty marker')
  cli(harness.userDataPath, [
    'blocks', 'append', '--note', 'internal:stream', '--content', 'CLI dirty marker',
    '--idempotency-key', 'coordination-dirty', '--accept-current',
  ])

  await harness.waitForStream(content => content.includes('CLI dirty marker'), 'CLI dirty append was not persisted')
  await page.waitForTimeout(6_000)
  const target = harness.readStream()
  assert.match(target, /CLI dirty marker/)
  assert.doesNotMatch(target, /Local dirty marker/)
  const recovery = fs.readFileSync(path.join(harness.userDataPath, 'recovery', 'internal_stream.vibenote'), 'utf8')
  assert.match(recovery, /Local dirty marker/)
  await page.getByText(/保存失败|冲突恢复区/).waitFor({ timeout: 8_000 })

  console.log('CLI and desktop coordination verification passed.')
} finally {
  await harness.cleanup()
}
