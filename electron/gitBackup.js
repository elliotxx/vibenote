import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {
  GIT_BACKUP_DIRECTORY,
  GIT_BACKUP_OWNERSHIP_FILE,
  GitBackupExportError,
  exportGitBackup,
  inspectGitBackupSource,
  readGitBackupManifest,
  verifyGitBackupSnapshot,
} from './gitBackupExport.js'

export const GIT_BACKUP_INTERVAL_MS = 5 * 60 * 1000
export const GIT_BACKUP_MANAGED_PATHS = [GIT_BACKUP_OWNERSHIP_FILE, GIT_BACKUP_DIRECTORY]

const DEFAULT_SETTINGS = Object.freeze({
  version: 1,
  enabled: false,
  repositoryPath: null,
  repositoryInitializedByApp: false,
})

const DEFAULT_STATUS = Object.freeze({
  version: 1,
  lastAttemptAt: null,
  lastExportAt: null,
  lastCommitAt: null,
  lastPushAt: null,
  lastCommitHash: null,
  lastResult: 'disabled',
  lastErrorCode: null,
  lastErrorMessage: null,
  pushPending: false,
})

const SAFE_ERROR_MESSAGES = Object.freeze({
  'repository-unavailable': 'The configured backup repository is unavailable',
  'mirror-conflict': 'The published backup was modified outside Vibenote',
  'export-incomplete': 'A complete and safe backup snapshot could not be created',
  conflict: 'The Git repository has a conflict or operation in progress',
  'git-unavailable': 'The Git command is unavailable',
  'identity-missing': 'Git user name or email is not configured',
  'git-timeout': 'A Git command exceeded its time limit',
  'push-failed': 'The local backup commit was kept, but push failed',
  'git-failed': 'The Git backup operation failed',
})

export function redactGitOutput(value) {
  return String(value || '')
    .replace(/(https?:\/\/)[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/([?&](?:access_token|token|key|password)=)[^\s&]+/gi, '$1[redacted]')
    .replace(/\b(?:ghp|github_pat|glpat)[A-Za-z0-9_-]{12,}\b/g, '[redacted]')
    .slice(0, 500)
}

async function writeAtomicJson(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.promises.rename(temporaryPath, filePath)
}

async function readJson(filePath, defaults) {
  try {
    return { ...defaults, ...JSON.parse(await fs.promises.readFile(filePath, 'utf8')) }
  } catch {
    return { ...defaults }
  }
}

export class GitBackupError extends Error {
  constructor(code, message = SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES['git-failed']) {
    super(message)
    this.name = 'GitBackupError'
    this.code = code
  }
}

export class GitRunner {
  constructor({ timeoutMs = 15_000, spawnImpl = spawn } = {}) {
    this.timeoutMs = timeoutMs
    this.spawnImpl = spawnImpl
    this.children = new Set()
  }

  run(cwd, args, { allowFailure = false, timeoutMs = this.timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      let child
      try {
        child = this.spawnImpl('git', args, {
          cwd,
          shell: false,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
      } catch (error) {
        reject(new GitBackupError(error?.code === 'ENOENT' ? 'git-unavailable' : 'git-failed'))
        return
      }
      this.children.add(child)
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = callback => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        this.children.delete(child)
        callback()
      }
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        setTimeout(() => child.kill('SIGKILL'), 250).unref?.()
        finish(() => reject(new GitBackupError('git-timeout')))
      }, timeoutMs)
      timeout.unref?.()
      child.stdout?.setEncoding('utf8')
      child.stderr?.setEncoding('utf8')
      child.stdout?.on('data', chunk => { stdout += chunk })
      child.stderr?.on('data', chunk => { stderr += chunk })
      child.on('error', error => finish(() => {
        reject(new GitBackupError(error?.code === 'ENOENT' ? 'git-unavailable' : 'git-failed'))
      }))
      child.on('close', exitCode => finish(() => {
        const result = {
          code: exitCode ?? 1,
          stdout: stdout.trim(),
          stderr: redactGitOutput(stderr.trim()),
        }
        if (result.code === 0 || allowFailure) {
          resolve(result)
          return
        }
        const combined = `${stderr}\n${stdout}`
        const code = /identity unknown|please tell me who you are|user\.name|user\.email/i.test(combined)
          ? 'identity-missing'
          : 'git-failed'
        reject(new GitBackupError(code))
      }))
    })
  }

  stopAll() {
    for (const child of this.children) child.kill('SIGTERM')
  }
}

function errorCode(error) {
  if (error instanceof GitBackupError || error instanceof GitBackupExportError) return error.code
  return 'git-failed'
}

function safeErrorMessage(code) {
  return SAFE_ERROR_MESSAGES[code] || SAFE_ERROR_MESSAGES['git-failed']
}

