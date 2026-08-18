import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AgentCliInstaller } from '../../electron/agentCliInstaller.js'

const cliEntry = path.resolve('cli/vibenote.mjs')
const appVersion = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version

test('one-click install creates a managed command that runs the packaged CLI', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-agent-cli-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const installer = new AgentCliInstaller({
    binDirectory: path.join(root, 'bin'),
    runtimePath: process.execPath,
    cliEntry,
    appVersion,
    pathValue: path.join(root, 'bin'),
  })

  assert.equal((await installer.getStatus()).state, 'not-installed')
  const installed = await installer.install()
  assert.equal(installed.state, 'installed')

  const result = spawnSync(installed.commandPath, ['version', '--output', 'json'], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).data.version, appVersion)
})

test('managed command can be updated and uninstalled without leaving files behind', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-agent-cli-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const shared = {
    binDirectory: path.join(root, 'bin'),
    runtimePath: process.execPath,
    cliEntry,
    pathValue: '',
  }
  await new AgentCliInstaller({ ...shared, appVersion: '0.1.10' }).install()

  const current = new AgentCliInstaller({ ...shared, appVersion: '0.1.11' })
  assert.equal((await current.getStatus()).state, 'update-available')
  assert.equal((await current.install()).state, 'installed')
  assert.equal((await current.uninstall()).state, 'not-installed')
  assert.equal(fs.existsSync(path.join(shared.binDirectory, 'vibenote')), false)
})

test('installer refuses to overwrite or remove an unowned command', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-agent-cli-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const binDirectory = path.join(root, 'bin')
  const commandPath = path.join(binDirectory, 'vibenote')
  await fs.promises.mkdir(binDirectory)
  await fs.promises.writeFile(commandPath, '#!/bin/sh\n# unrelated\n# vibenote-agent-cli-managed:v1\n')
  const installer = new AgentCliInstaller({
    binDirectory,
    runtimePath: process.execPath,
    cliEntry,
    appVersion: '0.1.11',
  })

  assert.equal((await installer.getStatus()).state, 'conflict')
  await assert.rejects(installer.install(), error => error.code === 'AGENT_CLI_CONFLICT')
  await assert.rejects(installer.uninstall(), error => error.code === 'AGENT_CLI_CONFLICT')
  assert.match(await fs.promises.readFile(commandPath, 'utf8'), /unrelated/)
})

test('installer treats a modified managed launcher as a conflict', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-agent-cli-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const binDirectory = path.join(root, 'bin')
  const shared = {
    binDirectory,
    runtimePath: process.execPath,
    cliEntry,
    appVersion: '0.1.11',
  }
  const installer = new AgentCliInstaller(shared)
  await installer.install()
  await fs.promises.appendFile(path.join(binDirectory, 'vibenote'), '# locally modified\n')

  assert.equal((await installer.getStatus()).state, 'conflict')
  await assert.rejects(installer.install(), error => error.code === 'AGENT_CLI_CONFLICT')
  await assert.rejects(installer.uninstall(), error => error.code === 'AGENT_CLI_CONFLICT')
})

test('installer preserves a foreign command that appears during an update', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-agent-cli-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const binDirectory = path.join(root, 'bin')
  const commandPath = path.join(binDirectory, 'vibenote')
  const shared = { binDirectory, runtimePath: process.execPath, cliEntry }
  await new AgentCliInstaller({ ...shared, appVersion: '0.1.10' }).install()

  class RacingInstaller extends AgentCliInstaller {
    async moveCommand(destination) {
      await fs.promises.writeFile(this.commandPath, '#!/bin/sh\necho foreign\n')
      await super.moveCommand(destination)
    }
  }
  const installer = new RacingInstaller({ ...shared, appVersion: '0.1.11' })

  await assert.rejects(installer.install(), error => error.code === 'AGENT_CLI_CONFLICT')
  assert.equal(await fs.promises.readFile(commandPath, 'utf8'), '#!/bin/sh\necho foreign\n')
})

test('installer refuses an app runtime from an ephemeral macOS location', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-agent-cli-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const installer = new AgentCliInstaller({
    binDirectory: path.join(root, 'bin'),
    runtimePath: '/Volumes/Vibenote/Vibenote.app/Contents/MacOS/Vibenote',
    cliEntry: '/Volumes/Vibenote/Vibenote.app/Contents/Resources/app.asar/cli/vibenote.mjs',
    appVersion: '0.1.11',
  })

  assert.equal((await installer.getStatus()).state, 'unsupported-location')
  await assert.rejects(installer.install(), error => error.code === 'AGENT_CLI_APP_LOCATION_UNSUPPORTED')
})

test('installer refuses an app outside an Applications directory', async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-agent-cli-'))
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }))
  const installer = new AgentCliInstaller({
    binDirectory: path.join(root, 'bin'),
    runtimePath: '/tmp/Downloads/Vibenote.app/Contents/MacOS/Vibenote',
    cliEntry: '/tmp/Downloads/Vibenote.app/Contents/Resources/app.asar/cli/vibenote.mjs',
    appVersion: '0.1.11',
  })

  assert.equal((await installer.getStatus()).state, 'unsupported-location')
})
