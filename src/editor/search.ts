import { StateEffect, StateField, type EditorState } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { activeBlock, blockField, type ScratchBlock } from './blocks'

export type EditorSearchScope = 'block' | 'document'
export type EditorSearchMatch = { from: number; to: number }

type SearchDecorationState = {
  matches: EditorSearchMatch[]
  activeIndex: number
}

export const setSearchDecorations = StateEffect.define<SearchDecorationState>()

function buildSearchDecorations(value: SearchDecorationState) {
  const ranges = value.matches.flatMap((match, index) => [
    Decoration.mark({
      class: index === value.activeIndex
        ? 'vibenote-search-match vibenote-search-match-active'
        : 'vibenote-search-match',
    }).range(match.from, match.to),
  ])
  return Decoration.set(ranges, true)
}

export const searchDecorationField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none
  },
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (effect.is(setSearchDecorations)) {
        next = buildSearchDecorations(effect.value)
      }
    }
    return next
  },
  provide(field) {
    return EditorView.decorations.from(field)
  },
})

function searchableBlocks(state: EditorState, scope: EditorSearchScope): ScratchBlock[] {
  if (scope === 'document') return state.field(blockField)
  const block = activeBlock(state)
  return block ? [block] : []
}

export function findEditorSearchMatches(
  state: EditorState,
  query: string,
  scope: EditorSearchScope,
  caseSensitive = false,
): EditorSearchMatch[] {
  if (!query) return []
  const needle = caseSensitive ? query : query.toLocaleLowerCase()
  const matches: EditorSearchMatch[] = []

  for (const block of searchableBlocks(state, scope)) {
    const source = state.doc.sliceString(block.content.from, block.content.to)
    const haystack = caseSensitive ? source : source.toLocaleLowerCase()
    let offset = 0
    while (offset <= haystack.length - needle.length) {
      const index = haystack.indexOf(needle, offset)
      if (index < 0) break
      matches.push({
        from: block.content.from + index,
        to: block.content.from + index + query.length,
      })
      offset = index + Math.max(needle.length, 1)
    }
  }

  return matches
}