function splitLines(value) {
  return value.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
}

export class GitBackupManager {
  constructor({
    userDataPath,
    notesPath,
    appVersion,
    runner = new GitRunner(),
    intervalMs = GIT_BACKUP_INTERVAL_MS,
    onStatusChanged = () => {},
  }) {
    this.userDataPath = userDataPath
    this.notesPath = notesPath
    this.userImagesPath = path.join(userDataPath, 'images')
    this.appVersion = appVersion
    this.runner = runner
    this.intervalMs = intervalMs
    this.onStatusChanged = onStatusChanged
    this.settingsPath = path.join(userDataPath, 'git-backup-settings.json')
    this.statusPath = path.join(userDataPath, 'git-backup-state.json')
    this.settings = { ...DEFAULT_SETTINGS }
    this.status = { ...DEFAULT_STATUS }
    this.inFlight = null
    this.pending = false
    this.timer = null
    this.quitting = false
  }

  async init() {
    this.settings = await readJson(this.settingsPath, DEFAULT_SETTINGS)
    this.status = await readJson(this.statusPath, DEFAULT_STATUS)
    if (!this.settings.enabled) await this.updateStatus({ lastResult: 'disabled' })
    this.timer = setInterval(() => { void this.requestRun({ reason: 'interval' }) }, this.intervalMs)
    this.timer.unref?.()
    if (this.settings.enabled) void this.requestRun({ reason: 'startup' })
  }

  getSettings() {
    return { ...this.settings }
  }

  getStatus() {
    return { ...this.status }
  }

  async persistSettings(nextSettings) {
    this.settings = { ...DEFAULT_SETTINGS, ...nextSettings }
    await writeAtomicJson(this.settingsPath, this.settings)
    return this.getSettings()
  }

  async updateStatus(patch) {
    this.status = { ...this.status, ...patch }
    await writeAtomicJson(this.statusPath, this.status)
    this.onStatusChanged(this.getStatus())
    return this.getStatus()
  }

  async recordFailure(error, forcedCode = null) {
    const code = forcedCode || errorCode(error)
    return this.updateStatus({
      lastResult: code,
      lastErrorCode: code,
      lastErrorMessage: safeErrorMessage(code),
      ...(code === 'push-failed' ? { pushPending: true } : {}),
    })
  }

  async prepareRepository(selectedPath) {
    const requestedPath = path.resolve(selectedPath)
    let stat
    try {
      stat = await fs.promises.stat(requestedPath)
      await fs.promises.access(requestedPath, fs.constants.R_OK | fs.constants.W_OK)
    } catch {
      throw new GitBackupError('repository-unavailable')
    }
    if (!stat.isDirectory()) throw new GitBackupError('repository-unavailable')

    const topLevel = await this.runner.run(requestedPath, ['rev-parse', '--show-toplevel'], { allowFailure: true })
    if (topLevel.code === 0) {
      return {
        repositoryPath: await fs.promises.realpath(topLevel.stdout),
        repositoryInitializedByApp: false,
      }
    }
    if ((await fs.promises.readdir(requestedPath)).length !== 0) {
      throw new GitBackupError('repository-unavailable')
    }
    await this.runner.run(requestedPath, ['init'])
    const root = await this.runner.run(requestedPath, ['rev-parse', '--show-toplevel'])
    return {
      repositoryPath: await fs.promises.realpath(root.stdout),
      repositoryInitializedByApp: true,
    }
  }

  async configureRepository(selectedPath) {
    const prepared = await this.prepareRepository(selectedPath)
    const previousSettings = this.settings
    const nextSettings = {
      ...previousSettings,
      ...prepared,
      enabled: Boolean(previousSettings.enabled),
    }
    this.settings = nextSettings
    try {
      await this.assertRepository()
      await this.assertConflictFree(prepared.repositoryPath)
      const now = new Date()
      await exportGitBackup({
        notesPath: this.notesPath,
        userImagesPath: this.userImagesPath,
        repositoryPath: prepared.repositoryPath,
        appVersion: this.appVersion,
        now,
      })
      await this.updateStatus({
        lastAttemptAt: now.toISOString(),
        lastExportAt: now.toISOString(),
        lastResult: 'ready',
        lastErrorCode: null,
        lastErrorMessage: null,
      })
      await this.persistSettings(nextSettings)
      if (nextSettings.enabled) void this.requestRun({ reason: 'repository-changed', forceExport: false })
      return this.getSettings()
    } catch (error) {
      this.settings = previousSettings
      throw error
    }
  }

