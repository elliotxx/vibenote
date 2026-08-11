import { formatInitialContent } from './common/noteFormat'

const STORAGE_KEY = 'vibenote:mock-buffers'
const AI_SETTINGS_KEY = 'vibenote:mock-ai-settings'
const RECOVERIES_KEY = 'vibenote:mock-recoveries'
const GIT_BACKUP_SETTINGS_KEY = 'vibenote:mock-git-backup-settings'
const GIT_BACKUP_STATUS_KEY = 'vibenote:mock-git-backup-status'

let mockApiKey = ''

type MockBuffer = BufferInfo & { content: string }
type BufferOpenedCallback = (buffer: BufferInfo | null) => void

const openedCallbacks = new Set<BufferOpenedCallback>()
const gitBackupStatusCallbacks = new Set<(status: GitBackupStatus) => void>()

function toBufferInfo(buffer: MockBuffer): BufferInfo {
  const { content, ...info } = buffer
  void content
  return info
}

function readBuffers(): MockBuffer[] {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return JSON.parse(stored)
  const buffers = [
    {
      path: 'stream.txt',
      name: 'Stream',
      tags: [],
      isScratch: true,
      content: `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${formatInitialContent('markdown')}# Stream\n\nDrop plain text notes here.\n\n---block:json;auto=0;created=${new Date().toISOString()}\n{"service":"api","ok":true}\n\n---block:sql;auto=0;created=${new Date().toISOString()}\nselect * from users where active = true\n\n---block:math;auto=0;created=${new Date().toISOString()}\n2 + 2 * 10\n`,
    },
    {
      path: 'api-notes.txt',
      name: 'API Notes',
      tags: [],
      isScratch: false,
      content: `${JSON.stringify({ formatVersion: '1.0.0', name: 'API Notes' })}\n${formatInitialContent('markdown')}# API Notes\n\nTemporary endpoint notes.\n`,
    },
  ]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buffers))
  return buffers
}

function writeBuffers(buffers: MockBuffer[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(buffers))
}

function readRecoveries(): RecoveryContent[] {
  const stored = localStorage.getItem(RECOVERIES_KEY)
  return stored ? JSON.parse(stored) : []
}

function readMockAiSettings(): AiSettings {
  const stored = localStorage.getItem(AI_SETTINGS_KEY)
  return {
    enabled: false,
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    ...(stored ? JSON.parse(stored) : {}),
    hasApiKey: Boolean(mockApiKey),
    keyStorage: mockApiKey ? 'local-fallback' : 'none',
  }
}

function readMockGitBackupSettings(): GitBackupSettings {
  const stored = localStorage.getItem(GIT_BACKUP_SETTINGS_KEY)
  return {
    version: 1,
    enabled: false,
    repositoryPath: null,
    repositoryInitializedByApp: false,
    ...(stored ? JSON.parse(stored) : {}),
  }
}

function readMockGitBackupStatus(): GitBackupStatus {
  const stored = localStorage.getItem(GIT_BACKUP_STATUS_KEY)
  return {
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
    ...(stored ? JSON.parse(stored) : {}),
  }
}

function writeMockGitBackupStatus(status: GitBackupStatus) {
  localStorage.setItem(GIT_BACKUP_STATUS_KEY, JSON.stringify(status))
  for (const callback of gitBackupStatusCallbacks) callback(status)
}

