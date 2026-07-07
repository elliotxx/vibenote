import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, protocol, shell } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rgPath } from '@vscode/ripgrep'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = Boolean(process.env.VITE_DEV_SERVER_URL) || !app.isPackaged
const APP_NAME = 'vibenote'
const STREAM_FILE = 'stream.txt'

app.setName('Vibenote')

let mainWindow = null
let library = null
let aiSettings = null
let currentSearch = null

function runtimeIconPath() {
  const candidate = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '../build/icon.png')
  return fs.existsSync(candidate) ? candidate : null
}

function applyRuntimeIcon() {
  const iconPath = runtimeIconPath()
  if (!iconPath) return null
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }
  return iconPath
}

function safeJoin(base, relativePath) {
  const fullPath = path.resolve(base, relativePath)
  const basePath = path.resolve(base)
  if (fullPath !== basePath && !fullPath.startsWith(basePath + path.sep)) {
    throw new Error('Path escapes note library')
  }
  return fullPath
}

function slugifyName(name) {
  return name
    .trim()
    .replace(/[^\p{L}\p{N}._ -]+/gu, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 80) || 'untitled'
}

function initialContent(name = 'Scratch') {
  const created = new Date().toISOString()
  return `${JSON.stringify({ formatVersion: '1.0.0', name, cursors: null, foldedRanges: [] })}\n---block:markdown;auto=1;created=${created}\n`
}

async function writeAtomic(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.promises.writeFile(tmp, content, { encoding: 'utf8', mode: 0o600 })
  await fs.promises.rename(tmp, filePath)
}

function writeAtomicSync(filePath, content) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, filePath)
}

async function readMetadata(filePath) {
  const handle = await fs.promises.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const head = buffer.subarray(0, bytesRead).toString('utf8')
    const idx = head.indexOf('\n---block:')
    if (idx === -1) {
      return {}
    }
    return JSON.parse(head.slice(0, idx).trim() || '{}')
  } catch {
    return {}
  } finally {
    await handle.close()
  }
}

class FileLibrary {
  constructor(basePath) {
    this.basePath = basePath
    this.imagesPath = path.join(basePath, '.images')
    this.loaded = new Map()
  }

  async init() {
    await fs.promises.mkdir(this.basePath, { recursive: true })
    await fs.promises.mkdir(this.imagesPath, { recursive: true })
    const streamPath = path.join(this.basePath, STREAM_FILE)
    if (!fs.existsSync(streamPath)) {
      await writeAtomic(streamPath, initialContent('Stream'))
    }
  }

