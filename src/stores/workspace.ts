import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

export type ImageStorageMode = 'beside-file' | 'app-data'

export type Settings = {
  theme: 'light' | 'dark'
  fontSize: number
  tabSize: number
  defaultLanguage: string
  imageStorage: ImageStorageMode
  ai: AiSettings
}

const defaultAiSettings: AiSettings = {
  enabled: false,
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-chat',
  hasApiKey: false,
  keyStorage: 'none',
}

let unsubscribeOpenedBuffer: (() => void) | null = null
let unsubscribeBufferChanged: (() => void) | null = null
let unsubscribeGitBackupStatus: (() => void) | null = null

export const useWorkspaceStore = defineStore('workspace', () => {
  const buffers = ref<BufferInfo[]>([])
  const currentPath = ref<string | null>(null)
  const currentContent = ref('')
  const searchResults = ref<SearchResult[]>([])
  const recoveries = ref<RecoveryInfo[]>([])
  const gitBackupSettings = ref<GitBackupSettings>({
    version: 1,
    enabled: false,
    repositoryPath: null,
    repositoryInitializedByApp: false,
  })
  const gitBackupStatus = ref<GitBackupStatus>({
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
  const settings = reactive<Settings>({
    theme: 'light',
    fontSize: 13,
    tabSize: 4,
    defaultLanguage: 'markdown',
    imageStorage: 'beside-file',
    ai: { ...defaultAiSettings },
  })

  function bufferTitle(path: string) {
    return buffers.value.find(buffer => buffer.path === path)?.name || path
  }

  async function init() {
    const stored = localStorage.getItem('vibenote:settings')
    if (stored) {
      const parsed = JSON.parse(stored)
      Object.assign(settings, parsed)
      settings.imageStorage = parsed.imageStorage === 'app-data' ? 'app-data' : 'beside-file'
      settings.ai = { ...defaultAiSettings, ...parsed.ai, hasApiKey: false }
    }
    settings.ai = { ...settings.ai, ...(await window.vibenote.ai.getSettings()) }
    try {
      gitBackupSettings.value = await window.vibenote.gitBackup.getSettings()
      gitBackupStatus.value = await window.vibenote.gitBackup.getStatus()
      if (!unsubscribeGitBackupStatus) {
        unsubscribeGitBackupStatus = window.vibenote.gitBackup.onStatusChanged(status => {
          gitBackupStatus.value = status
        })
      }
    } catch {
      // Git backup is optional; note loading and saving must remain available.
    }
    watchOpenedBuffers()
    watchBufferChanges()
    await refreshBuffers()
    localStorage.removeItem('vibenote:openTabs')
    const pending = await window.vibenote.buffer.consumePendingOpen()
    if (pending) {
      await refreshBuffers()
      await openBuffer(pending.path)
    } else {
      const stream = buffers.value.find(buffer => buffer.isScratch) || buffers.value[0]
      await openBuffer(stream?.path)
    }
    await refreshRecoveries()
  }

  function watchOpenedBuffers() {
    if (unsubscribeOpenedBuffer) return
    unsubscribeOpenedBuffer = window.vibenote.buffer.onOpened(async buffer => {
      if (!buffer) return
      await refreshBuffers()
      await openBuffer(buffer.path)
    })
  }

  function watchBufferChanges() {
    if (unsubscribeBufferChanged) return
    unsubscribeBufferChanged = window.vibenote.buffer.onChanged(change => {
      window.dispatchEvent(new CustomEvent('vibenote:buffer-changed', { detail: change }))
    })
  }

  async function refreshBuffers() {
    buffers.value = await window.vibenote.buffer.list()
  }

  async function openBuffer(path: string | undefined | null) {
    if (!path) return
    const content = await window.vibenote.buffer.load(path)
    const normalized = await normalizeLegacyImageUrls(content)
    if (normalized !== content) {
      await window.vibenote.buffer.save(path, normalized)
      await refreshBuffers()
    }
    currentContent.value = normalized
    currentPath.value = path
  }

  async function normalizeLegacyImageUrls(content: string) {
    const imagePattern = /!\[[^\]]*]\((<([^>]+)>|([^)]+))\)/g
    const matches = Array.from(content.matchAll(imagePattern))
      .filter(match => (match[2] || match[3] || '').trim().startsWith('vibenote-image://'))
    if (matches.length === 0) return content

    let normalized = content
    for (const match of matches.reverse()) {
      const originalUrl = (match[2] || match[3] || '').trim()
      try {
        const absolutePath = await window.vibenote.image.resolveLegacyUrl(originalUrl)
        const replacement = match[0].replace(match[1], `<${absolutePath}>`)
        const start = match.index ?? 0
        normalized = `${normalized.slice(0, start)}${replacement}${normalized.slice(start + match[0].length)}`
      } catch {
        // Keep unreadable legacy image links unchanged.
      }
    }
    return normalized
  }

  async function saveBuffer(path: string | null | undefined, content: string) {
    if (!path) return
    await window.vibenote.buffer.save(path, content)
    if (currentPath.value === path) {
      currentContent.value = content
    }
    await refreshBuffers()
    await refreshRecoveries()
  }

  async function saveCurrent(content: string) {
    await saveBuffer(currentPath.value, content)
  }

  function saveBufferSync(path: string | null | undefined, content: string) {
    if (!path) return
    window.vibenote.buffer.saveSync(path, content)
    if (currentPath.value === path) {
      currentContent.value = content
    }
  }

  function saveCurrentSync(content: string) {
    saveBufferSync(currentPath.value, content)
  }

  async function snapshotBuffer(path: string | null | undefined, content: string, reason: string) {
    if (!path) return
    await window.vibenote.buffer.snapshot(path, content, reason)
  }

  function snapshotBufferSync(path: string | null | undefined, content: string, reason: string) {
    if (!path) return
    window.vibenote.buffer.snapshotSync(path, content, reason)
  }

  async function listRecoveries() {
    return window.vibenote.buffer.listRecoveries()
  }

  async function readRecovery(path: string) {
    return window.vibenote.buffer.readRecovery(path)
  }

  async function refreshRecoveries() {
    recoveries.value = await listRecoveries()
    return recoveries.value
  }

  async function archiveStream(name: string) {
    await window.vibenote.buffer.archiveStream(name)
    await refreshBuffers()
    const stream = buffers.value.find(buffer => buffer.isScratch) || buffers.value[0]
    await openBuffer(stream?.path)
  }

  async function openExternalFile() {
    const buffer = await window.vibenote.buffer.openExternal()
    if (!buffer) return
    await refreshBuffers()
    await openBuffer(buffer.path)
  }

  async function createExternalFile() {
    const buffer = await window.vibenote.buffer.createExternal()
    if (!buffer) return
    await refreshBuffers()
    await openBuffer(buffer.path)
  }

  async function searchLibrary(query: string) {
    searchResults.value = await window.vibenote.library.search(query)
  }

  async function openSearchResult(result: SearchResult) {
    await openBuffer(result.path)
    window.dispatchEvent(new CustomEvent('vibenote:goto-line', { detail: result }))
  }

  function aiSettingsPayload(): AiSettings {
    return {
      enabled: Boolean(settings.ai.enabled),
      provider: settings.ai.provider,
      baseUrl: settings.ai.baseUrl,
      model: settings.ai.model,
      hasApiKey: Boolean(settings.ai.hasApiKey),
      keyStorage: settings.ai.keyStorage,
    }
  }

  async function saveSettings() {
    localStorage.setItem('vibenote:settings', JSON.stringify(settings))
    window.vibenote.settings.setTheme(settings.theme)
    try {
      const saved = await window.vibenote.ai.saveSettings(aiSettingsPayload())
      settings.ai = saved
      localStorage.setItem('vibenote:settings', JSON.stringify(settings))
    } catch (error) {
      console.error('Failed to save AI settings', error)
    }
  }

  async function setAiApiKey(apiKey: string) {
    await window.vibenote.ai.saveSettings(aiSettingsPayload())
    settings.ai = await window.vibenote.ai.setApiKey(apiKey)
    localStorage.setItem('vibenote:settings', JSON.stringify(settings))
  }

  async function clearAiApiKey() {
    settings.ai = await window.vibenote.ai.clearApiKey()
    localStorage.setItem('vibenote:settings', JSON.stringify(settings))
  }

  async function testAiConnection() {
    await saveSettings()
    return window.vibenote.ai.testConnection()
  }

  async function completeWithAi(payload: AiCompletionRequest) {
    await saveSettings()
    return window.vibenote.ai.complete(payload)
  }

  async function chooseGitBackupRepository() {
    gitBackupSettings.value = await window.vibenote.gitBackup.chooseRepository()
    gitBackupStatus.value = await window.vibenote.gitBackup.getStatus()
    return gitBackupSettings.value
  }

  async function setGitBackupEnabled(enabled: boolean) {
    gitBackupSettings.value = await window.vibenote.gitBackup.setEnabled(enabled)
    gitBackupStatus.value = await window.vibenote.gitBackup.getStatus()
    return gitBackupSettings.value
  }

  return {
    buffers,
    currentPath,
    currentContent,
    searchResults,
    recoveries,
    gitBackupSettings,
    gitBackupStatus,
    settings,
    bufferTitle,
    init,
    refreshBuffers,
    openBuffer,
    openExternalFile,
    createExternalFile,
    saveCurrent,
    saveCurrentSync,
    saveBuffer,
    saveBufferSync,
    snapshotBuffer,
    snapshotBufferSync,
    listRecoveries,
    readRecovery,
    refreshRecoveries,
    archiveStream,
    searchLibrary,
    openSearchResult,
    saveSettings,
    setAiApiKey,
    clearAiApiKey,
    testAiConnection,
    completeWithAi,
    chooseGitBackupRepository,
    setGitBackupEnabled,
  }
})
