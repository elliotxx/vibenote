import { markdownLanguage } from '@codemirror/lang-markdown'
import type { Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'
import {
  blockField,
  foldedBlockField,
  isBlockFolded,
  isMarkdownBlockPreviewed,
  markdownBlockPreviewField,
} from './blocks'

type StrongRange = {
  from: number
  to: number
  openFrom: number
  openTo: number
  contentFrom: number
  contentTo: number
  closeFrom: number
  closeTo: number
}

class MarkdownStrongPreviewPlugin {
  private ranges: StrongRange[]
  decorations: DecorationSet
  atomicRanges: DecorationSet

  constructor(view: EditorView) {
    this.ranges = parseStrongRanges(view)
    const presentation = buildPresentation(view, this.ranges)
    this.decorations = presentation.decorations
    this.atomicRanges = presentation.atomicRanges
  }

  update(update: ViewUpdate) {
    const presentationChanged =
      update.startState.field(blockField) !== update.state.field(blockField) ||
      update.startState.field(foldedBlockField) !== update.state.field(foldedBlockField) ||
      update.startState.field(markdownBlockPreviewField) !== update.state.field(markdownBlockPreviewField)

    if (update.docChanged || presentationChanged) {
      this.ranges = parseStrongRanges(update.view)
    }
    if (update.docChanged || update.selectionSet || presentationChanged) {
      const presentation = buildPresentation(update.view, this.ranges)
      this.decorations = presentation.decorations
      this.atomicRanges = presentation.atomicRanges
    }
  }
}

export const markdownStrongPreview = ViewPlugin.fromClass(
  MarkdownStrongPreviewPlugin,
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of(
        (view) => view.plugin(plugin)?.atomicRanges ?? Decoration.none,
      ),
  },
)

function parseStrongRanges(view: EditorView): StrongRange[] {
  const ranges: StrongRange[] = []

  for (const block of view.state.field(blockField)) {
    if (block.language !== 'markdown' || isMarkdownBlockPreviewed(view.state, block) || isBlockFolded(view.state, block)) continue

    const content = view.state.doc.sliceString(
      block.content.from,
      block.content.to,
    )
    const tree = markdownLanguage.parser.parse(content)
    const cursor = tree.cursor()

    do {
      if (cursor.name !== 'StrongEmphasis') continue

      // CommonMark parses the inner ** pair of ***text*** as StrongEmphasis.
      // Leave the whole construct visible rather than producing a partial preview.
      if (content[cursor.from - 1] === '*' || content[cursor.to] === '*')
        continue

      const marks: Array<{ from: number; to: number }> = []
      if (cursor.firstChild()) {
        do {
          const childName: string = cursor.name
          if (childName === 'EmphasisMark') {
            marks.push({ from: cursor.from, to: cursor.to })
          }
        } while (cursor.nextSibling())
        cursor.parent()
      }

      if (
        marks.length !== 2 ||
        marks[0].to - marks[0].from !== 2 ||
        marks[1].to - marks[1].from !== 2 ||
        content.slice(marks[0].from, marks[0].to) !== '**' ||
        content.slice(marks[1].from, marks[1].to) !== '**'
      ) {
        continue
      }

      const offset = block.content.from
      ranges.push({
        from: offset + cursor.from,
        to: offset + cursor.to,
        openFrom: offset + marks[0].from,
        openTo: offset + marks[0].to,
        contentFrom: offset + marks[0].to,
        contentTo: offset + marks[1].from,
        closeFrom: offset + marks[1].from,
        closeTo: offset + marks[1].to,
      })
    } while (cursor.next())
  }

  return ranges
}

function buildPresentation(view: EditorView, ranges: StrongRange[]) {
  const decorations: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []

  for (const range of ranges) {
    decorations.push(
      Decoration.mark({ class: 'tok-strong' }).range(
        range.contentFrom,
        range.contentTo,
      ),
    )

    if (isActive(view, range)) {
      decorations.push(
        Decoration.mark({ class: 'tok-strong-marker' }).range(
          range.openFrom,
          range.openTo,
        ),
      )
      decorations.push(
        Decoration.mark({ class: 'tok-strong-marker' }).range(
          range.closeFrom,
          range.closeTo,
        ),
      )
      continue
    }

    const open = Decoration.replace({}).range(range.openFrom, range.openTo)
    const close = Decoration.replace({}).range(range.closeFrom, range.closeTo)
    decorations.push(open, close)
    atomicRanges.push(open, close)
  }

  return {
    decorations: Decoration.set(decorations, true),
    atomicRanges: Decoration.set(atomicRanges, true),
  }
}

function isActive(view: EditorView, range: StrongRange) {
  return view.state.selection.ranges.some((selection) => {
    if (selection.empty)
      return selection.head >= range.from && selection.head < range.to
    return selection.from < range.to && selection.to > range.from
  })
}