  async list() {
    const entries = await fs.promises.readdir(this.basePath, { withFileTypes: true })
    const buffers = []
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.txt')) {
        continue
      }
      const metadata = await readMetadata(path.join(this.basePath, entry.name))
      buffers.push({
        path: entry.name,
        name: metadata.name || entry.name.replace(/\.txt$/, ''),
        tags: metadata.tags || [],
        isScratch: entry.name === STREAM_FILE,
      })
    }
    return buffers.sort((a, b) => {
      if (a.isScratch) return -1
      if (b.isScratch) return 1
      return a.name.localeCompare(b.name)
    })
  }

  async load(relativePath) {
    const filePath = safeJoin(this.basePath, relativePath)
    const content = await fs.promises.readFile(filePath, 'utf8')
    this.loaded.set(relativePath, content)
    return content
  }

  async save(relativePath, content) {
    const filePath = safeJoin(this.basePath, relativePath)
    await writeAtomic(filePath, content)
    this.loaded.set(relativePath, content)
    return true
  }

  saveSync(relativePath, content) {
    const filePath = safeJoin(this.basePath, relativePath)
    writeAtomicSync(filePath, content)
    this.loaded.set(relativePath, content)
    return true
  }

  async create(name) {
    const base = slugifyName(name)
    let fileName = `${base}.txt`
    let counter = 2
    while (fs.existsSync(path.join(this.basePath, fileName))) {
      fileName = `${base}-${counter++}.txt`
    }
    await writeAtomic(path.join(this.basePath, fileName), initialContent(name))
    return fileName
  }

  async delete(relativePath) {
    if (relativePath === STREAM_FILE) {
      throw new Error('Main note stream cannot be deleted')
    }
    await fs.promises.unlink(safeJoin(this.basePath, relativePath))
    this.loaded.delete(relativePath)
    return true
  }

  async archiveStream(name) {
    const stream = await this.load(STREAM_FILE)
    const archivePath = await this.create(name)
    await this.save(archivePath, stream.replace(/^\{.*?\}/s, JSON.stringify({
      formatVersion: '1.0.0',
      name,
      cursors: null,
      foldedRanges: [],
    })))
    await this.save(STREAM_FILE, initialContent('Stream'))
    return archivePath
  }

  async saveImage({ mime, data }) {
    if (!mime || !mime.startsWith('image/')) {
      throw new Error('Only image data can be saved')
    }
    const ext = mime.includes('jpeg') ? 'jpg' : mime.split('/')[1].replace(/[^a-z0-9]/gi, '')
    const fileName = `${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`
    const filePath = path.join(this.imagesPath, fileName)
    await fs.promises.writeFile(filePath, Buffer.from(data))
    return filePath
  }

  resolveLegacyImageUrl(url) {
    if (!url.startsWith('vibenote-image://')) return url
    const parsed = new URL(url)
    const fileName = decodeURIComponent(parsed.hostname || parsed.pathname.replace(/^\//, ''))
    return safeJoin(this.imagesPath, fileName)
  }
}

class AiSettingsStore {
  constructor(basePath) {
    this.settingsPath = path.join(basePath, 'ai-settings.json')
    this.keyPath = path.join(basePath, 'ai-key.bin')
    this.defaults = {
      enabled: false,
      provider: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
    }
  }

  async readKeyRecord() {
    try {
      const raw = await fs.promises.readFile(this.keyPath, 'utf8')
      try {
        return JSON.parse(raw)
      } catch {
        return {
          version: 0,
          storage: 'safeStorage',
          value: raw,
        }
      }
    } catch {
      return null
    }
  }

  keyStorageFromRecord(record) {
    if (!record) return 'none'
    if (record.storage === 'localFallback') return 'local-fallback'
    if (record.storage === 'safeStorage') return 'unknown'
    return 'unknown'
  }

  async readSettings() {
    let stored = {}
    try {
      stored = JSON.parse(await fs.promises.readFile(this.settingsPath, 'utf8'))
    } catch {
      stored = {}
    }
    const keyRecord = await this.readKeyRecord()
    return {
      ...this.defaults,
      ...stored,
      hasApiKey: Boolean(keyRecord),
      keyStorage: this.keyStorageFromRecord(keyRecord),
    }
  }

  async saveSettings(settings) {
    const { hasApiKey, keyStorage, ...safeSettings } = settings || {}
    void hasApiKey
    void keyStorage
    await writeAtomic(this.settingsPath, JSON.stringify({ ...this.defaults, ...safeSettings }, null, 2))
    return this.readSettings()
  }

  async setApiKey(apiKey) {
    const value = String(apiKey || '').trim()
    if (!value) {
      throw new Error('API key is required')
    }
    const record = {
      version: 1,
      storage: 'localFallback',
      value: Buffer.from(value, 'utf8').toString('base64'),
    }
    await writeAtomic(this.keyPath, JSON.stringify(record, null, 2))
    return this.readSettings()
  }

  async clearApiKey() {
    await fs.promises.rm(this.keyPath, { force: true })
    return this.readSettings()
  }

  async readApiKey() {
    const record = await this.readKeyRecord()
    if (!record) {
      throw new Error('API key is required')
    }
    if (record.storage === 'localFallback') {
      return Buffer.from(record.value, 'base64').toString('utf8')
    }
    if (record.storage === 'safeStorage') {
      throw new Error('This API key was saved with macOS Keychain. Clear it and save it again.')
    }
    throw new Error('Unsupported API key storage')
  }

  endpointFor(settings) {
    const baseUrl = String(settings.baseUrl || '').trim().replace(/\/+$/, '')
    if (!baseUrl) {
      throw new Error('Base URL is required')
    }
    if (baseUrl.endsWith('/chat/completions')) return baseUrl
    return `${baseUrl}/chat/completions`
  }

  textFromAiValue(value) {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      return value
        .map(item => {
          if (typeof item === 'string') return item
          if (typeof item?.text === 'string') return item.text
          if (typeof item?.text?.value === 'string') return item.text.value
          if (typeof item?.content === 'string') return item.content
          if (Array.isArray(item?.content)) return this.textFromAiValue(item.content)
          return ''
        })
        .filter(Boolean)
        .join('\n')
    }
    return ''
  }

  normalizeAiContent(content) {
    const normalized = String(content || '')
      .replace(/\r\n?/g, '\n')
      .trim()

    if (!normalized.includes('\n') && normalized.includes('\\n')) {
      return normalized.replace(/\\n/g, '\n').replace(/\\t/g, '  ').trim()
    }

    return normalized
  }

  contentFromChatResponse(data) {
    const choice = data?.choices?.[0]
    const responseOutputContent = Array.isArray(data?.output)
      ? data.output.flatMap(item => item?.content || [])
      : []
    return this.normalizeAiContent(
      this.textFromAiValue(choice?.message?.content) ||
      this.textFromAiValue(choice?.text) ||
      this.textFromAiValue(data?.output_text) ||
      this.textFromAiValue(responseOutputContent),
    )
  }

  aiCompletionPrompt({ scope, language, input, isSelection }) {
    const instruction = isSelection
      ? [
          'Rewrite or expand the selected note text below as a useful new note block.',
          'Keep the selected text structure unless it is clearly malformed.',
          'If the selection has multiple lines, keep a multi-line shape.',
        ]
      : [
          'Use the entire current block below as context.',
          'Create a useful follow-up note block from that full context.',
          'Do not summarize it into a single sentence.',
          'Prefer a concise multi-line structure: short heading plus bullets, or grouped bullets when that fits the source.',
          'Carry over the important details, names, decisions, tasks, and open questions from the block.',
        ]

    return [
      `Source scope: ${scope}.`,
      `Source language: ${language}.`,
      ...instruction,
      'Keep the original language.',
      'Return only the new block content.',
      '',
      input,
    ].join('\n')
  }

  async testConnection() {
    const settings = await this.readSettings()
    if (!settings.enabled) {
      return { ok: false, message: 'AI is disabled' }
    }
    if (!settings.hasApiKey) {
      return { ok: false, message: 'API key is required' }
    }
    if (!settings.model) {
      return { ok: false, message: 'Model is required' }
    }

    try {
      const response = await fetch(this.endpointFor(settings), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.readApiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: 'user', content: 'Reply with OK.' }],
          max_tokens: 4,
          temperature: 0,
        }),
      })

      if (!response.ok) {
        return { ok: false, message: `Connection failed (${response.status})` }
      }
      return { ok: true, message: 'Connection OK' }
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' }
    }
  }

  async complete(payload) {
    const settings = await this.readSettings()
    const input = String(payload?.input || '').trim()
    const language = String(payload?.language || 'markdown').trim() || 'markdown'
    const isSelection = payload?.scope === 'selection'
    const scope = isSelection ? 'selection' : 'current block'

    if (!settings.enabled) {
      return { ok: false, message: 'AI is disabled', content: '' }
    }
    if (!settings.hasApiKey) {
      return { ok: false, message: 'API key is required', content: '' }
    }
    if (!settings.model) {
      return { ok: false, message: 'Model is required', content: '' }
    }
    if (!input) {
      return { ok: false, message: 'Nothing to send to AI', content: '' }
    }

    try {
      const response = await fetch(this.endpointFor(settings), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.readApiKey()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            {
              role: 'system',
              content: [
                'You are Vibenote, an AI-native plain text note assistant.',
                'Return only the note content that should be inserted as a new block.',
                'Preserve the source structure: keep line breaks, list markers, indentation, and paragraph spacing.',
                'Do not collapse multi-line input into one paragraph.',
                'For multi-line source text, return a multi-line result.',
                'Never truncate with ellipses or leave a sentence unfinished.',
                'If the source is already useful, return a lightly cleaned or expanded version; never return an empty response.',
                'If there is no useful improvement to make, return the original source text exactly.',
                'Do not include markdown fences unless they are part of the useful note.',
                'Do not output Vibenote block delimiter metadata.',
              ].join(' '),
            },
            {
              role: 'user',
              content: this.aiCompletionPrompt({ scope, language, input, isSelection }),
            },
          ],
          max_tokens: 1400,
          temperature: 0.3,
        }),
      })

      if (!response.ok) {
        return { ok: false, message: `AI request failed (${response.status})`, content: '' }
      }

      const data = await response.json()
      const content = this.contentFromChatResponse(data)
      if (!content) {
        return { ok: true, message: 'AI kept the current block', content: input }
      }
      return { ok: true, message: 'AI suggestion inserted', content }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'AI request failed',
        content: '',
      }
    }
  }
}

