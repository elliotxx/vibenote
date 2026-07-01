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
      save(payload: { mime: string; data: ArrayBuffer }): Promise<string>
      resolveLegacyUrl(url: string): Promise<string>
    }
    settings: {
      getTheme(): Promise<string>
      setTheme(theme: string): Promise<boolean>
    }
    commands: {
      onEditorCommand(callback: (command: EditorCommand) => void): () => void
    }
  }
}
