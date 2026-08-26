import { Annotation, EditorState, RangeSetBuilder, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutterLineClass } from '@codemirror/view'
import { blockDelimiter } from '../common/noteFormat'
import { detectLanguage } from '../common/languages'

export type ScratchBlock = {
  id?: string
  language: string
  auto: boolean
  created?: string
  fields: Record<string, string>
  delimiter: { from: number; to: number }
  content: { from: number; to: number }
  range: { from: number; to: number }
}

export const delimiterPattern = /(^|\n)---block:([^\n]+)\n/g
export const internalBlockEdit = Annotation.define<boolean>()
export type MarkdownBlockPreviewState = {
  anchor: number
  visualOffset: number
}

export type MarkdownBlockPreviewRequest = {
  anchor: number
  enabled: boolean
  visualOffset?: number
}

export const setMarkdownBlockPreview = StateEffect.define<MarkdownBlockPreviewRequest>({
  map(value, changes) {
    return { ...value, anchor: changes.mapPos(value.anchor, 1) }
  },
})
export type FoldedBlockState = { anchor: number, resumeOffset: number }
export const setBlockFold = StateEffect.define<{ anchor: number, folded: boolean, resumeOffset?: number }>({
  map(value, changes) {
    return { ...value, anchor: changes.mapPos(value.anchor, 1) }
  },
})
export const replaceBlockFolds = StateEffect.define<readonly FoldedBlockState[]>({
  map(value, changes) {
    return value.map(entry => ({ ...entry, anchor: changes.mapPos(entry.anchor, 1) }))
  },
})

