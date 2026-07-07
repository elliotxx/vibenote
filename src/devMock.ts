import { formatInitialContent } from './common/noteFormat'

const STORAGE_KEY = 'vibenote:mock-buffers'
const AI_SETTINGS_KEY = 'vibenote:mock-ai-settings'

let mockApiKey = ''

type MockBuffer = BufferInfo & { content: string }

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
      async save({ mime, data }: { mime: string; data: ArrayBuffer }) {
        const ext = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1].replace(/[^a-z0-9]/gi, '')
        const name = `${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`
        void data
        return `/tmp/vibenote-images/${name}`
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
        return {
          ok: true,
          message: 'AI suggestion inserted',
          content: `AI suggestion for ${payload.scope}: ${payload.input.trim()}`,
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
