import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'
import { GitBackupManager, GitRunner, redactGitOutput } from '../electron/gitBackup.js'

const exec = promisify(execFile)
const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vibenote-git-check-'))
const userDataPath = path.join(root, 'profile')
const notesPath = path.join(userDataPath, 'notes')
const repositoryPath = path.join(root, 'repository')
const bareRemotePath = path.join(root, 'remote.git')

async function git(cwd, ...args) {
  return (await exec('git', args, { cwd })).stdout.trim()
}

function failingGitFixture(stderr) {
  return () => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = () => true
    queueMicrotask(() => {
      child.stderr.end(stderr)
      child.stdout.end()
      child.emit('close', 1)
    })
    return child
  }
}

try {
  await fs.promises.mkdir(notesPath, { recursive: true })
  await fs.promises.mkdir(repositoryPath)
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), 'Synthetic first version\n')
  const manager = new GitBackupManager({ userDataPath, notesPath, appVersion: 'runtime-fixture', intervalMs: 60_000 })
  await manager.init()
  await manager.configureRepository(repositoryPath)
  await git(repositoryPath, 'config', 'user.name', 'Vibenote Runtime')
  await git(repositoryPath, 'config', 'user.email', 'runtime@example.invalid')
  await manager.setEnabled(true)
  assert.equal(await git(repositoryPath, 'rev-list', '--count', 'HEAD'), '1')
  assert.equal(
    await git(repositoryPath, 'log', '-1', '--format=%B'),
    'chore(vibenote): auto backup\n\nVibenote-Auto-Backup: true',
  )
  assert.equal(manager.getStatus().lastResult, 'committed-local')
  await manager.requestRun({ reason: 'no-change' })
  assert.equal(await git(repositoryPath, 'rev-list', '--count', 'HEAD'), '1')
  assert.equal(manager.getStatus().lastResult, 'no-changes')
  console.log('ok - empty repository init, automatic commit trailer, and no-change skip')

  await fs.promises.writeFile(path.join(repositoryPath, 'unrelated.txt'), 'Keep staged\n')
  await git(repositoryPath, 'add', 'unrelated.txt')
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), 'Synthetic second version\n')
  manager.markDirty()
  await manager.requestRun({ reason: 'save' })
  assert.doesNotMatch(await git(repositoryPath, 'show', '--format=', '--name-only', 'HEAD'), /unrelated\.txt/)
  assert.match(await git(repositoryPath, 'diff', '--cached', '--name-only'), /unrelated\.txt/)
  console.log('ok - managed pathspec commit preserves unrelated staged content')

  await exec('git', ['init', '--bare', bareRemotePath])
  await git(repositoryPath, 'remote', 'add', 'origin', bareRemotePath)
  await manager.requestRun({ reason: 'retry-push' })
  const branch = await git(repositoryPath, 'symbolic-ref', '--short', 'HEAD')
  const localHead = await git(repositoryPath, 'rev-parse', 'HEAD')
  const remoteHead = await git(bareRemotePath, 'rev-parse', `refs/heads/${branch}`)
  assert.equal(remoteHead, localHead)
  assert.equal(manager.getStatus().lastResult, 'pushed')
  console.log('ok - safe first push reaches the isolated bare remote')

  const offlineRemotePath = `${bareRemotePath}-offline`
  await fs.promises.rename(bareRemotePath, offlineRemotePath)
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), 'Synthetic offline version\n')
  await manager.requestRun({ reason: 'offline-remote' })
  const offlineHead = await git(repositoryPath, 'rev-parse', 'HEAD')
  assert.equal(manager.getStatus().lastResult, 'push-failed')
  assert.equal(manager.getStatus().pushPending, true)
  assert.notEqual(offlineHead, remoteHead)
  await fs.promises.rename(offlineRemotePath, bareRemotePath)
  await manager.requestRun({ reason: 'remote-restored' })
  assert.equal(await git(bareRemotePath, 'rev-parse', `refs/heads/${branch}`), offlineHead)
  console.log('ok - an offline remote preserves the local commit and retries safely')

  await fs.promises.writeFile(path.join(repositoryPath, 'manual.txt'), 'Synthetic manual change\n')
  await git(repositoryPath, 'add', 'manual.txt')
  await git(repositoryPath, 'commit', '-m', 'docs: synthetic manual commit')
  await fs.promises.writeFile(path.join(notesPath, 'stream.txt'), 'Synthetic third version\n')
  await manager.requestRun({ reason: 'manual-ahead' })
  assert.equal(manager.getStatus().lastResult, 'push-manual-required')
  assert.notEqual(await git(repositoryPath, 'rev-parse', 'HEAD'), remoteHead)
  console.log('ok - a non-automatic local commit pauses push without rewriting history')

  const secondRemote = path.join(root, 'second.git')
  await exec('git', ['init', '--bare', secondRemote])
  await git(repositoryPath, 'remote', 'add', 'secondary', secondRemote)
  await manager.requestRun({ reason: 'multiple-remotes' })
  assert.equal(manager.getStatus().lastResult, 'push-manual-required')
  console.log('ok - multiple remotes require manual push confirmation')

  const unsafeUrl = ['https://fixture-user:', 'fixture-secret@example.invalid/repository.git'].join('')
  const syntheticStderr = `fatal: unable to access '${unsafeUrl}'`
  const sanitized = await new GitRunner({ spawnImpl: failingGitFixture(syntheticStderr) })
    .run(repositoryPath, ['status'], { allowFailure: true })
  assert.doesNotMatch(sanitized.stderr, /fixture-user|fixture-secret/)
  assert.doesNotMatch(redactGitOutput(unsafeUrl), /fixture-user|fixture-secret/)
  console.log('ok - Git error output redacts credential-bearing URLs')

  const queueManager = new GitBackupManager({ userDataPath: path.join(root, 'queue-profile'), notesPath, appVersion: 'runtime-fixture' })
  queueManager.settings = { version: 1, enabled: true, repositoryPath, repositoryInitializedByApp: false }
  let active = 0
  let maximum = 0
  let runs = 0
  queueManager.runOnce = async () => {
    runs += 1
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise(resolve => setTimeout(resolve, 30))
    active -= 1
    return queueManager.getStatus()
  }
  await Promise.all([queueManager.requestRun(), queueManager.requestRun(), queueManager.requestRun()])
  await new Promise(resolve => setTimeout(resolve, 80))
  assert.equal(maximum, 1)
  assert.equal(runs, 2)
  console.log('ok - single-flight folds overlapping requests into one pending run')

  let stopped = false
  const quitManager = new GitBackupManager({
    userDataPath: path.join(root, 'quit-profile'),
    notesPath,
    appVersion: 'runtime-fixture',
    runner: { stopAll() { stopped = true } },
  })
  quitManager.settings = { version: 1, enabled: true, repositoryPath, repositoryInitializedByApp: false }
  quitManager.runOnce = () => new Promise(() => {})
  const quitStartedAt = Date.now()
  await quitManager.flushForQuit(Date.now() + 50)
  assert.ok(Date.now() - quitStartedAt < 500)
  assert.equal(stopped, true)
  console.log('ok - quit-time work stops at the configured deadline')

  const missingIdentityRepository = path.join(root, 'missing-identity')
  const missingIdentityProfile = path.join(root, 'missing-identity-profile')
  const missingIdentityNotes = path.join(missingIdentityProfile, 'notes')
  await fs.promises.mkdir(missingIdentityRepository)
  await fs.promises.mkdir(missingIdentityNotes, { recursive: true })
  await fs.promises.writeFile(path.join(missingIdentityNotes, 'stream.txt'), 'Synthetic identity fixture\n')
  const identityManager = new GitBackupManager({ userDataPath: missingIdentityProfile, notesPath: missingIdentityNotes, appVersion: 'runtime-fixture' })
  await identityManager.init()
  await identityManager.configureRepository(missingIdentityRepository)
  await git(missingIdentityRepository, 'config', 'user.name', '')
  await git(missingIdentityRepository, 'config', 'user.email', '')
  await assert.rejects(identityManager.setEnabled(true), error => error.code === 'identity-missing')
  assert.equal(identityManager.getSettings().enabled, false)
  assert.equal(identityManager.getStatus().lastResult, 'identity-missing')
  console.log('ok - missing Git identity leaves the feature disabled without affecting source notes')

  identityManager.stop()
  manager.stop()
} finally {
  await fs.promises.rm(root, { recursive: true, force: true })
}
