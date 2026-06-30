export type NoteMetadata = {
  formatVersion: string
  name: string
  tags?: string[]
  cursors?: unknown
  foldedRanges?: Array<{ from: number; to: number }>
}

export type LoadedNote = {
  metadata: NoteMetadata
  content: string
}

export function loadNote(raw: string): LoadedNote {
  const firstBlock = raw.indexOf('\n---block:')
  const start = firstBlock === -1 && raw.startsWith('---block:') ? 0 : firstBlock
  if (start === -1) {
    return {
      metadata: { formatVersion: '1.0.0', name: 'Untitled' },
      content: raw,
    }
  }
  const metadataRaw = raw.slice(0, start).trim()
  const metadata = metadataRaw
    ? JSON.parse(metadataRaw)
    : { formatVersion: '1.0.0', name: 'Untitled' }
  return {
    metadata,
    content: raw.slice(start === 0 ? 0 : start + 1),
  }
}

export function serializeNote(note: LoadedNote): string {
  return `${JSON.stringify({
    ...note.metadata,
    formatVersion: '1.0.0',
  })}\n${note.content}`
}

export function blockDelimiter(language: string, auto = false, date = new Date()): string {
  return `\n---block:${language};auto=${auto ? '1' : '0'};created=${date.toISOString()}\n`
}

export function formatInitialContent(language = 'markdown'): string {
  return blockDelimiter(language, true).trimStart()
}
