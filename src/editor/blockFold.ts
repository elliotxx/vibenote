import { EditorSelection, EditorState, RangeSetBuilder, StateField, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  lineNumberMarkers,
  lineNumberWidgetMarker,
  type DecorationSet,
} from '@codemirror/view'
import {
  blockField,
  foldedBlockField,
  foldedBlockResumeOffset,
  isBlockFolded,
  isMarkdownBlockPreviewed,
  markdownBlockPreviewField,
  setBlockFold,
  setMarkdownBlockPreview,
  type ScratchBlock,
} from './blocks'

function blockFromAnchor(view: EditorView, anchor: number) {
  return view.state.field(blockField).find(block => block.content.from === anchor)
}

function languageLabel(language: string) {
  if (language === 'markdown') return 'Markdown'
  if (language === 'text') return 'Text'
  if (language === 'javascript') return 'JavaScript'
  if (language === 'typescript') return 'TypeScript'
  return language.toUpperCase()
}

function summarizeSource(source: string, language: string) {
  const first = source.split(/\r?\n/u).find(line => line.trim())?.trim() ?? ''
  const clean = first
    .replace(/^#{1,6}\s+/u, '')
    .replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/u, '')
    .replace(/^>\s*/u, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/[*_~`]+/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  const fallback = `空白 ${languageLabel(language)} Block`
  return (clean || fallback).slice(0, 120)
}

function sourceLineCount(source: string) {
  return source.length === 0 ? 0 : source.split(/\r?\n/u).length
}

function blockToneClass(index: number) {
  return index % 2 === 0 ? 'block-even' : 'block-odd'
}

function disclosureSvg(folded: boolean) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('width', '14')
  svg.setAttribute('height', '14')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', folded ? 'M6 3.5 10.5 8 6 12.5' : 'm3.5 6 4.5 4.5L12.5 6')
  path.setAttribute('fill', 'none')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-width', '1.7')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  svg.appendChild(path)
  return svg
}

export function expandBlock(view: EditorView, block: ScratchBlock) {
  if (!isBlockFolded(view.state, block)) return false
  const offset = foldedBlockResumeOffset(view.state, block)
  const target = Math.min(block.content.to, block.content.from + offset)
  view.dispatch({
    effects: setBlockFold.of({ anchor: block.content.from, folded: false }),
    selection: EditorSelection.cursor(target),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

export function toggleBlockFold(view: EditorView, target?: ScratchBlock) {
  const block = target || view.state.field(blockField)
    .find(candidate => candidate.range.from <= view.state.selection.main.head && candidate.range.to >= view.state.selection.main.head)
  if (!block) return false
  if (isBlockFolded(view.state, block)) return expandBlock(view, block)

  const selection = view.state.selection.main
  const resumeOffset = selection.head >= block.content.from && selection.head <= block.content.to
    ? selection.head - block.content.from
    : 0
  view.dispatch({
    effects: [
      setMarkdownBlockPreview.of({ anchor: block.content.from, enabled: false }),
      setBlockFold.of({ anchor: block.content.from, folded: true, resumeOffset }),
    ],
    selection: EditorSelection.cursor(block.content.from),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

class BlockFoldGutterMarker extends GutterMarker {
  readonly elementClass: string
  private readonly anchor: number
  private readonly folded: boolean
  private readonly summary: string

  constructor(
    anchor: number,
    folded: boolean,
    summary: string,
    toneClass: string,
    isStart: boolean,
  ) {
    super()
    this.anchor = anchor
    this.folded = folded
    this.summary = summary
    this.elementClass = [
      'block-fold-gutter',
      toneClass === 'block-even' ? 'block-gutter-even' : 'block-gutter-odd',
      isStart ? 'block-gutter-start' : '',
    ].filter(Boolean).join(' ')
  }

  eq(other: BlockFoldGutterMarker) {
    return this.anchor === other.anchor
      && this.folded === other.folded
      && this.summary === other.summary
      && this.elementClass === other.elementClass
  }

  toDOM(view: EditorView) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `block-fold-toggle${this.folded ? ' is-folded' : ''}`
    button.dataset.contentAnchor = String(this.anchor)
    button.setAttribute('aria-expanded', String(!this.folded))
    button.setAttribute('aria-label', `${this.folded ? '展开' : '折叠'} Block：${this.summary}`)
    button.title = this.folded ? '展开此块' : '折叠此块'

    const number = document.createElement('span')
    number.className = 'block-fold-line-number'
    number.textContent = '1'
    const chevron = document.createElement('span')
    chevron.className = 'block-fold-chevron'
    chevron.appendChild(disclosureSvg(this.folded))
    button.append(number, chevron)

    button.addEventListener('mousedown', event => event.stopPropagation())
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const block = blockFromAnchor(view, this.anchor)
      if (block) toggleBlockFold(view, block)
    })
    return button
  }
}

class CollapsedBlockWidget extends WidgetType {
  readonly anchor: number
  private readonly source: string
  private readonly language: string
  private readonly toneClass: string
  private readonly isStart: boolean

  constructor(
    anchor: number,
    source: string,
    language: string,
    toneClass: string,
    isStart: boolean,
  ) {
    super()
    this.anchor = anchor
    this.source = source
    this.language = language
    this.toneClass = toneClass
    this.isStart = isStart
  }

  eq(other: CollapsedBlockWidget) {
    return this.anchor === other.anchor
      && this.source === other.source
      && this.language === other.language
      && this.toneClass === other.toneClass
      && this.isStart === other.isStart
  }

  summary() {
    return summarizeSource(this.source, this.language)
  }

  gutterMarker() {
    return new BlockFoldGutterMarker(
      this.anchor,
      true,
      this.summary(),
      this.toneClass,
      this.isStart,
    )
  }

  toDOM(view: EditorView) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = ['block-fold-summary', this.toneClass, this.isStart ? 'block-start' : '']
      .filter(Boolean)
      .join(' ')
    button.dataset.contentAnchor = String(this.anchor)
    button.setAttribute('aria-label', `展开 Block：${this.summary()}`)

    const summary = document.createElement('span')
    summary.className = 'block-fold-summary-text'
    summary.textContent = this.summary()
    const metadata = document.createElement('span')
    metadata.className = 'block-fold-summary-meta'
    metadata.textContent = `${languageLabel(this.language)} · ${sourceLineCount(this.source)} 行`
    button.append(summary, metadata)

    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const block = blockFromAnchor(view, this.anchor)
      if (block) expandBlock(view, block)
    })
    return button
  }
}

export const blockFoldDecorations = StateField.define<DecorationSet>({
  create(state) {
    return buildFoldDecorations(state)
  },
  update(decorations, transaction) {
    if (
      transaction.docChanged
      || transaction.startState.field(foldedBlockField) !== transaction.state.field(foldedBlockField)
      || transaction.startState.field(markdownBlockPreviewField) !== transaction.state.field(markdownBlockPreviewField)
    ) {
      return buildFoldDecorations(transaction.state)
    }
    return decorations
  },
  provide(field) {
    return EditorView.decorations.from(field)
  },
})

function buildFoldDecorations(state: EditorState) {
  const decorations: Range<Decoration>[] = []
  state.field(blockField).forEach((block, index) => {
    if (!isBlockFolded(state, block)) return
    const source = state.doc.sliceString(block.content.from, block.content.to)
    const widget = new CollapsedBlockWidget(
      block.content.from,
      source,
      block.language,
      blockToneClass(index),
      index > 0,
    )
    if (block.content.from === block.content.to) {
      decorations.push(Decoration.widget({ widget, block: true, side: 1 }).range(block.content.from))
    } else {
      decorations.push(Decoration.replace({ widget, block: true }).range(block.content.from, block.content.to))
    }
  })
  return Decoration.set(decorations, true)
}

export const blockFoldLineNumberMarkers = StateField.define({
  create(state) {
    return buildFoldLineNumberMarkers(state)
  },
  update(markers, transaction) {
    if (
      transaction.docChanged
      || transaction.startState.field(foldedBlockField) !== transaction.state.field(foldedBlockField)
      || transaction.startState.field(markdownBlockPreviewField) !== transaction.state.field(markdownBlockPreviewField)
    ) {
      return buildFoldLineNumberMarkers(transaction.state)
    }
    return markers
  },
  provide(field) {
    return lineNumberMarkers.from(field)
  },
})

function buildFoldLineNumberMarkers(state: EditorState) {
  const builder = new RangeSetBuilder<GutterMarker>()
  state.field(blockField).forEach((block, index) => {
    if (isMarkdownBlockPreviewed(state, block)) return
    const line = state.doc.lineAt(block.content.from)
    const source = state.doc.sliceString(block.content.from, block.content.to)
    builder.add(
      line.from,
      line.from,
      new BlockFoldGutterMarker(
        block.content.from,
        isBlockFolded(state, block),
        summarizeSource(source, block.language),
        blockToneClass(index),
        index > 0,
      ),
    )
  })
  return builder.finish()
}

export const blockFoldWidgetLineNumberMarker = lineNumberWidgetMarker.of((_view, widget) => (
  widget instanceof CollapsedBlockWidget ? widget.gutterMarker() : null
))
