import { StateEffect, StateField, type ChangeSpec } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { blockField, isBlockFolded, isMarkdownBlockPreviewed } from './blocks'

const listItem = /^([ \t]*)(?:[-+*]|\d+[.)])[ \t]+/
const rememberListUnit = StateEffect.define<{ anchor: number, unit: string }>()
export const listIndentationField = StateField.define<ReadonlyMap<number, string>>({
  create: () => new Map(),
  update(previous, transaction) {
    if (!transaction.docChanged && !transaction.effects.some(effect => effect.is(rememberListUnit))) return previous
    const next = new Map<number, string>()
    for (const [anchor, unit] of previous) {
      const mapped = transaction.changes.mapPos(anchor, -1)
      if (listItem.test(transaction.newDoc.lineAt(mapped).text)) next.set(mapped, unit)
    }
    for (const effect of transaction.effects) {
      if (effect.is(rememberListUnit)) {
        next.set(transaction.changes.mapPos(effect.value.anchor, -1), effect.value.unit)
      }
    }
    return next
  },
})

// Inspect only the surrounding list, so another list or block cannot set its style.
function listUnit(lines: string[], index: number, remembered: (first: number) => string | undefined, fallback: string) {
  let first = index
  let last = index
  while (first > 0 && listItem.test(lines[first - 1])) first--
  while (last + 1 < lines.length && listItem.test(lines[last + 1])) last++
  const indents = lines.slice(first, last + 1).map(line => line.match(listItem)![1])
  if (indents.some(indent => indent.includes('\t'))) return { first, unit: '\t' }
  const levels = [...new Set(indents.map(indent => indent.length))].sort((a, b) => a - b)
  const steps = levels.slice(1).map((level, i) => level - levels[i])
  if (levels[0] > 0) steps.push(levels[0])
  const known = remembered(first)
  // Keep the learned step when an edit removes a level or moves the only child.
  if (known && (!steps.length || (known !== '\t' && steps.every(step => step % known.length === 0)))) {
    return { first, unit: known }
  }
  return { first, unit: steps.length ? ' '.repeat(Math.min(...steps)) : fallback }
}

export function indentMarkdownList(view: EditorView, outdent = false) {
  const { state } = view
  if (state.readOnly) return false
  const changes: ChangeSpec[] = []
  const effects: StateEffect<unknown>[] = []
  const visited = new Set<number>()
  for (const range of state.selection.ranges) {
    const block = state.field(blockField).find(block =>
      block.language === 'markdown' && range.from >= block.content.from && range.to <= block.content.to,
    )
    if (!block || isBlockFolded(state, block) || isMarkdownBlockPreviewed(state, block)) return false
    const lines = state.doc.sliceString(block.content.from, block.content.to).split('\n')
    const startLine = state.doc.lineAt(block.content.from).number
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.empty ? range.to : range.to - 1).number
    // List-looking text inside fenced code is ordinary code, not a list.
    let fence: string | null = null
    for (let i = 0; i <= last - startLine; i++) {
      const marker = lines[i].match(/^\s*(`{3,}|~{3,})/)
      if (marker) {
        if (!fence) fence = marker[1]
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      }
      if (i >= first - startLine && (fence || marker)) return false
    }
    for (let number = first; number <= last; number++) {
      const line = state.doc.line(number)
      const match = line.text.match(listItem)
      if (!match) return false
      if (visited.has(line.from)) continue
      visited.add(line.from)
      const { first: listStart, unit } = listUnit(
        lines,
        number - startLine,
        first => state.field(listIndentationField).get(state.doc.line(startLine + first).from),
        state.facet(indentUnit),
      )
      effects.push(rememberListUnit.of({ anchor: state.doc.line(startLine + listStart).from, unit }))
      if (outdent) {
        const count = match[1].startsWith('\t') ? 1 : Math.min(match[1].length, unit.length)
        if (count) changes.push({ from: line.from, to: line.from + count })
      } else {
        changes.push({ from: line.from, insert: unit })
      }
    }
  }
  if (changes.length) {
    view.dispatch({ changes, effects, userEvent: 'input.indent', scrollIntoView: true })
  }
  return true
}
