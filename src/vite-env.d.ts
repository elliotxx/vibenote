/// <reference types="vite/client" />

type BufferInfo = {
  path: string
  name: string
  tags: string[]
  isScratch: boolean
  isExternal?: boolean
  filePath?: string
}

type SearchResult = {
  path: string
  line: number
  column: number
  preview: string
}

type EditorCommand =
  | 'file:new'
  | 'file:open'
  | 'search:block'
  | 'search:document'
  | 'replace:block'
  | 'replace:document'
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
type AiCompletionIntent = 'rewrite' | 'answer'
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
  instruction?: string
  intent?: AiCompletionIntent
}

type AiCompletionResult = {
  ok: boolean
  message: string
  content: string
}

type RecoveryInfo = {
  documentId: string
  identifier: string
  filePath: string
  kind: 'internal' | 'external'
  targetExists: boolean
  updatedAt: string
}

type RecoveryContent = RecoveryInfo & {
  content: string
}

type GitBackupSettings = {
  version: number
  enabled: boolean
  repositoryPath: string | null
  repositoryInitializedByApp: boolean
}

type GitBackupStatus = {
  version: number
  lastAttemptAt: string | null
  lastExportAt: string | null
  lastCommitAt: string | null
  lastPushAt: string | null
  lastCommitHash: string | null
  lastResult: string
  lastErrorCode: string | null
  lastErrorMessage: string | null
  pushPending: boolean
}

interface Window {
  vibenote: {
    buffer: {
      list(): Promise<BufferInfo[]>
      load(path: string): Promise<string>
      save(path: string, content: string): Promise<boolean>
      saveSync(path: string, content: string): boolean
      snapshot(path: string, content: string, reason?: string): Promise<boolean>
      snapshotSync(path: string, content: string, reason?: string): boolean
      create(name: string): Promise<string>
      delete(path: string): Promise<boolean>
      archiveStream(name: string): Promise<string>
      openExternal(): Promise<BufferInfo | null>
      createExternal(): Promise<BufferInfo | null>
      listRecoveries(): Promise<RecoveryInfo[]>
      readRecovery(path: string): Promise<RecoveryContent>
      consumePendingOpen(): Promise<BufferInfo | null>
      onOpened(callback: (buffer: BufferInfo | null) => void): () => void
      onChanged(callback: (change: { path: string; storageRevision: string }) => void): () => void
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
    gitBackup: {
      getSettings(): Promise<GitBackupSettings>
      getStatus(): Promise<GitBackupStatus>
      chooseRepository(): Promise<GitBackupSettings>
      setEnabled(enabled: boolean): Promise<GitBackupSettings>
      onStatusChanged(callback: (status: GitBackupStatus) => void): () => void
    }
    lifecycle: {
      onFlushBeforeQuit(callback: (requestId: string) => void): () => void
      confirmFlushBeforeQuit(requestId: string): void
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