export function installDevMock() {
  if (window.vibenote) return
  window.vibenote = {
    buffer: {
      async list() {
        return readBuffers().map(({ content, ...buffer }) => buffer)
      },
      async load(path: string) {
        return readBuffers().find(buffer => buffer.path === path)?.content || ''
      },
      async save(path: string, content: string) {
        const buffers = readBuffers()
        const buffer = buffers.find(item => item.path === path)
        if (buffer) buffer.content = content
        writeBuffers(buffers)
        return true
      },
      saveSync(path: string, content: string) {
        const buffers = readBuffers()
        const buffer = buffers.find(item => item.path === path)
        if (buffer) buffer.content = content
        writeBuffers(buffers)
        return true
      },
      async snapshot() {
        return true
      },
      snapshotSync() {
        return true
      },
      async create(name: string) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled'
        const path = `${slug}.txt`
        const buffers = readBuffers()
        buffers.push({
          path,
          name,
          tags: [],
          isScratch: false,
          content: `${JSON.stringify({ formatVersion: '1.0.0', name })}\n${formatInitialContent('markdown')}`,
        })
        writeBuffers(buffers)
        return path
      },
      async delete(path: string) {
        writeBuffers(readBuffers().filter(buffer => buffer.path !== path || buffer.isScratch))
        return true
      },
      async archiveStream(name: string) {
        const buffers = readBuffers()
        const stream = buffers.find(buffer => buffer.isScratch)!
        const path = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.txt`
        buffers.push({ ...stream, path, name, isScratch: false })
        stream.content = `${JSON.stringify({ formatVersion: '1.0.0', name: 'Stream' })}\n${formatInitialContent('markdown')}`
        writeBuffers(buffers)
        return path
      },
      async openExternal() {
        const path = 'external:mock-open'
        const buffers = readBuffers().filter(buffer => buffer.path !== path)
        const buffer: MockBuffer = {
          path,
          name: 'Opened Note',
          tags: [],
          isScratch: false,
          isExternal: true,
          filePath: '/tmp/opened-note.vibenote',
          content: `${JSON.stringify({ formatVersion: '1.0.0', name: 'Opened Note' })}\n${formatInitialContent('markdown')}Opened external note\n`,
        }
        buffers.push(buffer)
        writeBuffers(buffers)
        return toBufferInfo(buffer)
      },
      async createExternal() {
        const path = `external:mock-created-${Date.now()}`
        const buffer: MockBuffer = {
          path,
          name: 'New External Note',
          tags: [],
          isScratch: false,
          isExternal: true,
          filePath: '/tmp/new-external-note.vibenote',
          content: `${JSON.stringify({ formatVersion: '1.0.0', name: 'New External Note' })}\n${formatInitialContent('markdown')}New external note\n`,
        }
        const buffers = readBuffers()
        buffers.push(buffer)
        writeBuffers(buffers)
        return toBufferInfo(buffer)
      },
      async listRecoveries() {
        return readRecoveries().map(({ content, ...recovery }) => recovery)
      },
      async readRecovery(path: string) {
        const recovery = readRecoveries().find(item => item.identifier === path)
        if (!recovery) throw new Error('Recovery draft not found')
        return recovery
      },
      async consumePendingOpen() {
        return null
      },
      onOpened(callback: BufferOpenedCallback) {
        openedCallbacks.add(callback)
        return () => openedCallbacks.delete(callback)
      },
    },
    library: {
      async search(query: string) {
        return readBuffers().flatMap(buffer =>
          buffer.content
            .split('\n')
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => line.toLowerCase().includes(query.toLowerCase()))
            .map(({ line, index }) => ({
              path: buffer.path,
              line: index + 1,
              column: Math.max(0, line.toLowerCase().indexOf(query.toLowerCase())),
              preview: line.trim(),
            })),
        )
      },
    },
    image: {
      async save({ mime, data, documentPath, storageMode }: {
        mime: string
        data: ArrayBuffer
        documentPath?: string | null
        storageMode?: ImageStorageMode
      }) {
        const ext = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1].replace(/[^a-z0-9]/gi, '')
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`
        const documentName = (documentPath || 'stream.txt').replace(/\.txt$/, '').replace(/[^a-z0-9-]+/gi, '-')
        const folder = storageMode === 'app-data'
          ? `/tmp/vibenote-app-images/${documentName}`
          : `/tmp/${documentName}.assets`
        void data
        return `${folder}/${name}`
      },
      async resolveLegacyUrl(url: string) {
        if (!url.startsWith('vibenote-image://')) return url
        const parsed = new URL(url)
        const fileName = decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\//, ''))
        return `/tmp/vibenote-images/${fileName}`
      },
    },
    settings: {
      async getTheme() {
        return 'light'
      },
      async setTheme() {
        return true
      },
    },
    gitBackup: {
      async getSettings() {
        return readMockGitBackupSettings()
      },
      async getStatus() {
        return readMockGitBackupStatus()
      },
      async chooseRepository() {
        const settings = {
          ...readMockGitBackupSettings(),
          repositoryPath: 'Demo Git repository',
          repositoryInitializedByApp: true,
        }
        localStorage.setItem(GIT_BACKUP_SETTINGS_KEY, JSON.stringify(settings))
        writeMockGitBackupStatus({
          ...readMockGitBackupStatus(),
          lastAttemptAt: new Date().toISOString(),
          lastExportAt: new Date().toISOString(),
          lastResult: 'ready',
          lastErrorCode: null,
          lastErrorMessage: null,
        })
        return settings
      },
      async setEnabled(enabled: boolean) {
        const current = readMockGitBackupSettings()
        if (enabled && !current.repositoryPath) throw new Error('Choose a Git repository first')
        const settings = { ...current, enabled }
        localStorage.setItem(GIT_BACKUP_SETTINGS_KEY, JSON.stringify(settings))
        writeMockGitBackupStatus({
          ...readMockGitBackupStatus(),
          lastAttemptAt: enabled ? new Date().toISOString() : readMockGitBackupStatus().lastAttemptAt,
          lastCommitAt: enabled ? new Date().toISOString() : readMockGitBackupStatus().lastCommitAt,
          lastResult: enabled ? 'committed-local' : 'disabled',
          lastErrorCode: null,
          lastErrorMessage: null,
          pushPending: false,
        })
        return settings
      },
      onStatusChanged(callback: (status: GitBackupStatus) => void) {
        gitBackupStatusCallbacks.add(callback)
        return () => gitBackupStatusCallbacks.delete(callback)
      },
    },
    lifecycle: {
      onFlushBeforeQuit(callback: (requestId: string) => void) {
        const listener = (event: Event) => callback((event as CustomEvent<string>).detail)
        window.addEventListener('vibenote:mock-flush-before-quit', listener)
        return () => window.removeEventListener('vibenote:mock-flush-before-quit', listener)
      },
      confirmFlushBeforeQuit(requestId: string) {
        window.dispatchEvent(new CustomEvent('vibenote:mock-flush-complete', { detail: requestId }))
      },
    },
    ai: {
      async getSettings() {
        return readMockAiSettings()
      },
      async saveSettings(settings: AiSettings) {
        const safeSettings: AiSettings = {
          ...settings,
          hasApiKey: Boolean(mockApiKey),
          keyStorage: mockApiKey ? 'local-fallback' : 'none',
        }
        localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(safeSettings))
        return safeSettings
      },
      async setApiKey(apiKey: string) {
        mockApiKey = apiKey.trim()
        return readMockAiSettings()
      },
      async clearApiKey() {
        mockApiKey = ''
        return readMockAiSettings()
      },
      async testConnection() {
        const settings = readMockAiSettings()
        if (!settings.enabled) return { ok: false, message: 'AI is disabled' }
        if (!settings.hasApiKey) return { ok: false, message: 'API key is required' }
        if (!settings.model.trim()) return { ok: false, message: 'Model is required' }
        return { ok: true, message: 'Connection OK' }
      },
      async complete(payload: AiCompletionRequest) {
        const settings = readMockAiSettings()
        if (!settings.enabled) return { ok: false, message: 'AI is disabled', content: '' }
        if (!settings.hasApiKey) return { ok: false, message: 'API key is required', content: '' }
        if (!payload.input.trim()) return { ok: false, message: 'Nothing to send to AI', content: '' }
        if (payload.mode === 'extract-todos') {
          const items = payload.input
            .split(/\n+/)
            .map(line => line.replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, '').trim())
            .filter(Boolean)
            .filter(line =>
              !/[:：]\s*$/.test(line) &&
              /(确认|判断|修复|处理|重启|读|推进|跟进|申请|建设|支持|交付|评估|测试|验证|自测|跑|收集|补齐|打标|通知|登录|扫描|使用|分析|解决|优化|覆盖|联调|归因|治理|拆解|上线|发布|检查|整理|迁移|接入|创建|更新|改|写|看|找|补|review|fix|update|verify|test|ship|release|deploy|implement|support|create)/i.test(line),
            )
            .slice(0, 5)
            .map(line => `- [ ] ${line}`)
          return {
            ok: true,
            message: 'Todo list inserted',
            content: items.join('\n') || '- [ ] Review current note',
          }
        }
        return {
          ok: true,
          message: 'Polished note inserted',
          content: `Polished ${payload.scope}: ${payload.input.trim()}`,
        }
      },
    },
    shell: {
      async openExternal(url: string) {
        window.open(url, '_blank', 'noopener,noreferrer')
        return true
      },
    },
    commands: {
      onEditorCommand() {
        return () => {}
      },
    },
  }
}
