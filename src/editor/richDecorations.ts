import { EditorSelection, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { blockField, type ScratchBlock } from './blocks'

export type ActiveImageLine = {
  from: number
  to: number
  edit: boolean
  cursor?: 'left' | 'right'
}

export const setActiveImageLine = StateEffect.define<ActiveImageLine | null>({
  map(value, changes) {
    if (!value) return null
    return {
      ...value,
      from: changes.mapPos(value.from),
      to: changes.mapPos(value.to),
    }
  },
})

export const activeImageLineField = StateField.define<ActiveImageLine | null>({
  create() {
    return null
  },
  update(value, transaction) {
    let next = value
    if (next && transaction.docChanged) {
      next = {
        ...next,
        from: transaction.changes.mapPos(next.from),
        to: transaction.changes.mapPos(next.to),
      }
    }
    for (const effect of transaction.effects) {
      if (effect.is(setActiveImageLine)) {
        next = effect.value
      }
    }
    return next
  },
})

class ImageWidget extends WidgetType {
  private readonly src: string
  private readonly from: number
  private readonly to: number
  private readonly cursor: 'left' | 'right' | null

  constructor(src: string, from: number, to: number, cursor: 'left' | 'right' | null) {
    super()
    this.src = src
    this.from = from
    this.to = to
    this.cursor = cursor
  }

  eq(other: ImageWidget) {
    return this.src === other.src && this.from === other.from && this.to === other.to && this.cursor === other.cursor
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement('span')
    wrap.className = 'image-widget'
    if (this.cursor) {
      wrap.classList.add(`image-widget-cursor-${this.cursor}`)
    }
    wrap.tabIndex = 0
    wrap.role = 'button'
    wrap.title = 'Click to focus image line, double-click to edit Markdown'
    wrap.addEventListener('mousedown', event => {
      event.preventDefault()
      event.stopPropagation()
    })
    wrap.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      const line = view.state.doc.lineAt(this.from)
      view.dispatch({
        selection: EditorSelection.cursor(line.from),
        effects: setActiveImageLine.of({ from: line.from, to: line.to, edit: false }),
        scrollIntoView: true,
      })
      view.focus()
    })
    wrap.addEventListener('dblclick', event => {
      event.preventDefault()
      event.stopPropagation()
      const line = view.state.doc.lineAt(this.from)
      view.dispatch({
        selection: EditorSelection.cursor(this.from),
        effects: setActiveImageLine.of({ from: line.from, to: line.to, edit: true }),
        scrollIntoView: true,
      })
      view.focus()
    })
    const image = document.createElement('img')
    image.src = this.src
    image.alt = 'Pasted image'
    wrap.appendChild(image)
    return wrap
  }
}

class MathResultWidget extends WidgetType {
  private readonly value: string

  constructor(value: string) {
    super()
    this.value = value
  }

  eq(other: MathResultWidget) {
    return this.value === other.value
  }

  toDOM() {
    const element = document.createElement('span')
    element.className = 'math-result'
    element.textContent = ` = ${this.value}`
    return element
  }
}

export const richDecorations = ViewPlugin.fromClass(
  class {
    decorations

    constructor(view: EditorView) {
      this.decorations = buildRichDecorations(view)
    }

    update(update: any) {
      if (update.docChanged || update.selectionSet || hasActiveImageLineEffect(update)) {
        this.decorations = buildRichDecorations(update.view)
      }
    }
  },
  {
    decorations: plugin => plugin.decorations,
  },
)

function hasActiveImageLineEffect(update: any) {
  return update.transactions.some((transaction: any) =>
    transaction.effects.some((effect: any) => effect.is(setActiveImageLine)),
  )
}

function buildRichDecorations(view: EditorView) {
  const decorations: any[] = []
  const { state } = view
  const blocks = state.field(blockField)
  for (const block of blocks) {
    addSyntaxMarks(decorations, state, block)
    addImageWidgets(decorations, state, block)
    addMathResults(decorations, state, block)
  }
  return Decoration.set(decorations, true)
}

