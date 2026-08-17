import { SearchCursor } from '@codemirror/search'
import { CharCategory } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin } from '@codemirror/view'
import { blockField } from './blocks'

const MAX_QUERY_LENGTH = 200
const MAX_MATCHES = 100

const matchDecoration = Decoration.mark({ class: 'cm-selectionMatch' })

function insideWordBoundaries(
  check: (ch: string) => CharCategory,
  state: { sliceDoc(from: number, to: number): string; doc: { length: number } },
  from: number,
  to: number,
) {
  return (from === 0 || check(state.sliceDoc(from - 1, from)) !== CharCategory.Word)
    && (to === state.doc.length || check(state.sliceDoc(to, to + 1)) !== CharCategory.Word)
}

function insideWord(
  check: (ch: string) => CharCategory,
  state: { sliceDoc(from: number, to: number): string },
  from: number,
  to: number,
) {
  return check(state.sliceDoc(from, from + 1)) === CharCategory.Word
    && check(state.sliceDoc(to - 1, to)) === CharCategory.Word
}

function isWholeWordSelection(
  check: (ch: string) => CharCategory,
  state: { sliceDoc(from: number, to: number): string; doc: { length: number } },
  from: number,
  to: number,
) {
  return insideWordBoundaries(check, state, from, to) && insideWord(check, state, from, to)
}

export const selectionMatchHighlighter = ViewPlugin.fromClass(class {
  decorations = Decoration.none

  constructor(view: EditorView) {
    this.decorations = this.getDecorations(view)
  }

  update(update: { selectionSet: boolean; docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
    if (update.selectionSet || update.docChanged || update.viewportChanged) {
      this.decorations = this.getDecorations(update.view)
    }
  }

  getDecorations(view: EditorView) {
    const { state } = view
    const selection = state.selection
    if (selection.ranges.length > 1) return Decoration.none

    const range = selection.main
    if (range.empty) return Decoration.none

    const length = range.to - range.from
    if (length < 1 || length > MAX_QUERY_LENGTH) return Decoration.none

    const query = state.sliceDoc(range.from, range.to)
    if (!query) return Decoration.none

    const check = state.charCategorizer(range.head)
    const wholeWord = isWholeWordSelection(check, state, range.from, range.to)
    const decorations = []

    for (const visible of view.visibleRanges) {
      for (const block of state.field(blockField)) {
        const from = Math.max(visible.from, block.content.from)
        const to = Math.min(visible.to, block.content.to)
        if (from >= to) continue

        const cursor = new SearchCursor(state.doc, query, from, to)
        while (!cursor.next().done) {
          const match = cursor.value
          if (wholeWord && !insideWordBoundaries(check, state, match.from, match.to)) continue
          if (match.from >= range.to || match.to <= range.from) {
            decorations.push(matchDecoration.range(match.from, match.to))
          }
          if (decorations.length > MAX_MATCHES) return Decoration.none
        }
      }
    }

    return Decoration.set(decorations, true)
  }
}, {
  decorations: value => value.decorations,
})
