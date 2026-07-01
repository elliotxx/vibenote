import { Annotation, EditorState, RangeSetBuilder, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutterLineClass } from '@codemirror/view'
import { blockDelimiter } from '../common/noteFormat'
import { detectLanguage } from '../common/languages'

export type ScratchBlock = {
  language: string
  auto: boolean
  created?: string
  delimiter: { from: number; to: number }
  content: { from: number; to: number }
  range: { from: number; to: number }
}

export const delimiterPattern = /(^|\n)---block:([a-z]+)(?:;auto=([01]))?(?:;created=([^\n;]+))?\n/g
export const internalBlockEdit = Annotation.define<boolean>()

export function parseBlocks(doc: { length: number; sliceString(from: number, to?: number): string }): ScratchBlock[] {
  const text = doc.sliceString(0, doc.length)
  const matches = [...text.matchAll(delimiterPattern)]
  if (matches.length === 0) {
    return []
  }
  return matches.map((match, index) => {
    const next = matches[index + 1]
    const delimiterFrom = match.index! + (match[1] === '\n' ? 1 : 0)
    const delimiterTo = match.index! + match[0].length
    return {
      language: match[2],
      auto: match[3] === '1',
      created: match[4],
      delimiter: { from: delimiterFrom, to: delimiterTo },
      content: { from: delimiterTo, to: next ? next.index! : doc.length },
      range: { from: delimiterFrom, to: next ? next.index! : doc.length },
    }
  })
}

export function blockAt(state: any, pos: number): ScratchBlock | undefined {
  return state.field(blockField).find((block: ScratchBlock) => block.range.from <= pos && block.range.to >= pos)
}

export function activeBlock(state: any): ScratchBlock | undefined {
  return blockAt(state, state.selection.main.head)
}

export const blockField = StateField.define<ScratchBlock[]>({
  create(state) {
    return parseBlocks(state.doc)
  },
  update(blocks, transaction) {
    if (transaction.docChanged) {
      return parseBlocks(transaction.state.doc)
    }
    return blocks
  },
})

export const blockDecorations = StateField.define({
  create(state) {
    return buildDecorations(state)
  },
  update(decorations, transaction) {
    if (transaction.docChanged) {
      return buildDecorations(transaction.state)
    }
    return decorations.map(transaction.changes)
  },
  provide(field) {
    return EditorView.decorations.from(field)
  },
})

class BlockGutterMarker extends GutterMarker {
  readonly elementClass: string

  constructor(elementClass: string) {
    super()
    this.elementClass = elementClass
  }

  eq(other: BlockGutterMarker) {
    return this.elementClass === other.elementClass
  }
}

const gutterEven = new BlockGutterMarker('block-gutter-even')
const gutterOdd = new BlockGutterMarker('block-gutter-odd')
const gutterStart = new BlockGutterMarker('block-gutter-start')
const gutterDelimiter = new BlockGutterMarker('block-gutter-delimiter')

export const blockGutterDecorations = StateField.define({
  create(state) {
    return buildGutterDecorations(state)
  },
  update(markers, transaction) {
    if (transaction.docChanged) {
      return buildGutterDecorations(transaction.state)
    }
    return markers.map(transaction.changes)
  },
  provide(field) {
    return gutterLineClass.from(field)
  },
})

function buildDecorations(state: any) {
  const decorations: any[] = []
  const blocks = state.field(blockField) as ScratchBlock[]
  blocks.forEach((block, index) => {
    decorations.push(Decoration.line({ class: 'block-delimiter-line' }).range(block.delimiter.from))
    decorations.push(Decoration.replace({}).range(block.delimiter.from, Math.max(block.delimiter.from, block.delimiter.to - 1)))

    const lines = []
    let line = state.doc.lineAt(block.content.from)
    while (line.to < block.content.from && line.number < state.doc.lines) {
      line = state.doc.line(line.number + 1)
    }
    while (line.from <= block.content.to && line.to >= block.content.from) {
      lines.push(line)
      if (line.to >= block.content.to || line.number >= state.doc.lines) break
      line = state.doc.line(line.number + 1)
    }

    lines.forEach((contentLine, lineIndex) => {
      const classes = [
        index % 2 === 0 ? 'block-even' : 'block-odd',
        lineIndex === 0 ? 'block-first-line' : '',
        lineIndex === 0 && index > 0 ? 'block-start' : '',
        lineIndex === lines.length - 1 ? 'block-last-line' : '',
      ].filter(Boolean).join(' ')
      decorations.push(Decoration.line({ class: classes }).range(contentLine.from))
    })
  })
  return Decoration.set(decorations, true)
}

function buildGutterDecorations(state: any) {
  const builder = new RangeSetBuilder<GutterMarker>()
  const blocks = state.field(blockField) as ScratchBlock[]
  blocks.forEach((block, index) => {
    builder.add(block.delimiter.from, block.delimiter.from, gutterDelimiter)

    let line = state.doc.lineAt(block.content.from)
    while (line.to < block.content.from && line.number < state.doc.lines) {
      line = state.doc.line(line.number + 1)
    }
    let isFirstContentLine = true
    while (line.from <= block.content.to && line.to >= block.content.from) {
      builder.add(line.from, line.from, index % 2 === 0 ? gutterEven : gutterOdd)
      if (isFirstContentLine && index > 0) {
        builder.add(line.from, line.from, gutterStart)
      }
      isFirstContentLine = false
      if (line.to >= block.content.to || line.number >= state.doc.lines) break
      line = state.doc.line(line.number + 1)
    }
  })
  return builder.finish()
}

