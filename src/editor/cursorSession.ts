export const CURSOR_STATE_STORAGE_KEY = 'vibenote:cursor-state:v1'

const CURSOR_STATE_VERSION = 1
const MAX_CURSOR_ENTRIES = 100

type CursorEntry = {
  anchor: number
  updatedAt: number
}

type CursorState = {
  version: typeof CURSOR_STATE_VERSION
  documents: Record<string, CursorEntry>
}

export type CursorRange = {
  from: number
  to: number
}

function emptyCursorState(): CursorState {
  return { version: CURSOR_STATE_VERSION, documents: {} }
}

function parseCursorState(raw: string | null): CursorState | null {
  if (!raw) return emptyCursorState()
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const candidate = value as Partial<CursorState>
    if (candidate.version !== CURSOR_STATE_VERSION || !candidate.documents || typeof candidate.documents !== 'object') {
      return null
    }

    const documents: Record<string, CursorEntry> = {}
    for (const [identifier, entry] of Object.entries(candidate.documents)) {
      if (!entry || typeof entry !== 'object') continue
      const cursor = entry as Partial<CursorEntry>
      if (!Number.isSafeInteger(cursor.anchor) || !Number.isFinite(cursor.updatedAt)) continue
      documents[identifier] = { anchor: cursor.anchor!, updatedAt: cursor.updatedAt! }
    }
    return { version: CURSOR_STATE_VERSION, documents }
  } catch {
    return null
  }
}

export function readCursorAnchor(storage: Storage, identifier: string): number | null {
  try {
    const state = parseCursorState(storage.getItem(CURSOR_STATE_STORAGE_KEY))
    return state?.documents[identifier]?.anchor ?? null
  } catch {
    return null
  }
}

export function writeCursorAnchor(storage: Storage, identifier: string, anchor: number) {
  if (!identifier || !Number.isSafeInteger(anchor) || anchor < 0) return false
  try {
    const state = parseCursorState(storage.getItem(CURSOR_STATE_STORAGE_KEY)) || emptyCursorState()
    state.documents[identifier] = { anchor, updatedAt: Date.now() }
    const entries = Object.entries(state.documents)
      .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
      .slice(0, MAX_CURSOR_ENTRIES)
    state.documents = Object.fromEntries(entries)
    storage.setItem(CURSOR_STATE_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function validateCursorAnchor(anchor: number | null, docLength: number, delimiters: readonly CursorRange[]) {
  if (anchor === null || !Number.isSafeInteger(anchor) || anchor < 0 || anchor > docLength) return null
  if (delimiters.some(delimiter => anchor >= delimiter.from && anchor < delimiter.to)) return null
  return anchor
}
