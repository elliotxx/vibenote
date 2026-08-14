import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MANAGED_MARKER = '# vibenote-agent-cli-managed:v1'

function shellQuote(value) {
  if (value.includes('\0') || value.includes('\n') || value.includes('\r')) {
    throw new Error('Agent CLI path contains unsupported characters')
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function launcherContent(runtimePath, cliEntry, appVersion) {
  return [
    '#!/bin/sh',
    MANAGED_MARKER,
    `# vibenote-app-version:${appVersion}`,
    'export ELECTRON_RUN_AS_NODE=1',
    `exec ${shellQuote(runtimePath)} ${shellQuote(cliEntry)} "$@"`,
    '',
  ].join('\n')
}

export class AgentCliInstaller {
  constructor({ binDirectory, runtimePath, cliEntry, appVersion, pathValue = process.env.PATH || '', allowedAppRoots }) {
    this.binDirectory = path.resolve(binDirectory)
    this.commandPath = path.join(this.binDirectory, 'vibenote')
    this.runtimePath = path.resolve(runtimePath)
    this.cliEntry = path.resolve(cliEntry)
    this.appVersion = appVersion
    this.pathValue = pathValue
    this.allowedAppRoots = allowedAppRoots || ['/Applications', path.join(os.homedir(), 'Applications')]
  }

  expectedLauncher() {
    return launcherContent(this.runtimePath, this.cliEntry, this.appVersion)
  }

  pathConfigured() {
    return this.pathValue.split(path.delimiter).some(entry => path.resolve(entry) === this.binDirectory)
  }

  hasStableAppLocation() {
    const appMarker = `.app${path.sep}Contents${path.sep}MacOS${path.sep}`
    const markerIndex = this.runtimePath.indexOf(appMarker)
    if (markerIndex === -1) return true
    const appBundle = this.runtimePath.slice(0, markerIndex + '.app'.length)
    return this.allowedAppRoots.some(root => {
      const resolvedRoot = path.resolve(root)
      return appBundle.startsWith(`${resolvedRoot}${path.sep}`)
    })
  }

  managedVersion(content) {
    if (content.split('\n')[1] !== MANAGED_MARKER) return null
    const versionLine = content.split('\n')[2] || ''
    const prefix = '# vibenote-app-version:'
    if (!versionLine.startsWith(prefix)) return null
    const version = versionLine.slice(prefix.length)
    if (!version || content !== launcherContent(this.runtimePath, this.cliEntry, version)) return null
    return version
  }

  async getStatus() {
    if (!this.hasStableAppLocation()) return this.status('unsupported-location')
    let stat
    try {
      stat = await fs.promises.lstat(this.commandPath)
    } catch (error) {
      if (error?.code === 'ENOENT') return this.status('not-installed')
      throw error
    }
    if (!stat.isFile() || stat.isSymbolicLink()) return this.status('conflict')
    const content = await fs.promises.readFile(this.commandPath, 'utf8')
    const managedVersion = this.managedVersion(content)
    if (!managedVersion) return this.status('conflict')
    return this.status(managedVersion === this.appVersion ? 'installed' : 'update-available')
  }

  status(state) {
    return {
      state,
      commandPath: this.commandPath,
      binDirectory: this.binDirectory,
      appVersion: this.appVersion,
      pathConfigured: this.pathConfigured(),
    }
  }

  async install() {
    const current = await this.getStatus()
    if (current.state === 'unsupported-location') {
      const error = new Error('Move Vibenote to Applications before installing the Agent CLI')
      error.code = 'AGENT_CLI_APP_LOCATION_UNSUPPORTED'
      throw error
    }
    if (current.state === 'conflict') {
      const error = new Error('A non-Vibenote command already exists at the install path')
      error.code = 'AGENT_CLI_CONFLICT'
      throw error
    }
    await fs.promises.mkdir(this.binDirectory, { recursive: true, mode: 0o755 })
    const temporary = `${this.commandPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
    let previous = null
    try {
      await fs.promises.writeFile(temporary, this.expectedLauncher(), { encoding: 'utf8', mode: 0o755 })
      await fs.promises.chmod(temporary, 0o755)
      if (current.state === 'update-available') {
        previous = `${this.commandPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.previous`
        await this.moveCommand(previous)
        const previousContent = await fs.promises.readFile(previous, 'utf8')
        if (!this.managedVersion(previousContent)) {
          await this.restoreMovedFile(previous)
          previous = null
          const error = new Error('The command changed during installation and was not overwritten')
          error.code = 'AGENT_CLI_CONFLICT'
          throw error
        }
      }
      await fs.promises.link(temporary, this.commandPath)
      if (previous) await fs.promises.rm(previous, { force: true })
      previous = null
    } catch (error) {
      if (previous) {
        try {
          await this.restoreMovedFile(previous)
        } catch (restoreError) {
          if (restoreError?.code !== 'EEXIST') throw restoreError
          await fs.promises.rm(previous, { force: true }).catch(() => {})
        }
      }
      await fs.promises.rm(temporary, { force: true }).catch(() => {})
      if (error?.code === 'EEXIST') {
        const conflict = new Error('A command appeared at the install path and was not overwritten')
        conflict.code = 'AGENT_CLI_CONFLICT'
        throw conflict
      }
      throw error
    }
    await fs.promises.rm(temporary, { force: true })
    return this.getStatus()
  }

  async restoreMovedFile(movedPath) {
    try {
      await fs.promises.link(movedPath, this.commandPath)
      await fs.promises.rm(movedPath)
    } catch (error) {
      error.message = `${error.message}; moved command preserved at ${movedPath}`
      throw error
    }
  }

  async moveCommand(destination) {
    await fs.promises.rename(this.commandPath, destination)
  }

  async uninstall() {
    const current = await this.getStatus()
    if (current.state === 'not-installed') return current
    if (current.state === 'unsupported-location') {
      const error = new Error('Move Vibenote to Applications before managing the Agent CLI')
      error.code = 'AGENT_CLI_APP_LOCATION_UNSUPPORTED'
      throw error
    }
    if (current.state === 'conflict') {
      const error = new Error('The command at the install path is not managed by Vibenote')
      error.code = 'AGENT_CLI_CONFLICT'
      throw error
    }
    const moved = `${this.commandPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.uninstalling`
    await this.moveCommand(moved)
    const movedContent = await fs.promises.readFile(moved, 'utf8')
    if (!this.managedVersion(movedContent)) {
      await this.restoreMovedFile(moved)
      const error = new Error('The command changed during uninstall and was not removed')
      error.code = 'AGENT_CLI_CONFLICT'
      throw error
    }
    await fs.promises.rm(moved)
    await fs.promises.rmdir(this.binDirectory).catch(() => {})
    return this.getStatus()
  }
}