export const protectDelimiters = EditorView.atomicRanges.of(view => {
  const builder = new RangeSetBuilder<any>()
  for (const block of view.state.field(blockField)) {
    builder.add(block.delimiter.from, block.delimiter.to, {})
  }
  return builder.finish()
})

export const delimiterChangeProtection = EditorState.changeFilter.of((transaction: Transaction) => {
    if (transaction.annotation(internalBlockEdit)) return true
    if (!transaction.docChanged) return true
    const protectedRanges: number[] = []
    for (const block of transaction.startState.field(blockField)) {
      protectedRanges.push(block.delimiter.from, block.delimiter.to)
    }
    return protectedRanges
  })

export const autoDetectPlugin = ViewPlugin.fromClass(
  class {
    update(update: any) {
      if (!update.docChanged) return
      const block = activeBlock(update.state)
      if (!block || !block.auto) return
      const content = update.state.doc.sliceString(block.content.from, block.content.to)
      const detected = detectLanguage(content)
      if (detected !== block.language && detected !== 'text') {
        window.setTimeout(() => {
          const latestBlock = activeBlock(update.view.state)
          if (latestBlock?.auto && latestBlock.language !== detected) {
            replaceBlockLanguage(update.view, latestBlock, detected, true)
          }
        }, 0)
      }
    }
  },
)

export function insertBlock(view: EditorView, language: string, auto = false) {
  view.dispatch(view.state.replaceSelection(blockDelimiter(language, auto)), {
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

function insertBlockAt(view: EditorView, position: number, language: string, auto = false, keepNextDelimiterOnNewLine = false) {
  const delimiter = position === 0 ? blockDelimiter(language, auto).trimStart() : blockDelimiter(language, auto)
  const insert = keepNextDelimiterOnNewLine ? `${delimiter}\n` : delimiter
  view.dispatch({
    changes: { from: position, to: position, insert },
    selection: { anchor: position + delimiter.length },
    annotations: internalBlockEdit.of(true),
    scrollIntoView: true,
  })
  view.focus()
}

export function insertBlockBeforeCurrent(view: EditorView, language: string, auto = false) {
  const block = activeBlock(view.state) || view.state.field(blockField)[0]
  insertBlockAt(view, block?.range.from ?? 0, language, auto, true)
}

export function insertBlockAfterCurrent(view: EditorView, language: string, auto = false) {
  const blocks = view.state.field(blockField)
  const block = activeBlock(view.state) || blocks[blocks.length - 1]
  insertBlockAt(view, block?.range.to ?? view.state.doc.length, language, auto)
}

export function insertBlockAtStart(view: EditorView, language: string, auto = false) {
  insertBlockAt(view, 0, language, auto, true)
}

export function insertBlockAtEnd(view: EditorView, language: string, auto = false) {
  insertBlockAt(view, view.state.doc.length, language, auto)
}

export function splitCurrentBlock(view: EditorView, language: string, auto = false) {
  const block = activeBlock(view.state)
  const selection = view.state.selection.main
  if (!block || selection.from < block.content.from || selection.to > block.content.to) {
    insertBlockAfterCurrent(view, language, auto)
    return
  }
  const delimiter = blockDelimiter(language, auto)
  view.dispatch({
    changes: { from: selection.from, to: selection.to, insert: delimiter },
    selection: { anchor: selection.from + delimiter.length },
    annotations: internalBlockEdit.of(true),
    scrollIntoView: true,
  })
  view.focus()
}

export function replaceBlockLanguage(view: EditorView, block: ScratchBlock, language: string, auto: boolean) {
  const delimiter = blockDelimiter(language, auto, block.created ? new Date(block.created) : new Date()).trimStart()
  view.dispatch({
    changes: { from: block.delimiter.from, to: block.delimiter.to, insert: delimiter },
    annotations: internalBlockEdit.of(true),
  })
}

export function deleteCurrentBlock(view: EditorView) {
  const block = activeBlock(view.state)
  const blocks = view.state.field(blockField)
  if (!block || blocks.length <= 1) return false
  const index = blocks.indexOf(block)
  const fallbackBlock = blocks[Math.min(index + 1, blocks.length - 1)] === block
    ? blocks[Math.max(0, index - 1)]
    : blocks[Math.min(index + 1, blocks.length - 1)]
  const nextPos = fallbackBlock ? fallbackBlock.content.from : Math.max(0, block.range.from - 1)
  view.dispatch({
    changes: { from: block.range.from, to: block.range.to, insert: '' },
    selection: { anchor: nextPos },
    annotations: internalBlockEdit.of(true),
  })
  view.focus()
  return true
}

export function currentBlockText(view: EditorView) {
  const block = activeBlock(view.state)
  if (!block) return ''
  return view.state.doc.sliceString(block.content.from, block.content.to)
}