  async setEnabled(enabled) {
    if (!enabled) {
      await this.persistSettings({ ...this.settings, enabled: false })
      await this.updateStatus({
        lastResult: 'disabled',
        lastErrorCode: null,
        lastErrorMessage: null,
      })
      return this.getSettings()
    }
    if (!this.settings.repositoryPath) throw new GitBackupError('repository-unavailable')

    const previousSettings = this.settings
    const nextSettings = { ...this.settings, enabled: true }
    this.settings = nextSettings
    try {
      await this.runOnce({ reason: 'enabled', forceExport: false })
      await this.persistSettings(nextSettings)
      return this.getSettings()
    } catch (error) {
      this.settings = { ...previousSettings, enabled: false }
      await this.persistSettings(this.settings)
      await this.recordFailure(error)
      throw error
    }
  }

  markDirty() {
    if (this.settings.enabled && !this.quitting) this.pending = true
  }

  requestRun(options = {}) {
    if (this.quitting || (!this.settings.enabled && !options.force) || !this.settings.repositoryPath) {
      return Promise.resolve(this.getStatus())
    }
    if (this.inFlight) {
      this.pending = true
      return this.inFlight
    }
    this.pending = false
    this.inFlight = this.runOnce(options)
      .catch(async error => {
        await this.recordFailure(error)
        return this.getStatus()
      })
      .finally(() => {
        this.inFlight = null
        if (this.pending && this.settings.enabled && !this.quitting) {
          this.pending = false
          void this.requestRun({ reason: 'pending' })
        }
      })
    return this.inFlight
  }

  async assertRepository() {
    const repositoryPath = this.settings.repositoryPath
    if (!repositoryPath) throw new GitBackupError('repository-unavailable')
    let configuredRoot
    try {
      configuredRoot = await fs.promises.realpath(repositoryPath)
      await fs.promises.access(configuredRoot, fs.constants.R_OK | fs.constants.W_OK)
    } catch {
      throw new GitBackupError('repository-unavailable')
    }
    const topLevel = await this.runner.run(configuredRoot, ['rev-parse', '--show-toplevel'], { allowFailure: true })
    const actualRoot = topLevel.code === 0 ? await fs.promises.realpath(topLevel.stdout).catch(() => null) : null
    if (!actualRoot || actualRoot !== configuredRoot) throw new GitBackupError('repository-unavailable')
    return configuredRoot
  }

  async assertConflictFree(repositoryPath) {
    for (const marker of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD']) {
      const result = await this.runner.run(repositoryPath, ['rev-parse', '--verify', '-q', marker], { allowFailure: true })
      if (result.code === 0) throw new GitBackupError('conflict')
    }
    const unresolved = await this.runner.run(repositoryPath, ['diff', '--name-only', '--diff-filter=U'])
    if (unresolved.stdout) throw new GitBackupError('conflict')
  }

  async commitManagedSnapshot(repositoryPath) {
    const status = await this.runner.run(repositoryPath, ['status', '--porcelain', '--', ...GIT_BACKUP_MANAGED_PATHS])
    if (!status.stdout) return null
    await this.runner.run(repositoryPath, ['add', '-A', '--', ...GIT_BACKUP_MANAGED_PATHS])
    const staged = await this.runner.run(repositoryPath, ['diff', '--cached', '--quiet', '--', ...GIT_BACKUP_MANAGED_PATHS], { allowFailure: true })
    if (staged.code === 0) return null
    if (staged.code !== 1) throw new GitBackupError('git-failed')
    const message = 'chore(vibenote): auto backup\n\nVibenote-Auto-Backup: true'
    await this.runner.run(repositoryPath, ['commit', '--only', '-m', message, '--', ...GIT_BACKUP_MANAGED_PATHS])
    return (await this.runner.run(repositoryPath, ['rev-parse', 'HEAD'])).stdout
  }