function createWindow() {
  const iconPath = runtimeIconPath()
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    title: 'Vibenote',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#f5f6f8',
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow?.webContents.setZoomFactor(1)
  })

  mainWindow.webContents.on('zoom-changed', event => {
    event.preventDefault()
    mainWindow?.webContents.setZoomFactor(1)
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const command = editorCommandForInput(input)
    if (!command) return
    event.preventDefault()
    mainWindow?.webContents.send('editor:command', command)
  })

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:3344')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

function sendEditorCommandWhenFocused(command) {
  if (!mainWindow || !mainWindow.isVisible()) return
  mainWindow.webContents.send('editor:command', command)
}

function setupApplicationMenu() {
  const template = [
    {
      label: 'Vibenote',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'New Block After',
          accelerator: 'CommandOrControl+Enter',
          click: () => sendEditorCommandWhenFocused('block:add-after'),
        },
        {
          label: 'Format Block',
          accelerator: 'Alt+Shift+F',
          click: () => sendEditorCommandWhenFocused('block:format'),
        },
        {
          label: 'Delete Block',
          accelerator: 'Ctrl+Shift+D',
          click: () => sendEditorCommandWhenFocused('block:delete'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        {
          label: 'Reset Editor Font Size',
          accelerator: 'CommandOrControl+0',
          click: () => sendEditorCommandWhenFocused('view:font-reset'),
        },
        {
          label: 'Increase Editor Font Size',
          accelerator: 'CommandOrControl+Plus',
          click: () => sendEditorCommandWhenFocused('view:font-increase'),
        },
        {
          label: 'Decrease Editor Font Size',
          accelerator: 'CommandOrControl+-',
          click: () => sendEditorCommandWhenFocused('view:font-decrease'),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'front' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function editorCommandForInput(input) {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return null
  const primary = input.meta || input.control
  const key = input.key.toLowerCase()
  if (primary && (key === '=' || key === '+')) return 'view:font-increase'
  if (primary && key === '-') return 'view:font-decrease'
  if (primary && key === '0') return 'view:font-reset'
  if (key === 'enter' && primary && input.alt) return 'block:split'
  if (key === 'enter' && primary && input.shift) return 'block:add-end'
  if (key === 'enter' && input.alt && input.shift) return 'block:add-start'
  if (key === 'enter' && input.alt) return 'block:add-before'
  if (key === 'enter' && primary) return 'block:add-after'
  if (key === 'd' && primary && input.shift) return 'block:delete'
  if (key === 'arrowup' && primary && input.alt) return 'cursor:add-above'
  if (key === 'arrowdown' && primary && input.alt) return 'cursor:add-below'
  if (key === 'arrowup' && primary) return 'block:previous'
  if (key === 'arrowdown' && primary) return 'block:next'
  if (key === 'l' && primary) return 'language:focus'
  if (key === 'f' && input.alt && input.shift) return 'block:format'
  return null
}

function startSearch(query) {
  if (currentSearch) {
    currentSearch.kill()
    currentSearch = null
  }
  return new Promise((resolve, reject) => {
    const results = []
    const args = ['--json', '--line-number', '--column', '--fixed-strings', '--ignore-case', '--glob', '*.txt', '--glob', '!.images/**', '--', query, '.']
    const rg = spawn(rgPath.replace(/app\.asar/, 'app.asar.unpacked'), args, { cwd: library.basePath })
    currentSearch = rg
    let stderr = ''
    rg.stdout.setEncoding('utf8')
    rg.stderr.setEncoding('utf8')
    rg.stdout.on('data', chunk => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line) continue
        try {
          const event = JSON.parse(line)
          if (event.type !== 'match') continue
          const data = event.data
          const preview = (data.lines?.text || '').trim()
          results.push({
            path: data.path?.text?.replace(/^\.\//, '') || '',
            line: data.line_number,
            column: data.submatches?.[0]?.start || 0,
            preview,
          })
        } catch {
          // Ignore partial or malformed ripgrep JSON chunks.
        }
      }
    })
    rg.stderr.on('data', chunk => {
      stderr += chunk
    })
    rg.on('close', code => {
      currentSearch = null
      if (code !== 0 && code !== 1) {
        reject(new Error(stderr || `ripgrep exited with ${code}`))
      } else {
        resolve(results)
      }
    })
  })
}

app.whenReady().then(async () => {
  applyRuntimeIcon()
  const basePath = path.join(app.getPath('userData'), 'notes')
  library = new FileLibrary(basePath)
  aiSettings = new AiSettingsStore(app.getPath('userData'))
  await library.init()
  protocol.handle('vibenote-image', async request => {
    const fileName = decodeURIComponent(new URL(request.url).hostname || new URL(request.url).pathname.replace(/^\//, ''))
    const filePath = safeJoin(library.imagesPath, fileName)
    return new Response(await fs.promises.readFile(filePath))
  })
  setupApplicationMenu()
  createWindow()
  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    if (!mainWindow) return
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  globalShortcut.register('CommandOrControl+Shift+D', () => {
    sendEditorCommandWhenFocused('block:delete')
  })
  globalShortcut.register('Ctrl+Shift+D', () => {
    sendEditorCommandWhenFocused('block:delete')
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  app.quit()
})

ipcMain.handle('buffer:list', () => library.list())
ipcMain.handle('buffer:load', (_event, relativePath) => library.load(relativePath))
ipcMain.handle('buffer:save', (_event, relativePath, content) => library.save(relativePath, content))
ipcMain.on('buffer:saveSync', (event, relativePath, content) => {
  try {
    event.returnValue = { ok: library.saveSync(relativePath, content) }
  } catch (error) {
    event.returnValue = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('buffer:create', (_event, name) => library.create(name))
ipcMain.handle('buffer:delete', (_event, relativePath) => library.delete(relativePath))
ipcMain.handle('buffer:archiveStream', (_event, name) => library.archiveStream(name))
ipcMain.handle('library:search', (_event, query) => startSearch(query))
ipcMain.handle('image:save', (_event, payload) => library.saveImage(payload))
ipcMain.handle('image:resolveLegacyUrl', (_event, url) => library.resolveLegacyImageUrl(url))
ipcMain.handle('shell:openExternal', async (_event, url) => {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only HTTP and HTTPS links can be opened')
  }
  await shell.openExternal(parsed.toString())
  return true
})
ipcMain.handle('settings:get', () => nativeTheme.themeSource)
ipcMain.handle('settings:setTheme', (_event, theme) => {
  nativeTheme.themeSource = theme
  return true
})
ipcMain.handle('ai:getSettings', () => aiSettings.readSettings())
ipcMain.handle('ai:saveSettings', (_event, settings) => aiSettings.saveSettings(settings))
ipcMain.handle('ai:setApiKey', (_event, apiKey) => aiSettings.setApiKey(apiKey))
ipcMain.handle('ai:clearApiKey', () => aiSettings.clearApiKey())
ipcMain.handle('ai:testConnection', () => aiSettings.testConnection())
ipcMain.handle('ai:complete', (_event, payload) => aiSettings.complete(payload))
