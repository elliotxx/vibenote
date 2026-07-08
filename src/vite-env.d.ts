/// <reference types="vite/client" />

type BufferInfo = {
  path: string
  name: string
  tags: string[]
  isScratch: boolean
}

type SearchResult = {
  path: string
  line: number
  column: number
  preview: string
}

type EditorCommand =
  | 'block:split'
  | 'block:add-end'
  | 'block:add-start'
  | 'block:add-before'
  | 'block:add-after'
  | 'block:delete'
  | 'block:select'
  | 'block:previous'
  | 'block:next'
  | 'block:format'
  | 'cursor:add-above'
  | 'cursor:add-below'
  | 'language:focus'
  | 'view:font-increase'
  | 'view:font-decrease'
  | 'view:font-reset'

type AiProviderKind = 'openai' | 'deepseek' | 'custom-openai-compatible'
type AiKeyStorageKind = 'none' | 'secure' | 'local-fallback' | 'unknown'
type AiCompletionMode = 'polish' | 'extract-todos'
type ImageStorageMode = 'beside-file' | 'app-data'

type AiSettings = {
  enabled: boolean
  provider: AiProviderKind
  baseUrl: string
  model: string
  hasApiKey: boolean
  keyStorage: AiKeyStorageKind
}

type AiConnectionTestResult = {
  ok: boolean
  message: string
}

type AiCompletionRequest = {
  input: string
  language: string
  scope: 'selection' | 'block'
  mode?: AiCompletionMode
}

type AiCompletionResult = {
  ok: boolean
  message: string
  content: string
}

interface Window {
  vibenote: {
    buffer: {
      list(): Promise<BufferInfo[]>
      load(path: string): Promise<string>
      save(path: string, content: string): Promise<boolean>
      saveSync(path: string, content: string): boolean
      create(name: string): Promise<string>
      delete(path: string): Promise<boolean>
      archiveStream(name: string): Promise<string>
    }
    library: {
      search(query: string): Promise<SearchResult[]>
    }
    image: {
      save(payload: {
        mime: string
        data: ArrayBuffer
        documentPath?: string | null
        storageMode?: ImageStorageMode
      }): Promise<string>
      resolveLegacyUrl(url: string): Promise<string>
    }
    settings: {
      getTheme(): Promise<string>
      setTheme(theme: string): Promise<boolean>
    }
    ai: {
      getSettings(): Promise<AiSettings>
      saveSettings(settings: AiSettings): Promise<AiSettings>
      setApiKey(apiKey: string): Promise<AiSettings>
      clearApiKey(): Promise<AiSettings>
      testConnection(): Promise<AiConnectionTestResult>
      complete(payload: AiCompletionRequest): Promise<AiCompletionResult>
    }
    shell: {
      openExternal(url: string): Promise<boolean>
    }
    commands: {
      onEditorCommand(callback: (command: EditorCommand) => void): () => void
    }
  }
}