  async currentBranch(repositoryPath) {
    const result = await this.runner.run(repositoryPath, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true })
    return result.code === 0 ? result.stdout : null
  }

  async allCommitsAreAutomatic(repositoryPath, range) {
    const log = await this.runner.run(repositoryPath, ['log', '--format=%B%x00', range], { allowFailure: true })
    if (log.code !== 0) return false
    const commits = log.stdout.split('\0').map(message => message.trim()).filter(Boolean)
    return commits.length > 0 && commits.every(message => /^Vibenote-Auto-Backup:\s*true\s*$/m.test(message))
  }

  async pushIfSafe(repositoryPath) {
    const remotes = splitLines((await this.runner.run(repositoryPath, ['remote'])).stdout)
    if (remotes.length === 0) return { result: 'committed-local', pushPending: false, pushed: false }
    if (this.quitting || remotes.length !== 1) return { result: 'push-manual-required', pushPending: true, pushed: false }
    const branch = await this.currentBranch(repositoryPath)
    if (!branch) return { result: 'push-manual-required', pushPending: true, pushed: false }

    const upstream = await this.runner.run(repositoryPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true })
    let baseline = null
    let pushArgs = null
    if (upstream.code === 0) {
      baseline = upstream.stdout
      if (!baseline.startsWith(`${remotes[0]}/`)) return { result: 'push-manual-required', pushPending: true, pushed: false }
      pushArgs = ['push']
    } else {
      const trackingRef = `${remotes[0]}/${branch}`
      const tracking = await this.runner.run(repositoryPath, ['rev-parse', '--verify', '-q', trackingRef], { allowFailure: true })
      if (tracking.code === 0) {
        baseline = trackingRef
        pushArgs = ['push', remotes[0], `HEAD:${branch}`]
      } else if (this.settings.repositoryInitializedByApp) {
        pushArgs = ['push', remotes[0], `HEAD:${branch}`]
      } else {
        return { result: 'push-manual-required', pushPending: true, pushed: false }
      }
    }

    if (baseline) {
      const ancestor = await this.runner.run(repositoryPath, ['merge-base', '--is-ancestor', baseline, 'HEAD'], { allowFailure: true })
      if (ancestor.code !== 0) return { result: 'push-manual-required', pushPending: true, pushed: false }
      const ahead = await this.runner.run(repositoryPath, ['rev-list', '--count', `${baseline}..HEAD`])
      if (Number(ahead.stdout) === 0) return { result: 'no-changes', pushPending: false, pushed: false }
    }

    const range = baseline ? `${baseline}..HEAD` : 'HEAD'
    if (!await this.allCommitsAreAutomatic(repositoryPath, range)) {
      return { result: 'push-manual-required', pushPending: true, pushed: false }
    }
    try {
      await this.runner.run(repositoryPath, pushArgs)
      return { result: 'pushed', pushPending: false, pushed: true }
    } catch (error) {
      await this.recordFailure(error, 'push-failed')
      return { result: 'push-failed', pushPending: true, pushed: false }
    }
  }

  async runOnce({ localOnly = false, forceExport = false } = {}) {
    const now = new Date()
    await this.updateStatus({
      lastAttemptAt: now.toISOString(),
      lastErrorCode: null,
      lastErrorMessage: null,
    })
    const repositoryPath = await this.assertRepository()
    await this.assertConflictFree(repositoryPath)

    const previousManifest = await readGitBackupManifest(repositoryPath)
    const source = await inspectGitBackupSource({ notesPath: this.notesPath, userImagesPath: this.userImagesPath })
    let exported = false
    if (forceExport || !previousManifest || previousManifest.sourceFingerprint !== source.sourceFingerprint) {
      await exportGitBackup({
        notesPath: this.notesPath,
        userImagesPath: this.userImagesPath,
        repositoryPath,
        appVersion: this.appVersion,
        now,
      })
      exported = true
    } else if (!await verifyGitBackupSnapshot(repositoryPath)) {
      throw new GitBackupExportError('mirror-conflict', 'The published backup was modified outside Vibenote')
    }

    const commitHash = await this.commitManagedSnapshot(repositoryPath)
    const head = await this.runner.run(repositoryPath, ['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
    const statusPatch = {
      ...(exported ? { lastExportAt: now.toISOString() } : {}),
      ...(commitHash ? { lastCommitAt: now.toISOString() } : {}),
      lastCommitHash: commitHash || (head.code === 0 ? head.stdout : this.status.lastCommitHash),
    }

    if (localOnly) {
      return this.updateStatus({
        ...statusPatch,
        lastResult: commitHash ? 'committed-local' : 'no-changes',
        pushPending: this.status.pushPending,
      })
    }

    const push = await this.pushIfSafe(repositoryPath)
    const result = !commitHash && !exported && push.result === 'committed-local' ? 'no-changes' : push.result
    return this.updateStatus({
      ...statusPatch,
      lastResult: result,
      lastPushAt: push.pushed ? now.toISOString() : this.status.lastPushAt,
      pushPending: push.pushPending,
    })
  }

  async flushForQuit(deadlineAt = Date.now() + 5_000) {
    if (!this.settings.enabled || !this.settings.repositoryPath) return this.getStatus()
    this.quitting = true
    this.pending = false
    if (this.inFlight) {
      this.runner.stopAll()
      const settleBudget = Math.max(0, Math.min(250, deadlineAt - Date.now()))
      await Promise.race([this.inFlight, new Promise(resolve => setTimeout(resolve, settleBudget))])
    }
    const remaining = Math.max(0, deadlineAt - Date.now())
    if (remaining === 0) return this.getStatus()
    const task = this.runOnce({ localOnly: true }).catch(async error => this.recordFailure(error))
    let timeout
    try {
      return await Promise.race([
        task,
        new Promise(resolve => {
          timeout = setTimeout(() => {
            this.runner.stopAll()
            resolve(this.getStatus())
          }, remaining)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  stop() {
    this.quitting = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.runner.stopAll()
  }
}
