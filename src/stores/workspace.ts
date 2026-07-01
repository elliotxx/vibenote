import { defineStore } from 'pinia'
import { reactive, ref } from 'vue'

export type Settings = {
  theme: 'light' | 'dark'
  fontSize: number
  tabSize: number
  defaultLanguage: string
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const buffers = ref<BufferInfo[]>([])
  const currentPath = ref<string | null>(null)
  const currentContent = ref('')
  const searchResults = ref<SearchResult[]>([])
  const settings = reactive<Settings>({
    theme: 'light',
    fontSize: 13,
    tabSize: 2,
    defaultLanguage: 'markdown',
  })

  function bufferTitle(path: string) {
    return buffers.value.find(buffer => buffer.path === path)?.name || path
  }

  async function init() {
    const stored = localStorage.getItem('vibenote:settings')
    if (stored) {
      Object.assign(settings, JSON.parse(stored))
    }
    await refreshBuffers()
    localStorage.removeItem('vibenote:openTabs')
    const stream = buffers.value.find(buffer => buffer.isScratch) || buffers.value[0]
    await openBuffer(stream?.path)
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

  async function saveCurrent(content: string) {
    if (!currentPath.value) return
    currentContent.value = content
    await window.vibenote.buffer.save(currentPath.value, content)
    await refreshBuffers()
  }

  function saveCurrentSync(content: string) {
    if (!currentPath.value) return
    currentContent.value = content
    window.vibenote.buffer.saveSync(currentPath.value, content)
  }

  async function archiveStream(name: string) {
    await window.vibenote.buffer.archiveStream(name)
    await refreshBuffers()
    const stream = buffers.value.find(buffer => buffer.isScratch) || buffers.value[0]
    await openBuffer(stream?.path)
  }

  async function searchLibrary(query: string) {
    searchResults.value = await window.vibenote.library.search(query)
  }

  async function openSearchResult(result: SearchResult) {
    await openBuffer(result.path)
    window.dispatchEvent(new CustomEvent('vibenote:goto-line', { detail: result }))
  }

  function saveSettings() {
    localStorage.setItem('vibenote:settings', JSON.stringify(settings))
    window.vibenote.settings.setTheme(settings.theme)
  }

  return {
    buffers,
    currentPath,
    currentContent,
    searchResults,
    settings,
    bufferTitle,
    init,
    refreshBuffers,
    openBuffer,
    saveCurrent,
    saveCurrentSync,
    archiveStream,
    searchLibrary,
    openSearchResult,
    saveSettings,
  }
})