function addSyntaxMarks(decorations: any[], state: any, block: ScratchBlock) {
  const content = state.doc.sliceString(block.content.from, block.content.to)
  const patterns = syntaxPatterns(block.language)
  for (const [className, pattern] of patterns) {
    for (const match of content.matchAll(pattern)) {
      const from = block.content.from + match.index!
      const to = from + match[0].length
      decorations.push(Decoration.mark({ class: className }).range(from, to))
    }
  }
}

function syntaxPatterns(language: string): Array<[string, RegExp]> {
  if (language === 'json') {
    return [
      ['tok-key', /"[^"\n]+(?="\s*:)/g],
      ['tok-string', /"([^"\\]|\\.)*"/g],
      ['tok-number', /\b-?\d+(?:\.\d+)?\b/g],
      ['tok-keyword', /\b(true|false|null)\b/g],
    ]
  }
  if (['javascript', 'typescript'].includes(language)) {
    return [
      ['tok-keyword', /\b(const|let|var|function|return|import|export|from|async|await|if|else|class|new)\b/g],
      ['tok-string', /(['"`])(?:\\.|(?!\1).)*\1/g],
      ['tok-number', /\b\d+(?:\.\d+)?\b/g],
      ['tok-comment', /\/\/.*$/gm],
    ]
  }
  if (language === 'markdown') {
    return [
      ['tok-heading', /^#{1,6}\s.+$/gm],
      ['tok-keyword', /`[^`\n]+`/g],
      ['tok-string', /\*\*[^*\n]+\*\*/g],
    ]
  }
  if (language === 'sql') {
    return [
      ['tok-keyword', /\b(select|from|where|join|left|right|inner|group|by|order|insert|update|delete|with|as|on|and|or)\b/gi],
      ['tok-string', /'[^'\n]*'/g],
      ['tok-number', /\b\d+(?:\.\d+)?\b/g],
    ]
  }
  if (language === 'python') {
    return [
      ['tok-keyword', /\b(def|class|import|from|return|if|else|elif|for|while|in|with|as|None|True|False)\b/g],
      ['tok-string', /(['"])(?:\\.|(?!\1).)*\1/g],
      ['tok-comment', /#.*$/gm],
    ]
  }
  return []
}

function addImageWidgets(decorations: any[], state: any, block: ScratchBlock) {
  const content = state.doc.sliceString(block.content.from, block.content.to)
  const imagePattern = /!\[[^\]]*]\((<([^>]+)>|([^)]+))\)/g
  for (const match of content.matchAll(imagePattern)) {
    const imageUrl = (match[2] || match[3] || '').trim()
    const src = imagePreviewSource(imageUrl)
    if (!src) continue
    const from = block.content.from + match.index!
    const to = from + match[0].length
    if (activeImageIsBeingEdited(state, from, to)) continue
    decorations.push(Decoration.replace({ widget: new ImageWidget(src, from, to, activeImageCursor(state, from, to)) }).range(from, to))
  }
}

function activeImageIsBeingEdited(state: any, from: number, to: number) {
  const active = state.field(activeImageLineField, false)
  return Boolean(active?.edit && active.from <= from && active.to >= to)
}

function activeImageCursor(state: any, from: number, to: number) {
  const active = state.field(activeImageLineField, false)
  if (!active?.cursor || active.edit) return null
  return active.from <= from && active.to >= to ? active.cursor : null
}

function imagePreviewSource(url: string) {
  if (url.startsWith('vibenote-image://') || url.startsWith('file://') || /^https?:\/\//i.test(url)) {
    return url
  }
  if (url.startsWith('/')) {
    return `file://${encodeURI(url)}`
  }
  return ''
}

function addMathResults(decorations: any[], state: any, block: ScratchBlock) {
  if (block.language !== 'math') return
  const content = state.doc.sliceString(block.content.from, block.content.to)
  let offset = 0
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (trimmed && /^[\d+\-*/().\s]+$/.test(trimmed)) {
      try {
        const value = Function(`"use strict"; return (${trimmed})`)()
        const lineEnd = block.content.from + offset + line.length
        decorations.push(Decoration.widget({ widget: new MathResultWidget(String(value)), side: 1 }).range(lineEnd))
      } catch {
        // Invalid expressions stay as plain text.
      }
    }
    offset += line.length + 1
  }
}