export function parseBlocks(doc: { length: number; sliceString(from: number, to?: number): string }): ScratchBlock[] {
  const text = doc.sliceString(0, doc.length)
  const matches = [...text.matchAll(delimiterPattern)]
  if (matches.length === 0) {
    return []
  }
  return matches.map((match, index) => {
    const next = matches[index + 1]
    const [language, ...segments] = match[2].split(';')
    const fields = Object.fromEntries(segments.map(segment => {
      const equals = segment.indexOf('=')
      return equals > 0 ? [segment.slice(0, equals), segment.slice(equals + 1)] : [segment, '']
    }))
    const delimiterFrom = match.index! + (match[1] === '\n' ? 1 : 0)
    const delimiterTo = match.index! + match[0].length
    return {
      id: fields.id,
      language,
      auto: fields.auto === '1',
      created: fields.created,
      fields,
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

export const foldedBlockField = StateField.define<readonly FoldedBlockState[]>({
  create() {
    return []
  },
  update(entries, transaction) {
    const hasFoldEffect = transaction.effects.some(effect =>
      effect.is(setBlockFold) || effect.is(replaceBlockFolds) || effect.is(setMarkdownBlockPreview),
    )
    if (!transaction.docChanged && !hasFoldEffect) return entries

    const replacement = transaction.effects.find(effect => effect.is(replaceBlockFolds))
    const mapped = replacement
      ? [...replacement.value]
      : entries.map(entry => ({
          ...entry,
          anchor: transaction.docChanged ? transaction.changes.mapPos(entry.anchor, 1) : entry.anchor,
        }))
    const blockStarts = new Set(parseBlocks(transaction.newDoc).map(block => block.content.from))
    const next = new Map(
      mapped
        .filter(entry => blockStarts.has(entry.anchor))
        .map(entry => [entry.anchor, entry]),
    )

    for (const effect of transaction.effects) {
      if (effect.is(setBlockFold)) {
        if (effect.value.folded && blockStarts.has(effect.value.anchor)) {
          next.set(effect.value.anchor, {
            anchor: effect.value.anchor,
            resumeOffset: Math.max(0, effect.value.resumeOffset ?? 0),
          })
        } else {
          next.delete(effect.value.anchor)
        }
      }
      if (effect.is(setMarkdownBlockPreview) && effect.value.enabled) {
        next.delete(effect.value.anchor)
      }
    }

    return [...next.values()].sort((left, right) => left.anchor - right.anchor)
  },
})

export function isBlockFolded(state: any, block: ScratchBlock) {
  return state.field(foldedBlockField, false)?.some((entry: FoldedBlockState) => entry.anchor === block.content.from) ?? false
}

export function foldedBlockResumeOffset(state: any, block: ScratchBlock) {
  return state.field(foldedBlockField, false)
    ?.find((entry: FoldedBlockState) => entry.anchor === block.content.from)
    ?.resumeOffset ?? 0
}

export const markdownBlockPreviewField = StateField.define<readonly MarkdownBlockPreviewState[]>({
  create() {
    return []
  },
  update(entries, transaction) {
    const previewEffects = transaction.effects.filter(effect => effect.is(setMarkdownBlockPreview))
    if (!transaction.docChanged && previewEffects.length === 0) return entries
    const candidates = new Map<MarkdownBlockPreviewState, number[]>()
    for (const entry of entries) {
      candidates.set(entry, transaction.docChanged
        ? [transaction.changes.mapPos(entry.anchor, -1), transaction.changes.mapPos(entry.anchor, 1)]
        : [entry.anchor])
    }

    const requested = new Map<number, MarkdownBlockPreviewRequest>()
    for (const effect of previewEffects) {
      requested.set(effect.value.anchor, effect.value)
    }

    const markdownStarts = new Set(
      parseBlocks(transaction.newDoc)
        .filter(block => block.language === 'markdown')
        .map(block => block.content.from),
    )
    const next = new Map<number, MarkdownBlockPreviewState>()
    for (const [entry, positions] of candidates) {
      const match = positions.find(position => markdownStarts.has(position))
      if (match !== undefined) next.set(match, { ...entry, anchor: match })
    }
    for (const [anchor, request] of requested) {
      if (request.enabled && markdownStarts.has(anchor)) {
        next.set(anchor, {
          anchor,
          visualOffset: Math.max(0, request.visualOffset ?? 0),
        })
      }
      else next.delete(anchor)
    }
    for (const effect of transaction.effects) {
      if (effect.is(setBlockFold) && effect.value.folded) next.delete(effect.value.anchor)
      if (effect.is(replaceBlockFolds)) {
        for (const entry of effect.value) next.delete(entry.anchor)
      }
    }
    return [...next.values()].sort((left, right) => left.anchor - right.anchor)
  },
})

export function isMarkdownBlockPreviewed(state: any, block: ScratchBlock) {
  return state.field(markdownBlockPreviewField, false)
    ?.some((entry: MarkdownBlockPreviewState) => entry.anchor === block.content.from) ?? false
}

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

export const markdownBlockPreviewChangeProtection = EditorState.changeFilter.of((transaction: Transaction) => {
  if (transaction.annotation(internalBlockEdit) || !transaction.docChanged) return true
  const protectedBlocks = transaction.startState.field(blockField)
    .filter(block => isMarkdownBlockPreviewed(transaction.startState, block))
  if (protectedBlocks.length === 0) return true
  const startsInsidePreview = transaction.startState.selection.ranges.some(range =>
    protectedBlocks.some(block =>
      range.from >= block.content.from && range.to <= block.content.to,
    ),
  )
  if (startsInsidePreview) return false

  let intersectsPreview = false
  transaction.changes.iterChanges((fromA, toA) => {
    if (intersectsPreview) return
    intersectsPreview = protectedBlocks.some(block => (
      fromA === toA
        ? fromA >= block.content.from && fromA <= block.content.to
        : fromA < block.content.to && toA > block.content.from
    ))
  })
  return !intersectsPreview
})

export const foldedBlockChangeProtection = EditorState.changeFilter.of((transaction: Transaction) => {
  if (transaction.annotation(internalBlockEdit) || !transaction.docChanged) return true
  const protectedBlocks = transaction.startState.field(blockField)
    .filter(block => isBlockFolded(transaction.startState, block))
  if (protectedBlocks.length === 0) return true

  let intersectsFold = false
  transaction.changes.iterChanges((fromA, toA) => {
    if (intersectsFold) return
    intersectsFold = protectedBlocks.some(block => (
      fromA === toA
        ? fromA >= block.content.from && fromA <= block.content.to
        : fromA < block.content.to && toA > block.content.from
    ))
  })
  return !intersectsFold
})

export const autoDetectPlugin = ViewPlugin.fromClass(
  class {
    update(update: any) {
      if (!update.docChanged) return
      const block = activeBlock(update.state)
      if (!block || !block.auto || isMarkdownBlockPreviewed(update.state, block) || isBlockFolded(update.state, block)) return
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

export function insertBlockAfterCurrent(view: EditorView, language: string, auto = false, target?: ScratchBlock) {
  const blocks = view.state.field(blockField)
  const block = target || activeBlock(view.state) || blocks[blocks.length - 1]
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
  const delimiter = blockDelimiter(language, auto, block.created ? new Date(block.created) : new Date(), block.fields).trimStart()
  view.dispatch({
    changes: { from: block.delimiter.from, to: block.delimiter.to, insert: delimiter },
    annotations: internalBlockEdit.of(true),
  })
}

export function deleteCurrentBlock(view: EditorView, target?: ScratchBlock) {
  const block = target || activeBlock(view.state)
  const blocks = view.state.field(blockField)
  if (!block || blocks.length <= 1) return false
  const index = blocks.indexOf(block)
  const fallbackBlock = blocks[Math.min(index + 1, blocks.length - 1)] === block
    ? blocks[Math.max(0, index - 1)]
    : blocks[Math.min(index + 1, blocks.length - 1)]
  const deleteLength = block.range.to - block.range.from
  const nextPos = fallbackBlock
    ? fallbackBlock.range.from > block.range.from
      ? Math.max(block.range.from, fallbackBlock.content.from - deleteLength)
      : Math.max(fallbackBlock.content.from, Math.min(fallbackBlock.content.to, block.range.from - 1))
    : Math.max(0, block.range.from - 1)
  view.dispatch({
    changes: { from: block.range.from, to: block.range.to, insert: '' },
    selection: { anchor: nextPos },
    annotations: internalBlockEdit.of(true),
  })
  view.focus()
  return true
}

export function currentBlockText(view: EditorView, target?: ScratchBlock) {
  const block = target || activeBlock(view.state)
  if (!block) return ''
  return view.state.doc.sliceString(block.content.from, block.content.to)
}
