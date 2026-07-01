import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { blockField, type ScratchBlock } from './blocks'

class ImageWidget extends WidgetType {
  private readonly url: string

  constructor(url: string) {
    super()
    this.url = url
  }

  eq(other: ImageWidget) {
    return this.url === other.url
  }

  toDOM() {
    const wrap = document.createElement('span')
    wrap.className = 'image-widget'
    const image = document.createElement('img')
    image.src = this.url
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

export const richDecorations = EditorView.decorations.compute([blockField], state => {
  const decorations: any[] = []
  const blocks = state.field(blockField)
  for (const block of blocks) {
    addSyntaxMarks(decorations, state, block)
    addImageWidgets(decorations, state, block)
    addMathResults(decorations, state, block)
  }
  return Decoration.set(decorations, true)
})

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
  const imagePattern = /!\[[^\]]*]\((vibenote-image:\/\/[^)]+)\)/g
  for (const match of content.matchAll(imagePattern)) {
    const from = block.content.from + match.index!
    const to = from + match[0].length
    decorations.push(Decoration.replace({ widget: new ImageWidget(match[1]) }).range(from, to))
  }
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
