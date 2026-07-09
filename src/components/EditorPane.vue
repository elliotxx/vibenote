<script setup lang="ts">
import { EditorSelection, EditorState } from '@codemirror/state'
import { addCursorAbove, addCursorBelow, defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { lineNumbers, keymap, drawSelection, highlightActiveLine, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { searchKeymap } from '@codemirror/search'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AlignLeft, Copy, FilePlus2, ListTodo, Settings, Sparkles, Trash2, X } from 'lucide-vue-next'
import * as prettier from 'prettier/standalone'
import { blockDelimiter, loadNote, serializeNote, type LoadedNote } from '../common/noteFormat'
import { getLanguage, languages } from '../common/languages'
import {
  activeBlock,
  autoDetectPlugin,
  blockDecorations,
  blockField,
  blockGutterDecorations,
  currentBlockText,
  deleteCurrentBlock,
  delimiterChangeProtection,
  insertBlockAtEnd,
  insertBlockAtStart,
  insertBlockAfterCurrent,
  insertBlockBeforeCurrent,
  internalBlockEdit,
  protectDelimiters,
  replaceBlockLanguage,
  splitCurrentBlock,
  type ScratchBlock,
} from '../editor/blocks'
import { activeImageLineField, richDecorations, setActiveImageLine } from '../editor/richDecorations'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const emit = defineEmits<{
  (event: 'open-settings'): void
}>()
const editorHost = ref<HTMLElement | null>(null)
const languageSelect = ref<HTMLSelectElement | null>(null)
const currentBlock = ref<ScratchBlock | null>(null)
const cursorLabel = ref('1:1')
const saving = ref(false)
const aiBusy = ref(false)
const aiStatus = ref('')
const blockToolbar = ref({ visible: false, top: 0 })
const aiSuggestion = ref<{
  sourceText: string
  content: string
  from: number
  to: number
  scope: 'selection' | 'block'
  top: number
  left: number
} | null>(null)
type AiDiffSegment = { text: string; changed: boolean }
type AiDiffLine = { key: string; segments: AiDiffSegment[]; changed: boolean }
type AiSuggestionDiff = { sourceLines: AiDiffLine[]; targetLines: AiDiffLine[]; changed: boolean }
type AiDiffToken = { text: string; changed: boolean }

const aiSuggestionDiff = computed<AiSuggestionDiff | null>(() => {
  if (!aiSuggestion.value) return null
  return buildAiSuggestionDiff(aiSuggestion.value.sourceText, aiSuggestion.value.content)
})
let view: EditorView | null = null
let note: LoadedNote | null = null
let saveTimer: number | null = null
let aiStatusTimer: number | null = null
let blockToolbarFrame: number | null = null
let editorScrollElement: HTMLElement | null = null
let unsubscribeEditorCommand: (() => void) | null = null
let editorBufferPath: string | null = null
const EDITOR_FONT_MIN = 11
const EDITOR_FONT_MAX = 48
const EDITOR_FONT_DEFAULT = 13
const AI_POPOVER_MIN_WIDTH = 560
const AI_POPOVER_WIDTH_FACTOR = 36

const activeLanguage = computed({
  get: () => currentBlock.value?.language || store.settings.defaultLanguage,
  set: value => {
    if (view && currentBlock.value) {
      replaceBlockLanguage(view, currentBlock.value, value, currentBlock.value.auto)
      updateStatus(view)
      scheduleSave()
    }
  },
})

const autoMode = computed({
  get: () => Boolean(currentBlock.value?.auto),
  set: value => {
    if (view && currentBlock.value) {
      replaceBlockLanguage(view, currentBlock.value, currentBlock.value.language, value)
      updateStatus(view)
      scheduleSave()
    }
  },
})

const canFormatCurrentBlock = computed(() => {
  if (!currentBlock.value || currentBlock.value.language === 'math') return false
  return Boolean(getLanguage(currentBlock.value.language).prettier)
})

const cursorStatus = computed(() => {
  const [line = '1', column = '1'] = cursorLabel.value.split(':')
  return `${line}:${column}`
})

const recoveryStatus = computed(() => {
  const count = store.recoveries.length
  if (count === 0) return ''
  return count === 1 ? '发现可恢复草稿' : `发现 ${count} 个可恢复草稿`
})
const currentRecovery = computed(() => store.recoveries.find(item => item.identifier === store.currentPath) || null)
const statusMessage = computed(() => saving.value ? '正在保存...' : aiStatus.value || recoveryStatus.value)
const statusTone = computed(() => {
  const message = statusMessage.value
  if (!message) return ''
  return message.includes('失败') || message.includes('错误') || message.includes('required') ? 'error' : 'info'
})

onMounted(() => {
  mountEditor()
  unsubscribeEditorCommand = window.vibenote.commands.onEditorCommand(onEditorCommand)
  window.addEventListener('vibenote:goto-line', onGotoLine as EventListener)
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('resize', onWindowResize)
  window.addEventListener('beforeunload', flushSaveSync)
  window.addEventListener('pagehide', flushSaveSync)
})

onBeforeUnmount(() => {
  flushSaveSync()
  if (aiStatusTimer) window.clearTimeout(aiStatusTimer)
  if (blockToolbarFrame) window.cancelAnimationFrame(blockToolbarFrame)
  editorScrollElement?.removeEventListener('scroll', onEditorScroll)
  editorScrollElement = null
  unsubscribeEditorCommand?.()
  unsubscribeEditorCommand = null
  window.removeEventListener('vibenote:goto-line', onGotoLine as EventListener)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('resize', onWindowResize)
  window.removeEventListener('beforeunload', flushSaveSync)
  window.removeEventListener('pagehide', flushSaveSync)
  view?.destroy()
  view = null
})

function setAiStatus(message: string, autoClear = false) {
  if (aiStatusTimer) {
    window.clearTimeout(aiStatusTimer)
    aiStatusTimer = null
  }
  aiStatus.value = message
  if (autoClear && message) {
    aiStatusTimer = window.setTimeout(() => {
      if (aiStatus.value === message) aiStatus.value = ''
      aiStatusTimer = null
    }, 2800)
  }
}

function dismissAiSuggestion() {
  aiSuggestion.value = null
}

function toggleAutoMode() {
  autoMode.value = !autoMode.value
}

watch(
  () => [store.settings.fontSize, store.settings.tabSize, store.settings.theme],
  () => {
    applyEditorViewSettings(view)
  },
)

function applyEditorViewSettings(editor: EditorView | null) {
  if (!editor) return
  editor.dom.style.setProperty('--editor-font-size', `${store.settings.fontSize}px`)
  editorHost.value?.style.setProperty('--editor-font-size', `${store.settings.fontSize}px`)
  editor.dom.classList.toggle('dark-editor', store.settings.theme === 'dark')
  editor.requestMeasure()
  window.requestAnimationFrame(() => {
    if (editor === view) editor.requestMeasure()
  })
}

const selectionRightFill = ViewPlugin.fromClass(class {
  readonly view: EditorView
  private layer: HTMLElement
  private frame = 0
  private scroller: HTMLElement | null = null
  private onScroll = () => this.schedule()

  constructor(view: EditorView) {
    this.view = view
    this.layer = document.createElement('div')
    this.layer.className = 'selection-right-fill-layer'
    this.view.dom.appendChild(this.layer)
    this.scroller = this.view.dom.querySelector<HTMLElement>('.cm-scroller')
    this.scroller?.addEventListener('scroll', this.onScroll, { passive: true })
    this.schedule()
  }

  update(update: ViewUpdate) {
    if (
      update.selectionSet ||
      update.docChanged ||
      update.viewportChanged ||
      update.geometryChanged
    ) {
      this.schedule()
    }
  }

  destroy() {
    if (this.frame) window.cancelAnimationFrame(this.frame)
    this.scroller?.removeEventListener('scroll', this.onScroll)
    this.layer.remove()
  }

  private schedule() {
    if (this.frame) window.cancelAnimationFrame(this.frame)
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0
      this.render()
    })
  }

  private render() {
    this.layer.replaceChildren()
    if (!this.hasMultilineSelection()) return

    const scroller = this.view.dom.querySelector<HTMLElement>('.cm-scroller')
    if (!scroller) return

    const editorRect = this.view.dom.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    const rightEdge = scrollerRect.left + scroller.clientWidth
    const backgrounds = Array.from(this.view.dom.querySelectorAll<HTMLElement>('.cm-selectionBackground'))

    for (const background of backgrounds) {
      const rect = background.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0 || rect.right >= rightEdge - 1) continue
      if (rect.bottom <= scrollerRect.top || rect.top >= scrollerRect.bottom) continue

      const fill = document.createElement('div')
      fill.className = 'selection-right-fill'
      fill.style.left = `${rect.right - editorRect.left}px`
      fill.style.top = `${rect.top - editorRect.top}px`
      fill.style.width = `${Math.max(0, rightEdge - rect.right)}px`
      fill.style.height = `${rect.height}px`
      this.layer.appendChild(fill)
    }
  }

  private hasMultilineSelection() {
    return this.view.state.selection.ranges.some((range) => {
      if (range.empty) return false
      const fromLine = this.view.state.doc.lineAt(range.from).number
      const toLine = this.view.state.doc.lineAt(range.to).number
      return fromLine !== toLine
    })
  }
})

function mountEditor() {
  if (!editorHost.value) return
  editorBufferPath = store.currentPath
  note = loadNote(store.currentContent)
  if (!note.content.includes('---block:')) {
    note.content = blockDelimiter(store.settings.defaultLanguage, true).trimStart() + note.content
  }

  const state = EditorState.create({
    doc: note.content,
    extensions: [
      lineNumbers({
        formatNumber(lineNo, state) {
          if (lineNo < 1 || lineNo > state.doc.lines) return ''
          const line = state.doc.line(lineNo)
          const block = state.field(blockField).find(item => item.content.from <= line.to && item.content.to >= line.from)
          if (!block) return ''
          const blockStartLine = contentStartLineNumber(state, block)
          if (lineNo < blockStartLine) return ''
          return String(lineNo - blockStartLine + 1)
        },
      }),
      history(),
      drawSelection(),
      highlightActiveLine(),
      keymap.of([
        { key: 'Mod-Alt-Enter', run: splitBlockFromKeymap },
        { key: 'Mod-Shift-Enter', run: addBlockAtEnd },
        { key: 'Shift-Alt-Enter', run: addBlockAtStart },
        { key: 'Alt-Enter', run: addBlockBeforeCurrent },
        { key: 'Mod-Enter', run: addBlockAfterCurrent },
        { key: 'Mod-Shift-d', run: removeBlockFromKeymap },
        { key: 'Ctrl-Shift-d', run: removeBlockFromKeymap },
        { key: 'Mod-a', run: selectCurrentBlockOrAll },
        { key: 'Mod-Alt-ArrowUp', run: addCursorAbove },
        { key: 'Mod-Alt-ArrowDown', run: addCursorBelow },
        { key: 'Mod-ArrowUp', run: moveToPreviousBlock },
        { key: 'Mod-ArrowDown', run: moveToNextBlock },
        { key: 'Mod-l', run: focusLanguageSelector },
        { key: 'Shift-Alt-f', run: formatBlockFromKeymap },
        { key: 'Mod-b', run: editor => wrapMarkdownSelection(editor, '**', '**', 'bold') },
        { key: 'Mod-i', run: editor => wrapMarkdownSelection(editor, '*', '*', 'italic') },
        { key: 'Mod-k', run: insertMarkdownLink },
        { key: 'Mod-Shift-8', run: editor => toggleMarkdownList(editor, 'unordered') },
        { key: 'Mod-Shift-7', run: editor => toggleMarkdownList(editor, 'ordered') },
        { key: 'Enter', run: continueMarkdownListFromKeymap },
        { key: 'Backspace', run: removeImageOrBlankBlockFromDeleteKey },
        { key: 'Delete', run: removeImageOrBlankBlockFromDeleteKey },
        { key: 'ArrowLeft', run: editor => revealCursorAroundActiveImage(editor, 'left') },
        { key: 'ArrowRight', run: editor => revealCursorAroundActiveImage(editor, 'right') },
        indentWithTab,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.lineWrapping,
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: 'var(--editor-font-size)',
        },
        '.cm-scroller': {
          fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Consolas, monospace',
          lineHeight: '1.36',
        },
        '.cm-content': {
          padding: '0 0 120px 0',
        },
        '.cm-line': {
          padding: '1px 10px',
        },
        '.cm-gutters': {
          background: 'var(--surface-soft)',
          borderRight: '2px solid oklch(87.5% 0.012 226)',
          color: 'var(--faint)',
          fontFamily: 'JetBrains Mono, SFMono-Regular, Menlo, Consolas, monospace',
          lineHeight: '1.36',
        },
        '.cm-lineNumbers .cm-gutterElement': {
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 'calc(var(--editor-font-size) * 1.8 + 18px)',
          padding: '0 calc(var(--editor-font-size) * 0.22)',
          lineHeight: '1.36',
          textAlign: 'center',
        },
        '.cm-lineNumbers': {
          minWidth: 'calc(var(--editor-font-size) * 1.8 + 18px)',
        },
        '.cm-activeLine': {
          backgroundColor: 'var(--active-line-bg)',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'var(--active-line-bg)',
          color: 'var(--ink-soft)',
          fontWeight: '700',
        },
        '.cm-selectionLayer': {
          zIndex: '5',
          pointerEvents: 'none',
        },
        '.cm-cursorLayer': {
          zIndex: '6',
        },
        '&.image-line-focused .cm-cursorLayer': {
          opacity: '0',
        },
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'oklch(79% 0.055 252 / 0.52)',
        },
      }),
      selectionRightFill,
      blockField,
      blockDecorations,
      blockGutterDecorations,
      EditorView.editorAttributes.compute([blockField], state => {
        const blocks = state.field(blockField)
        const lastIndex = blocks.length - 1
        if (lastIndex < 0) return { class: '' }
        return { class: lastIndex % 2 === 0 ? 'last-block-even' : 'last-block-odd' }
      }),
      activeImageLineField,
      richDecorations,
      protectDelimiters,
      delimiterChangeProtection,
      autoDetectPlugin,
      EditorView.domEventHandlers({
        keydown(event, view) {
          return handleEditorShortcut(event, view)
        },
        click(event, view) {
          return openMarkdownLinkFromClick(event, view)
        },
        copy(event, view) {
          return copyVisibleSelection(event, view)
        },
        cut(event, view) {
          return cutVisibleSelection(event, view)
        },
        paste(event, view) {
          const items = Array.from(event.clipboardData?.items || [])
          const image = items.find(item => item.type.startsWith('image/'))
          const activeImageLine = activeImageLineRange(view)
          if (!image) {
            if (!activeImageLine) return false
            const text = event.clipboardData?.getData('text/plain') || ''
            event.preventDefault()
            view.dispatch({
              changes: { from: activeImageLine.from, to: activeImageLine.to, insert: text },
              selection: EditorSelection.cursor(activeImageLine.from + text.length),
              effects: setActiveImageLine.of(null),
              annotations: internalBlockEdit.of(true),
              userEvent: 'input.paste',
            })
            scheduleSave()
            return true
          }
          event.preventDefault()
          const file = image.getAsFile()
          if (!file) return true
          file.arrayBuffer().then(async data => {
            const imagePath = await window.vibenote.image.save({
              mime: file.type,
              data,
              documentPath: store.currentPath,
              storageMode: store.settings.imageStorage,
            })
            const markdown = `![image](<${imagePath}>)`
            const target = activeImageLineRange(view)
            view.dispatch({
              changes: target
                ? { from: target.from, to: target.to, insert: markdown }
                : view.state.replaceSelection(markdown).changes,
              selection: EditorSelection.cursor((target?.from ?? view.state.selection.main.from) + markdown.length),
              effects: setActiveImageLine.of(null),
              annotations: internalBlockEdit.of(true),
              userEvent: 'input.paste',
            })
            scheduleSave()
          })
          return true
        },
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          dismissAiSuggestion()
          scheduleSave()
        }
        if (update.docChanged || update.selectionSet || update.focusChanged || update.viewportChanged) {
          clearImageEditWhenSelectionLeaves(update.view)
          updateImageFocusClass(update.view)
          if (normalizeSelectionToBlockContent(update.view)) return
          updateStatus(update.view)
          scheduleBlockToolbarUpdate(update.view)
        }
      }),
    ],
  })

  view = new EditorView({ state, parent: editorHost.value })
  editorScrollElement = view.scrollDOM
  editorScrollElement.addEventListener('scroll', onEditorScroll, { passive: true })
  applyEditorViewSettings(view)
  moveCursorToEditableContent(view)
  updateImageFocusClass(view)
  updateStatus(view)
  scheduleBlockToolbarUpdate(view)
  view.focus()
}

function contentStartLineNumber(state: EditorState, block: ScratchBlock) {
  const line = state.doc.lineAt(block.content.from)
  if (line.to < block.content.from && line.number < state.doc.lines) {
    return line.number + 1
  }
  return line.number
}

function moveCursorToEditableContent(editor: EditorView) {
  const firstBlock = editor.state.field(blockField)[0]
  if (!firstBlock) return
  editor.dispatch({
    selection: EditorSelection.cursor(firstBlock.content.from),
    effects: EditorView.scrollIntoView(firstBlock.content.from, { y: 'start' }),
  })
}

function focusEditorContent() {
  if (!view) return
  const block = activeBlock(view.state) || view.state.field(blockField)[0]
  if (block && view.state.selection.main.head < block.content.from) {
    view.dispatch({ selection: EditorSelection.cursor(block.content.from) })
  }
  view.focus()
}

function visibleTextForRange(state: EditorState, from: number, to: number) {
  const blocks = state.field(blockField)
  const parts: string[] = []

  for (const block of blocks) {
    const partFrom = Math.max(from, block.content.from)
    const partTo = Math.min(to, block.content.to)
    if (partFrom >= partTo) continue

    const text = state.doc.sliceString(partFrom, partTo)
    if (parts.length > 0 && text.length > 0) {
      const previous = parts[parts.length - 1]
      if (!previous.endsWith('\n') && !text.startsWith('\n')) {
        parts.push('\n')
      }
    }
    parts.push(text)
  }

  return parts.join('')
}

function visibleSelectionText(editor: EditorView) {
  const ranges = editor.state.selection.ranges.filter(range => !range.empty)
  if (ranges.length === 0) return null
  return ranges
    .map(range => visibleTextForRange(editor.state, range.from, range.to))
    .join('\n')
}

function visibleSelectionRange(editor: EditorView) {
  const ranges = editor.state.selection.ranges.filter(range => !range.empty)
  if (ranges.length === 0) return null
  return {
    from: Math.min(...ranges.map(range => range.from)),
    to: Math.max(...ranges.map(range => range.to)),
  }
}

function sameBlockPosition(block: ScratchBlock | null, candidate: ScratchBlock) {
  return Boolean(block &&
    block.delimiter.from === candidate.delimiter.from &&
    block.content.from === candidate.content.from &&
    block.range.to === candidate.range.to)
}

function blockForAiSource(editor: EditorView) {
  const blocks = editor.state.field(blockField)
  const head = editor.state.selection.main.head
  const inContent = blocks.find(block => block.content.from <= head && block.content.to >= head)
  if (inContent) return inContent

  const active = activeBlock(editor.state)
  if (active) return active

  const matchingCurrent = blocks.find(block => sameBlockPosition(currentBlock.value, block))
  if (matchingCurrent) return matchingCurrent

  return blocks.find(block => block.content.to >= head) || blocks[blocks.length - 1]
}

function aiSourceForEditor(editor: EditorView) {
  const selectionRange = visibleSelectionRange(editor)
  const selected = visibleSelectionText(editor)?.trim()
  const block = blockForAiSource(editor)
  const blockText = block
    ? editor.state.doc.sliceString(block.content.from, block.content.to).trim()
    : ''
  return {
    input: selected || blockText,
    language: block?.language || store.settings.defaultLanguage,
    scope: selected ? 'selection' as const : 'block' as const,
    range: selectionRange || (block ? { from: block.content.from, to: block.content.to } : null),
  }
}

function sanitizeAiBlockContent(content: string) {
  return content
    .replace(/^---block:.*$/gm, '---')
    .trim()
}

function todoBodyFromLine(line: string) {
  return line.match(/^\s*[-*]\s*\[[ xX]\]\s*(.+?)\s*$/)?.[1]?.trim() || ''
}

function isLikelyActionableTodo(body: string) {
  const text = body.trim()
  if (!text || /[:：]\s*$/.test(text)) return false
  if (/^(讨论|交流|周报内容|AI\s*工具对齐|模式调整|本周目标|下阶段规划)$/i.test(text)) return false

  return /(确认|判断|修复|处理|重启|读|推进|跟进|申请|建设|支持|交付|评估|测试|验证|自测|跑|收集|补齐|打标|通知|登录|扫描|使用|分析|解决|优化|覆盖|联调|归因|治理|拆解|上线|发布|检查|整理|迁移|接入|创建|更新|改|写|看|找|补|review|fix|update|verify|test|ship|release|deploy|implement|support|create)/i.test(text)
}

function sanitizeAiTodoContent(content: string) {
  return sanitizeAiBlockContent(content)
    .split('\n')
    .map(line => todoBodyFromLine(line))
    .filter(body => isLikelyActionableTodo(body))
    .map(body => `- [ ] ${body}`)
    .join('\n')
    .trim()
}

function insertAiBlockAfterCurrent(editor: EditorView, content: string, options: { todo?: boolean } = {}) {
  const cleanContent = options.todo ? sanitizeAiTodoContent(content) : sanitizeAiBlockContent(content)
  if (!cleanContent) return false

  const blocks = editor.state.field(blockField)
  const block = activeBlock(editor.state) || blocks[blocks.length - 1]
  const position = block?.range.to ?? editor.state.doc.length
  const delimiter = blockDelimiter('markdown', false)
  const insert = `${delimiter}${cleanContent}`

  editor.dispatch({
    changes: { from: position, to: position, insert },
    selection: EditorSelection.cursor(position + insert.length),
    annotations: internalBlockEdit.of(true),
    scrollIntoView: true,
  })
  editor.focus()
  updateStatus(editor)
  scheduleSave()
  return true
}

function aiSuggestionPosition(editor: EditorView, from: number) {
  const host = editorHost.value
  if (!host) return { top: 12, left: 12 }
  const hostRect = host.getBoundingClientRect()
  const coords = editor.coordsAtPos(from)
  const margin = Math.max(12, Math.round(store.settings.fontSize * 0.7))
  const expectedWidth = Math.min(
    Math.max(AI_POPOVER_MIN_WIDTH, store.settings.fontSize * AI_POPOVER_WIDTH_FACTOR),
    Math.max(AI_POPOVER_MIN_WIDTH, host.clientWidth - margin * 2),
  )
  const maxLeft = Math.max(margin, host.clientWidth - expectedWidth - margin)
  return {
    top: Math.max(margin, (coords?.bottom ?? hostRect.top + margin) - hostRect.top + margin),
    left: Math.min(Math.max(margin, (coords?.left ?? hostRect.left + margin) - hostRect.left), maxLeft),
  }
}

function tokenizeDiffText(value: string) {
  const tokens: string[] = []
  const pattern = /\r\n|\n|[ \t]+|[A-Za-z0-9_@./:-]+|\p{Script=Han}+|[^\s]/gu
  let match: RegExpExecArray | null
  while ((match = pattern.exec(value))) {
    tokens.push(match[0])
  }
  return tokens
}

function mergeDiffToken(tokens: AiDiffToken[], text: string, changed: boolean) {
  if (!text) return
  const previous = tokens[tokens.length - 1]
  if (previous && previous.changed === changed && previous.text !== '\n' && text !== '\n') {
    previous.text += text
    return
  }
  tokens.push({ text, changed })
}

function diffTextTokens(sourceText: string, targetText: string) {
  const source = tokenizeDiffText(sourceText)
  const target = tokenizeDiffText(targetText)
  const sourceDiff: AiDiffToken[] = []
  const targetDiff: AiDiffToken[] = []
  const columnCount = target.length + 1
  const table = new Uint32Array((source.length + 1) * columnCount)

  for (let sourceIndex = source.length - 1; sourceIndex >= 0; sourceIndex -= 1) {
    for (let targetIndex = target.length - 1; targetIndex >= 0; targetIndex -= 1) {
      const offset = sourceIndex * columnCount + targetIndex
      table[offset] = source[sourceIndex] === target[targetIndex]
        ? table[(sourceIndex + 1) * columnCount + targetIndex + 1] + 1
        : Math.max(
          table[(sourceIndex + 1) * columnCount + targetIndex],
          table[sourceIndex * columnCount + targetIndex + 1],
        )
    }
  }

  let sourceIndex = 0
  let targetIndex = 0
  while (sourceIndex < source.length && targetIndex < target.length) {
    if (source[sourceIndex] === target[targetIndex]) {
      mergeDiffToken(sourceDiff, source[sourceIndex], false)
      mergeDiffToken(targetDiff, target[targetIndex], false)
      sourceIndex += 1
      targetIndex += 1
    } else if (
      table[(sourceIndex + 1) * columnCount + targetIndex] >=
      table[sourceIndex * columnCount + targetIndex + 1]
    ) {
      mergeDiffToken(sourceDiff, source[sourceIndex], true)
      sourceIndex += 1
    } else {
      mergeDiffToken(targetDiff, target[targetIndex], true)
      targetIndex += 1
    }
  }

  while (sourceIndex < source.length) {
    mergeDiffToken(sourceDiff, source[sourceIndex], true)
    sourceIndex += 1
  }
  while (targetIndex < target.length) {
    mergeDiffToken(targetDiff, target[targetIndex], true)
    targetIndex += 1
  }

  return { sourceDiff, targetDiff }
}

function tokensToDiffLines(tokens: AiDiffToken[], keyPrefix: string): AiDiffLine[] {
  const lines: AiDiffLine[] = []
  let segments: AiDiffSegment[] = []
  let changed = false

  const pushLine = () => {
    lines.push({
      key: `${keyPrefix}-${lines.length}`,
      changed,
      segments: segments.length > 0 ? segments : [{ text: ' ', changed: false }],
    })
    segments = []
    changed = false
  }

  for (const token of tokens) {
    const parts = token.text.split('\n')
    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) pushLine()
      const part = parts[index]
      if (!part) continue
      const previous = segments[segments.length - 1]
      if (previous && previous.changed === token.changed) {
        previous.text += part
      } else {
        segments.push({ text: part, changed: token.changed })
      }
      changed = changed || token.changed
    }
  }

  pushLine()
  return lines
}

function buildAiSuggestionDiff(sourceText: string, targetText: string): AiSuggestionDiff {
  const { sourceDiff, targetDiff } = diffTextTokens(sourceText, targetText)
  const sourceLines = tokensToDiffLines(sourceDiff, 'source')
  const targetLines = tokensToDiffLines(targetDiff, 'target')
  return {
    sourceLines,
    targetLines,
    changed: sourceLines.some(line => line.changed) || targetLines.some(line => line.changed),
  }
}

function showAiSuggestion(editor: EditorView, source: ReturnType<typeof aiSourceForEditor>, content: string) {
  const cleanContent = sanitizeAiBlockContent(content)
  if (!cleanContent || !source.range) return false
  const position = aiSuggestionPosition(editor, source.range.from)
  aiSuggestion.value = {
    sourceText: source.input,
    content: cleanContent,
    from: source.range.from,
    to: source.range.to,
    scope: source.scope,
    ...position,
  }
  return true
}

function replaceWithAiSuggestion() {
  if (!view || !aiSuggestion.value) return
  const suggestion = aiSuggestion.value
  if (!snapshotCurrentSync('ai-polish-replace')) return
  view.dispatch({
    changes: { from: suggestion.from, to: suggestion.to, insert: suggestion.content },
    selection: EditorSelection.cursor(suggestion.from + suggestion.content.length),
    annotations: internalBlockEdit.of(true),
    scrollIntoView: true,
  })
  dismissAiSuggestion()
  view.focus()
  updateStatus(view)
  scheduleSave()
  setAiStatus('AI：已替换原文', true)
}

function insertAiSuggestionAsBlock() {
  if (!view || !aiSuggestion.value) return
  const content = aiSuggestion.value.content
  if (!snapshotCurrentSync('ai-polish-insert-block')) return
  if (insertAiBlockAfterCurrent(view, content)) {
    dismissAiSuggestion()
    setAiStatus('AI：已插入新块', true)
  } else {
    setAiStatus('AI：没有可插入内容')
  }
}

async function copyAiSuggestion() {
  if (!aiSuggestion.value) return
  try {
    await navigator.clipboard.writeText(aiSuggestion.value.content)
    setAiStatus('AI：已复制建议', true)
  } catch {
    setAiStatus('AI：复制失败')
  }
}

function activeImageLineRange(editor: EditorView) {
  const activeImageLine = editor.state.field(activeImageLineField, false)
  const selection = editor.state.selection.main
  if (!activeImageLine || activeImageLine.cursor || !selection.empty) return null
  if (selection.head < activeImageLine.from || selection.head > activeImageLine.to) return null
  return activeImageLine
}

function activeImageLineAtSelection(editor: EditorView) {
  const activeImageLine = editor.state.field(activeImageLineField, false)
  const selection = editor.state.selection.main
  if (!activeImageLine || !selection.empty) return null
  if (selection.head < activeImageLine.from || selection.head > activeImageLine.to) return null
  return activeImageLine
}

function updateImageFocusClass(editor: EditorView) {
  const activeImageLine = activeImageLineAtSelection(editor)
  editor.dom.classList.toggle('image-line-focused', Boolean(activeImageLine && !activeImageLine.edit))
}

function revealCursorAroundActiveImage(editor: EditorView, direction: 'left' | 'right') {
  const activeImageLine = editor.state.field(activeImageLineField, false)
  if (activeImageLine?.edit) return false

  if (activeImageLine?.cursor) {
    const shouldLeaveImage =
      (activeImageLine.cursor === 'left' && direction === 'left') ||
      (activeImageLine.cursor === 'right' && direction === 'right')

    if (shouldLeaveImage) {
      const target = adjacentVisibleLinePosition(editor, activeImageLine, direction)
      if (target === null) return true
      editor.dispatch({
        selection: EditorSelection.cursor(target),
        effects: setActiveImageLine.of(null),
        scrollIntoView: true,
      })
      editor.focus()
      updateStatus(editor)
      updateImageFocusClass(editor)
      return true
    }

    setImageCursor(editor, activeImageLine, direction)
    return true
  }

  const selectedImageLine = activeImageLineAtSelection(editor)
  if (selectedImageLine) {
    setImageCursor(editor, selectedImageLine, direction)
    return true
  }

  const boundaryMove = imageArrowBoundaryMove(editor, direction)
  if (!boundaryMove) return false
  setImageCursor(editor, boundaryMove.imageLine, boundaryMove.cursor)
  return true
}

function setImageCursor(editor: EditorView, imageLine: { from: number, to: number, edit: boolean }, cursor: 'left' | 'right') {
  const target = cursor === 'left' ? imageLine.from : imageLine.to
  editor.dispatch({
    selection: EditorSelection.cursor(target),
    effects: setActiveImageLine.of({ from: imageLine.from, to: imageLine.to, edit: false, cursor }),
    scrollIntoView: true,
  })
  editor.focus()
  updateStatus(editor)
  updateImageFocusClass(editor)
}

function imageArrowBoundaryMove(editor: EditorView, direction: 'left' | 'right') {
  const selection = editor.state.selection.main
  if (!selection.empty) return null

  const imageLines = allImageLines(editor)
  const boundaryImage = imageLines.find(imageLine => {
    if (direction === 'left') return selection.head === imageLine.to
    return selection.head === imageLine.from
  })
  if (boundaryImage) {
    return { imageLine: boundaryImage, cursor: direction } as const
  }

  const visibleLines = visibleContentLines(editor)
  const currentLineIndex = visibleLines.findIndex(line => line.from <= selection.head && selection.head <= line.to)
  if (currentLineIndex === -1) return null

  if (direction === 'left' && selection.head === visibleLines[currentLineIndex].from && currentLineIndex > 0) {
    const previousLine = visibleLines[currentLineIndex - 1]
    const previousImage = imageLines.find(imageLine => previousLine.from <= imageLine.from && imageLine.to <= previousLine.to)
    return previousImage ? { imageLine: previousImage, cursor: 'right' as const } : null
  }

  if (direction === 'right' && selection.head === visibleLines[currentLineIndex].to && currentLineIndex < visibleLines.length - 1) {
    const nextLine = visibleLines[currentLineIndex + 1]
    const nextImage = imageLines.find(imageLine => nextLine.from <= imageLine.from && imageLine.to <= nextLine.to)
    return nextImage ? { imageLine: nextImage, cursor: 'left' as const } : null
  }

  return null
}

function allImageLines(editor: EditorView) {
  return editor.state.field(blockField).flatMap(block => imageLinesInBlock(editor, block))
}

function visibleContentLines(editor: EditorView) {
  const lines: Array<{ from: number, to: number }> = []
  for (const block of editor.state.field(blockField)) {
    const firstLine = editor.state.doc.lineAt(block.content.from).number
    const lastLine = editor.state.doc.lineAt(block.content.to).number
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      const line = editor.state.doc.line(lineNumber)
      const from = Math.max(line.from, block.content.from)
      const to = Math.min(line.to, block.content.to)
      if (from <= to) lines.push({ from, to })
    }
  }
  return lines
}

function imageLinesInBlock(editor: EditorView, block: ScratchBlock) {
  const content = editor.state.doc.sliceString(block.content.from, block.content.to)
  const imagePattern = /!\[[^\]]*]\((<([^>]+)>|([^)]+))\)/g
  const lines: Array<{ from: number, to: number, edit: boolean, cursor?: 'left' | 'right' }> = []
  for (const match of content.matchAll(imagePattern)) {
    const imageUrl = (match[2] || match[3] || '').trim()
    if (!isPreviewableImageUrl(imageUrl)) continue
    const from = block.content.from + match.index!
    const to = from + match[0].length
    lines.push({ from, to, edit: false })
  }
  return lines
}

function isPreviewableImageUrl(url: string) {
  return url.startsWith('vibenote-image://') ||
    url.startsWith('file://') ||
    url.startsWith('/') ||
    /^https?:\/\//i.test(url)
}

function adjacentVisibleLinePosition(editor: EditorView, activeImageLine: { from: number, to: number }, direction: 'left' | 'right') {
  const lines = visibleContentLines(editor)
  const index = lines.findIndex(line => line.from <= activeImageLine.from && line.to >= activeImageLine.from)
  if (index === -1) return null
  if (direction === 'left') {
    return index > 0 ? lines[index - 1].to : null
  }
  return index < lines.length - 1 ? lines[index + 1].from : null
}

function clearImageEditWhenSelectionLeaves(editor: EditorView) {
  const activeImageLine = editor.state.field(activeImageLineField, false)
  if (!activeImageLine?.edit && !activeImageLine?.cursor) return

  const selection = editor.state.selection.main
  const stillInsideImageLine =
    selection.from >= activeImageLine.from &&
    selection.to <= activeImageLine.to

  if (stillInsideImageLine) return

  editor.dispatch({ effects: setActiveImageLine.of(null) })
}

function copyVisibleSelection(event: ClipboardEvent, editor: EditorView) {
  const activeImageLine = activeImageLineRange(editor)
  const text = activeImageLine
    ? editor.state.doc.sliceString(activeImageLine.from, activeImageLine.to)
    : visibleSelectionText(editor)
  if (text === null) return false
  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()
  return true
}

function selectedContentSegments(editor: EditorView) {
  const blocks = editor.state.field(blockField)
  const segments: Array<{ from: number, to: number }> = []

  for (const range of editor.state.selection.ranges) {
    if (range.empty) continue
    for (const block of blocks) {
      const from = Math.max(range.from, block.content.from)
      const to = Math.min(range.to, block.content.to)
      if (from < to) segments.push({ from, to })
    }
  }

  return segments
    .sort((left, right) => left.from - right.from || left.to - right.to)
    .reduce<Array<{ from: number, to: number }>>((merged, segment) => {
      const previous = merged[merged.length - 1]
      if (previous && segment.from <= previous.to) {
        previous.to = Math.max(previous.to, segment.to)
      } else {
        merged.push({ ...segment })
      }
      return merged
    }, [])
}

function cutVisibleSelection(event: ClipboardEvent, editor: EditorView) {
  const activeImageLine = activeImageLineRange(editor)
  const text = activeImageLine
    ? editor.state.doc.sliceString(activeImageLine.from, activeImageLine.to)
    : visibleSelectionText(editor)
  if (text === null) return false

  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()

  if (activeImageLine) {
    editor.dispatch({
      changes: { from: activeImageLine.from, to: activeImageLine.to, insert: '' },
      selection: EditorSelection.cursor(activeImageLine.from),
      effects: setActiveImageLine.of(null),
      annotations: internalBlockEdit.of(true),
      userEvent: 'delete.cut',
    })
    updateStatus(editor)
    scheduleSave()
    return true
  }

  const segments = selectedContentSegments(editor)
  if (segments.length === 0) return true

  editor.dispatch({
    changes: segments.map(segment => ({ from: segment.from, to: segment.to, insert: '' })),
    selection: EditorSelection.cursor(segments[0].from),
    annotations: internalBlockEdit.of(true),
    userEvent: 'delete.cut',
  })
  updateStatus(editor)
  scheduleSave()
  return true
}

function normalizeSelectionToBlockContent(editor: EditorView) {
  const selection = editor.state.selection.main
  if (!selection.empty) return false

  const block = activeBlock(editor.state)
  if (!block || selection.head >= block.content.from) return false

  editor.dispatch({
    selection: EditorSelection.cursor(block.content.from),
  })
  return true
}

function updateStatus(editor: EditorView) {
  const block = activeBlock(editor.state)
  currentBlock.value = block || null
  const line = editor.state.doc.lineAt(editor.state.selection.main.head)
  const blockStartLine = block ? contentStartLineNumber(editor.state, block) : 1
  cursorLabel.value = `${line.number - blockStartLine + 1}:${editor.state.selection.main.head - line.from + 1}`
}

function scheduleBlockToolbarUpdate(editor = view) {
  if (blockToolbarFrame) {
    window.cancelAnimationFrame(blockToolbarFrame)
  }
  blockToolbarFrame = window.requestAnimationFrame(() => {
    blockToolbarFrame = null
    updateBlockToolbar(editor)
  })
}

function updateBlockToolbar(editor: EditorView | null) {
  if (!editor || !editorHost.value || !editor.hasFocus) {
    blockToolbar.value = { ...blockToolbar.value, visible: false }
    return
  }

  const block = activeBlock(editor.state)
  if (!block) {
    blockToolbar.value = { ...blockToolbar.value, visible: false }
    return
  }

  const blockIsVisible = editor.visibleRanges.some(range =>
    range.to >= block.content.from && range.from <= block.content.to,
  )
  if (!blockIsVisible) {
    blockToolbar.value = { ...blockToolbar.value, visible: false }
    return
  }

  const line = editor.state.doc.lineAt(block.content.from)
  const coords = editor.coordsAtPos(line.from)
  const hostRect = editorHost.value.getBoundingClientRect()
  const stickyTop = 8
  const blockStartTop = coords ? coords.top - hostRect.top + 4 : stickyTop
  blockToolbar.value = {
    visible: true,
    top: Math.max(stickyTop, blockStartTop),
  }
}

function onEditorScroll() {
  updateAiSuggestionPosition()
  scheduleBlockToolbarUpdate()
}

function onWindowResize() {
  updateAiSuggestionPosition()
  scheduleBlockToolbarUpdate()
}

function updateAiSuggestionPosition() {
  if (!view || !aiSuggestion.value) return
  aiSuggestion.value = {
    ...aiSuggestion.value,
    ...aiSuggestionPosition(view, aiSuggestion.value.from),
  }
}

function scheduleSave() {
  if (saveTimer) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    flushSave()
  }, 350)
}

function flushSave() {
  if (!view || !note) return
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  saving.value = true
  note.content = view.state.doc.toString()
  const raw = serializeNote(note)
  store.saveBuffer(editorBufferPath, raw)
    .catch(error => {
      setAiStatus(`保存失败：${error instanceof Error ? error.message : '无法写入文件'}`)
      void store.refreshRecoveries()
    })
    .finally(() => {
      saving.value = false
    })
}

function flushSaveSync() {
  if (!view || !note) return
  if (saveTimer) {
    window.clearTimeout(saveTimer)
    saveTimer = null
  }
  note.content = view.state.doc.toString()
  store.saveBufferSync(editorBufferPath, serializeNote(note))
  saving.value = false
}

function snapshotCurrentSync(reason: string) {
  if (!view || !note) return false
  note.content = view.state.doc.toString()
  try {
    store.snapshotBufferSync(editorBufferPath, serializeNote(note), reason)
    void store.refreshRecoveries()
    return true
  } catch (error) {
    setAiStatus(`数据保护失败：${error instanceof Error ? error.message : '无法创建快照'}`)
    return false
  }
}

function addBlockAfterActive() {
  if (!view) return
  insertBlockAfterCurrent(view, store.settings.defaultLanguage, true)
  updateStatus(view)
  scheduleBlockToolbarUpdate(view)
  scheduleSave()
}

async function restoreRecoveryDraft() {
  if (!view || !note || !store.currentPath || !currentRecovery.value) return
  try {
    const recovery = await store.readRecovery(store.currentPath)
    const recovered = loadNote(recovery.content).content.trim()
    if (!recovered) {
      setAiStatus('恢复草稿为空', true)
      return
    }
    if (!snapshotCurrentSync('restore-recovery')) return

    const doc = view.state.doc.toString()
    const body = recovered.startsWith('---block:')
      ? recovered
      : `${blockDelimiter(store.settings.defaultLanguage, true).trimStart()}${recovered}`
    const insert = `${doc.endsWith('\n') || doc.length === 0 ? '' : '\n'}${body}`
    const from = view.state.doc.length
    view.dispatch({
      changes: { from, insert },
      selection: EditorSelection.cursor(from + insert.length),
      annotations: internalBlockEdit.of(true),
      scrollIntoView: true,
    })
    view.focus()
    updateStatus(view)
    scheduleSave()
    setAiStatus('已插入恢复草稿', true)
  } catch (error) {
    setAiStatus(`恢复失败：${error instanceof Error ? error.message : '无法读取恢复草稿'}`)
  }
}

function removeBlock() {
  if (!view) return
  removeBlockFromKeymap(view)
}

function removeBlockFromKeymap(editor: EditorView) {
  if (!snapshotCurrentSync('delete-block')) return true
  if (deleteCurrentBlock(editor)) {
    updateStatus(editor)
    scheduleSave()
  }
  return true
}

function removeBlankBlockFromDeleteKey(editor: EditorView) {
  const selection = editor.state.selection.main
  if (!selection.empty) return false

  const block = activeBlock(editor.state)
  if (!block || selection.head < block.content.from || selection.head > block.content.to) return false

  const content = editor.state.doc.sliceString(block.content.from, block.content.to)
  if (content.trim().length > 0) return false

  const blocks = editor.state.field(blockField)
  if (blocks.length <= 1) return true

  if (!snapshotCurrentSync('delete-empty-block')) return true

  const index = blocks.indexOf(block)
  const previousBlock = blocks[index - 1]
  const nextBlock = blocks[index + 1]
  const target = previousBlock
    ? blockSelectionRange(previousBlock, editor).to
    : nextBlock.content.from
  const deleteFrom = previousBlock && editor.state.doc.sliceString(block.range.from - 1, block.range.from) === '\n'
    ? block.range.from - 1
    : block.range.from

  editor.dispatch({
    changes: { from: deleteFrom, to: block.range.to, insert: '' },
    selection: { anchor: target },
    annotations: internalBlockEdit.of(true),
    scrollIntoView: true,
  })
  editor.focus()
  updateStatus(editor)
  scheduleSave()
  return true
}

function removeImageOrBlankBlockFromDeleteKey(editor: EditorView) {
  return removeActiveImageLineFromDeleteKey(editor) || removeBlankBlockFromDeleteKey(editor)
}

function removeActiveImageLineFromDeleteKey(editor: EditorView) {
  const activeImageLine = activeImageLineRange(editor)
  if (!activeImageLine || activeImageLine.edit) return false

  const line = editor.state.doc.lineAt(activeImageLine.from)
  const block = activeBlock(editor.state)
  if (!block || line.from < block.content.from || line.to > block.content.to) return false

  if (!snapshotCurrentSync('delete-image')) return true

  let deleteFrom = line.from
  let deleteTo = line.to
  if (line.to < block.content.to) {
    deleteTo += 1
  } else if (line.from > block.content.from) {
    deleteFrom -= 1
  }

  editor.dispatch({
    changes: { from: deleteFrom, to: deleteTo, insert: '' },
    selection: EditorSelection.cursor(deleteFrom),
    effects: setActiveImageLine.of(null),
    annotations: internalBlockEdit.of(true),
    userEvent: 'delete.image',
    scrollIntoView: true,
  })
  editor.focus()
  updateStatus(editor)
  scheduleSave()
  return true
}

function addBlockAfterCurrent(editor: EditorView) {
  insertBlockAfterCurrent(editor, store.settings.defaultLanguage, true)
  scheduleSave()
  return true
}

function addBlockBeforeCurrent(editor: EditorView) {
  insertBlockBeforeCurrent(editor, store.settings.defaultLanguage, true)
  scheduleSave()
  return true
}

function addBlockAtStart(editor: EditorView) {
  insertBlockAtStart(editor, store.settings.defaultLanguage, true)
  scheduleSave()
  return true
}

function addBlockAtEnd(editor: EditorView) {
  insertBlockAtEnd(editor, store.settings.defaultLanguage, true)
  scheduleSave()
  return true
}

function splitBlockFromKeymap(editor: EditorView) {
  splitCurrentBlock(editor, currentBlock.value?.language || store.settings.defaultLanguage, currentBlock.value?.auto ?? true)
  scheduleSave()
  return true
}

function blockSelectionRange(block: ScratchBlock, editor: EditorView) {
  let to = block.content.to
  while (to > block.content.from) {
    const char = editor.state.doc.sliceString(to - 1, to)
    if (char !== '\n' && char !== '\r') break
    to -= 1
  }
  return { from: block.content.from, to }
}

function selectCurrentBlockOrAll(editor: EditorView) {
  const block = activeBlock(editor.state)
  if (!block) return false
  const range = blockSelectionRange(block, editor)
  const selection = editor.state.selection.main
  const selectedCurrentBlock = selection.from === range.from && selection.to === range.to
  editor.dispatch({
    selection: selectedCurrentBlock
      ? EditorSelection.range(0, editor.state.doc.length)
      : EditorSelection.range(range.from, range.to),
    scrollIntoView: true,
  })
  return true
}

function moveToBlock(editor: EditorView, offset: number) {
  const blocks = editor.state.field(blockField)
  if (blocks.length === 0) return false
  const current = activeBlock(editor.state)
  const index = current ? blocks.indexOf(current) : 0
  const next = blocks[Math.min(Math.max(index + offset, 0), blocks.length - 1)]
  if (!next || next === current) return true
  editor.dispatch({
    selection: EditorSelection.cursor(next.content.from),
    effects: EditorView.scrollIntoView(next.content.from, { y: 'center' }),
  })
  editor.focus()
  return true
}

function moveToPreviousBlock(editor: EditorView) {
  return moveToBlock(editor, -1)
}

function moveToNextBlock(editor: EditorView) {
  return moveToBlock(editor, 1)
}

function formatBlockFromKeymap() {
  void formatBlock()
  return true
}

function focusLanguageSelector() {
  languageSelect.value?.focus()
  languageSelect.value?.click()
  return true
}

function activeMarkdownBlock(editor: EditorView) {
  const block = activeBlock(editor.state)
  if (!block || block.language !== 'markdown') return null
  return block
}

function selectionWithinBlock(editor: EditorView, block: ScratchBlock) {
  const selection = editor.state.selection.main
  return selection.from >= block.content.from && selection.to <= block.content.to
}

function dispatchMarkdownEdit(editor: EditorView, spec: Parameters<EditorView['dispatch']>[0]) {
  editor.dispatch(spec)
  editor.focus()
  updateStatus(editor)
  scheduleSave()
}

function wrapMarkdownSelection(editor: EditorView, prefix: string, suffix: string, placeholder: string) {
  const block = activeMarkdownBlock(editor)
  if (!block || !selectionWithinBlock(editor, block)) return false

  const selection = editor.state.selection.main
  const selected = selection.empty
    ? placeholder
    : editor.state.doc.sliceString(selection.from, selection.to)
  const insert = `${prefix}${selected}${suffix}`
  const anchor = selection.from + prefix.length
  const head = anchor + selected.length

  dispatchMarkdownEdit(editor, {
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.range(anchor, head),
    scrollIntoView: true,
  })
  return true
}

function insertMarkdownLink(editor: EditorView) {
  const block = activeMarkdownBlock(editor)
  if (!block || !selectionWithinBlock(editor, block)) return false

  const selection = editor.state.selection.main
  const label = selection.empty
    ? 'text'
    : editor.state.doc.sliceString(selection.from, selection.to)
  const insert = `[${label}](url)`
  const urlFrom = selection.from + label.length + 3

  dispatchMarkdownEdit(editor, {
    changes: { from: selection.from, to: selection.to, insert },
    selection: EditorSelection.range(urlFrom, urlFrom + 3),
    scrollIntoView: true,
  })
  return true
}

function markdownLinkAt(editor: EditorView, pos: number) {
  const block = editor.state.field(blockField).find(item => item.language === 'markdown' && pos >= item.content.from && pos <= item.content.to)
  if (!block) return null

  const text = editor.state.doc.sliceString(block.content.from, block.content.to)
  const linkPattern = /(?<!!)\[([^\]\n]+)]\((<([^>\n]+)>|([^)]+))\)/g
  for (const match of text.matchAll(linkPattern)) {
    const from = block.content.from + match.index!
    const to = from + match[0].length
    if (pos < from || pos > to) continue

    const url = (match[3] || match[4] || '').trim()
    if (!/^https?:\/\//i.test(url)) return null
    return { url, from, to }
  }
  return null
}

function openMarkdownLinkFromClick(event: MouseEvent, editor: EditorView) {
  if (!event.metaKey && !event.ctrlKey) return false

  const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY })
  if (pos === null) return false

  const link = markdownLinkAt(editor, pos)
  if (!link) return false

  event.preventDefault()
  event.stopPropagation()
  void window.vibenote.shell.openExternal(link.url).catch(error => {
    console.error('Failed to open external link', error)
  })
  return true
}

function toggleMarkdownList(editor: EditorView, kind: 'ordered' | 'unordered') {
  const block = activeMarkdownBlock(editor)
  if (!block || !selectionWithinBlock(editor, block)) return false

  const selection = editor.state.selection.main
  const firstLine = editor.state.doc.lineAt(selection.from)
  const lastLine = editor.state.doc.lineAt(Math.max(selection.from, selection.to))
  const changes: Array<{ from: number, to: number, insert: string }> = []
  let orderedIndex = 1

  for (let lineNumber = firstLine.number; lineNumber <= lastLine.number; lineNumber += 1) {
    const line = editor.state.doc.line(lineNumber)
    const from = Math.max(line.from, block.content.from)
    const to = Math.min(line.to, block.content.to)
    const text = editor.state.doc.sliceString(from, to)
    if (!text.trim()) continue

    const unordered = text.match(/^(\s*)([-*+])\s+/)
    const ordered = text.match(/^(\s*)\d+\.\s+/)
    const indent = text.match(/^\s*/)?.[0] || ''

    if (kind === 'unordered') {
      if (unordered) {
        changes.push({ from: from + unordered[1].length, to: from + unordered[0].length, insert: '' })
      } else if (ordered) {
        changes.push({ from: from + ordered[1].length, to: from + ordered[0].length, insert: '- ' })
      } else {
        changes.push({ from: from + indent.length, to: from + indent.length, insert: '- ' })
      }
      continue
    }

    const marker = `${orderedIndex}. `
    orderedIndex += 1
    if (ordered) {
      changes.push({ from: from + ordered[1].length, to: from + ordered[0].length, insert: '' })
    } else if (unordered) {
      changes.push({ from: from + unordered[1].length, to: from + unordered[0].length, insert: marker })
    } else {
      changes.push({ from: from + indent.length, to: from + indent.length, insert: marker })
    }
  }

  if (changes.length === 0) return false
  dispatchMarkdownEdit(editor, {
    changes,
    selection: EditorSelection.cursor(selection.from),
    scrollIntoView: true,
  })
  return true
}

function continueMarkdownListFromKeymap(editor: EditorView) {
  const block = activeMarkdownBlock(editor)
  const selection = editor.state.selection.main
  if (!block || !selection.empty || !selectionWithinBlock(editor, block)) return false

  const line = editor.state.doc.lineAt(selection.head)
  if (line.from < block.content.from || line.to > block.content.to) return false

  const text = editor.state.doc.sliceString(line.from, line.to)
  const cursorOffset = selection.head - line.from
  const beforeCursor = text.slice(0, cursorOffset)
  const afterCursor = text.slice(cursorOffset)
  const unordered = beforeCursor.match(/^(\s*)([-*+])\s+(\[[ xX]\]\s+)?(.*)$/)
  const ordered = beforeCursor.match(/^(\s*)(\d+)\.\s+(.*)$/)

  if (!unordered && !ordered) return false

  const marker = unordered
    ? `${unordered[1]}${unordered[2]} ${unordered[3] || ''}`
    : `${ordered![1]}${Number.parseInt(ordered![2], 10) + 1}. `
  const markerLength = unordered
    ? unordered[1].length + unordered[2].length + 1 + (unordered[3]?.length || 0)
    : ordered![1].length + ordered![2].length + 2
  const itemTextBeforeCursor = unordered ? unordered[4] : ordered![3]
  const shouldExitList = itemTextBeforeCursor.trim().length === 0 && afterCursor.trim().length === 0

  if (shouldExitList) {
    dispatchMarkdownEdit(editor, {
      changes: { from: line.from, to: line.from + markerLength, insert: '' },
      selection: EditorSelection.cursor(line.from),
      scrollIntoView: true,
    })
    return true
  }

  dispatchMarkdownEdit(editor, {
    changes: { from: selection.head, to: selection.head, insert: `\n${marker}` },
    selection: EditorSelection.cursor(selection.head + marker.length + 1),
    scrollIntoView: true,
  })
  return true
}

function handleEditorShortcut(event: KeyboardEvent, editor: EditorView) {
  const primary = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  let handled = false

  if (key === 'n' && primary) {
    void store.createExternalFile()
    handled = true
  } else if (key === 'o' && primary) {
    void store.openExternalFile()
    handled = true
  } else if (key === 'arrowleft' && !primary && !event.altKey && !event.shiftKey) {
    handled = revealCursorAroundActiveImage(editor, 'left')
  } else if (key === 'arrowright' && !primary && !event.altKey && !event.shiftKey) {
    handled = revealCursorAroundActiveImage(editor, 'right')
  } else if ((key === 'backspace' || key === 'delete') && removeImageOrBlankBlockFromDeleteKey(editor)) {
    handled = true
  } else if (key === 'enter' && primary && event.altKey) {
    handled = splitBlockFromKeymap(editor)
  } else if (key === 'enter' && primary && event.shiftKey) {
    handled = addBlockAtEnd(editor)
  } else if (key === 'enter' && event.altKey && event.shiftKey) {
    handled = addBlockAtStart(editor)
  } else if (key === 'enter' && event.altKey) {
    handled = addBlockBeforeCurrent(editor)
  } else if (key === 'enter' && primary) {
    handled = addBlockAfterCurrent(editor)
  } else if (key === 'd' && primary && event.shiftKey) {
    handled = removeBlockFromKeymap(editor)
  } else if (key === 'a' && primary) {
    handled = selectCurrentBlockOrAll(editor)
  } else if (key === 'arrowup' && primary && event.altKey) {
    handled = addCursorAbove(editor)
  } else if (key === 'arrowdown' && primary && event.altKey) {
    handled = addCursorBelow(editor)
  } else if (key === 'arrowup' && primary) {
    handled = moveToPreviousBlock(editor)
  } else if (key === 'arrowdown' && primary) {
    handled = moveToNextBlock(editor)
  } else if (key === 'l' && primary) {
    handled = focusLanguageSelector()
  } else if ((key === '=' || key === '+') && primary) {
    handled = adjustEditorFontSize(1)
  } else if (key === '-' && primary) {
    handled = adjustEditorFontSize(-1)
  } else if (key === '0' && primary) {
    handled = resetEditorFontSize()
  } else if (key === 'f' && event.altKey && event.shiftKey) {
    handled = formatBlockFromKeymap()
  } else if (key === 'b' && primary) {
    handled = wrapMarkdownSelection(editor, '**', '**', 'bold')
  } else if (key === 'i' && primary) {
    handled = wrapMarkdownSelection(editor, '*', '*', 'italic')
  } else if (key === 'k' && primary) {
    handled = insertMarkdownLink(editor)
  } else if ((key === '*' || key === '8') && primary && event.shiftKey) {
    handled = toggleMarkdownList(editor, 'unordered')
  } else if ((key === '&' || key === '7') && primary && event.shiftKey) {
    handled = toggleMarkdownList(editor, 'ordered')
  }

  if (handled) {
    event.preventDefault()
    event.stopPropagation()
  }
  return handled
}

function runEditorCommand(command: EditorCommand, editor: EditorView) {
  if (command === 'file:new') {
    void store.createExternalFile()
    return true
  }
  if (command === 'file:open') {
    void store.openExternalFile()
    return true
  }
  if (command === 'block:split') return splitBlockFromKeymap(editor)
  if (command === 'block:add-end') return addBlockAtEnd(editor)
  if (command === 'block:add-start') return addBlockAtStart(editor)
  if (command === 'block:add-before') return addBlockBeforeCurrent(editor)
  if (command === 'block:add-after') return addBlockAfterCurrent(editor)
  if (command === 'block:delete') return removeBlockFromKeymap(editor)
  if (command === 'block:select') return selectCurrentBlockOrAll(editor)
  if (command === 'block:previous') return moveToPreviousBlock(editor)
  if (command === 'block:next') return moveToNextBlock(editor)
  if (command === 'block:format') return formatBlockFromKeymap()
  if (command === 'cursor:add-above') return addCursorAbove(editor)
  if (command === 'cursor:add-below') return addCursorBelow(editor)
  if (command === 'language:focus') return focusLanguageSelector()
  if (command === 'view:font-increase') return adjustEditorFontSize(1)
  if (command === 'view:font-decrease') return adjustEditorFontSize(-1)
  if (command === 'view:font-reset') return resetEditorFontSize()
  return false
}

function adjustEditorFontSize(delta: number) {
  store.settings.fontSize = Math.min(EDITOR_FONT_MAX, Math.max(EDITOR_FONT_MIN, store.settings.fontSize + delta))
  void store.saveSettings()
  return true
}

function resetEditorFontSize() {
  store.settings.fontSize = EDITOR_FONT_DEFAULT
  void store.saveSettings()
  return true
}

function onEditorCommand(command: EditorCommand) {
  if (!view) return
  if (isFormControl(document.activeElement)) return
  runEditorCommand(command, view)
}

function onWindowKeydown(event: KeyboardEvent) {
  if (!view || event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  if (isFormControl(target)) return
  handleEditorShortcut(event, view)
}

function isFormControl(element: EventTarget | Element | null) {
  if (!(element instanceof Element)) return false
  if (element.closest('.cm-editor')) return false
  return Boolean(element.closest('input, select, textarea, button, [contenteditable="true"]'))
}

function onWindowFocus() {
  window.setTimeout(() => {
    focusEditorContent()
  }, 50)
}

async function formatBlock() {
  if (!view || !currentBlock.value) return
  const block = currentBlock.value
  const language = getLanguage(block.language)
  const content = currentBlockText(view)
  if (block.language === 'math' || !language.prettier) return
  try {
    const formatted = await prettier.format(content, {
      parser: language.prettier.parser,
      plugins: language.prettier.plugins as any,
      tabWidth: store.settings.tabSize,
    })
    if (formatted === content) return
    if (!snapshotCurrentSync('format-block')) return
    view.dispatch({
      changes: { from: block.content.from, to: block.content.to, insert: formatted },
      selection: { anchor: Math.min(block.content.from + formatted.length, view.state.doc.length) },
      annotations: internalBlockEdit.of(true),
    })
    scheduleSave()
  } catch (error) {
    console.log('Failed to format block:', error)
  }
}

async function runAiAction(mode: AiCompletionMode) {
  if (!view || aiBusy.value) return

  setAiStatus('')
  const source = aiSourceForEditor(view)
  if (!source.input) {
    setAiStatus('AI：没有可发送内容')
    return
  }

  aiBusy.value = true
  setAiStatus(mode === 'extract-todos' ? 'AI：提取 Todo 中' : 'AI：优化表述中')
  try {
    const result = await store.completeWithAi({
      input: source.input,
      language: source.language,
      scope: source.scope,
      mode,
    })
    if (!result.ok) {
      setAiStatus(`AI：${result.message}`)
      return
    }
    if (mode === 'polish') {
      if (!showAiSuggestion(view, source, result.content)) {
        setAiStatus('AI：没有可展示的建议')
        return
      }
      setAiStatus('AI：已生成建议', true)
      return
    }
    if (!snapshotCurrentSync(mode === 'extract-todos' ? 'ai-extract-todos' : 'ai-polish')) return
    if (!insertAiBlockAfterCurrent(view, result.content, { todo: mode === 'extract-todos' })) {
      setAiStatus(mode === 'extract-todos' ? 'AI：没有识别到明确 Todo' : 'AI：没有可插入内容')
      return
    }
    setAiStatus(mode === 'extract-todos' ? 'AI：已插入 Todo' : 'AI：已插入优化版本', true)
  } catch (error) {
    setAiStatus(`AI：${error instanceof Error ? error.message : '请求失败'}`)
  } finally {
    aiBusy.value = false
  }
}

function runAiSuggestion() {
  return runAiAction('polish')
}

function runAiTodoExtraction() {
  return runAiAction('extract-todos')
}

function onGotoLine(event: CustomEvent<SearchResult>) {
  if (!view) return
  const detail = event.detail
  const line = Math.min(detail.line, view.state.doc.lines)
  const docLine = view.state.doc.line(line)
  const pos = Math.min(docLine.from + detail.column, docLine.to)
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  })
  view.focus()
}
</script>

<template>
  <section class="editor-pane">
    <div ref="editorHost" class="editor-host" @mousedown.self="focusEditorContent">
      <aside
        v-if="aiSuggestion"
        class="ai-suggestion-popover"
        :style="{ top: `${aiSuggestion.top}px`, left: `${aiSuggestion.left}px` }"
        aria-label="AI 表述优化建议"
        @mousedown.stop
      >
        <header class="ai-suggestion-header">
          <div>
            <strong>AI 建议</strong>
            <span>{{ aiSuggestion.scope === 'selection' ? '表述优化 / 选区' : '表述优化 / 当前块' }}</span>
          </div>
          <button type="button" class="ai-suggestion-close" title="关闭建议" @click="dismissAiSuggestion">
            <X :size="14" />
          </button>
        </header>
        <p v-if="aiSuggestionDiff && !aiSuggestionDiff.changed" class="ai-suggestion-empty-diff">
          AI 返回内容与原文基本一致，未检测到文字差异。
        </p>
        <div class="ai-suggestion-body">
          <div class="ai-suggestion-column">
            <span>原文</span>
            <div class="ai-diff-lines" data-testid="ai-diff-source">
              <div
                v-for="line in aiSuggestionDiff?.sourceLines || []"
                :key="line.key"
                class="ai-diff-line"
                :class="{ changed: line.changed }"
              >
                <span
                  v-for="(segment, index) in line.segments"
                  :key="index"
                  class="ai-diff-segment"
                  :class="{ removed: segment.changed }"
                >{{ segment.text }}</span>
              </div>
            </div>
          </div>
          <div class="ai-suggestion-column suggestion">
            <span>优化后</span>
            <div class="ai-diff-lines" data-testid="ai-diff-target">
              <div
                v-for="line in aiSuggestionDiff?.targetLines || []"
                :key="line.key"
                class="ai-diff-line"
                :class="{ changed: line.changed }"
              >
                <span
                  v-for="(segment, index) in line.segments"
                  :key="index"
                  class="ai-diff-segment"
                  :class="{ added: segment.changed }"
                >{{ segment.text }}</span>
              </div>
            </div>
          </div>
        </div>
        <footer class="ai-suggestion-actions">
          <span class="ai-suggestion-status">已生成建议</span>
          <button type="button" class="primary-button" title="用优化后的内容替换原文" @click="replaceWithAiSuggestion">
            替换原文
          </button>
          <button type="button" class="secondary-button" title="将优化后的内容插入为新块" @click="insertAiSuggestionAsBlock">
            插入新块
          </button>
          <button type="button" class="ghost-button compact" title="复制优化后的内容" @click="copyAiSuggestion">
            <Copy :size="13" />
            复制
          </button>
        </footer>
      </aside>
    </div>

    <footer class="statusbar">
      <div class="statusbar-left">
        <span class="status-coordinate" title="当前光标位置">{{ cursorStatus }}</span>
        <label class="status-language" title="当前块语言（Cmd/Ctrl+L）">
          <select ref="languageSelect" v-model="activeLanguage" aria-label="Current block language">
            <option v-for="language in languages" :key="language.token" :value="language.token">
              {{ language.name }}
            </option>
          </select>
        </label>
        <button
          type="button"
          class="status-auto-toggle"
          :class="{ active: currentBlock?.auto }"
          title="切换当前块自动识别语言"
          @click="toggleAutoMode"
        >
          {{ currentBlock?.auto ? 'Auto' : 'Manual' }}
        </button>
      </div>

      <div class="statusbar-center" aria-live="polite">
        <button
          v-if="currentRecovery"
          type="button"
          class="status-recovery-button"
          title="将可恢复草稿插入为新块"
          @click="restoreRecoveryDraft"
        >
          恢复草稿
        </button>
        <span v-if="statusMessage" class="status-feedback" :class="statusTone">
          {{ statusMessage }}
        </span>
      </div>

      <div
        v-if="blockToolbar.visible"
        class="block-toolbar"
        :style="{ top: `${blockToolbar.top}px` }"
        aria-label="当前块操作"
      >
        <button
          class="block-action-button"
          title="在此块后新建块（Cmd/Ctrl+Enter）"
          aria-label="在此块后新建块"
          data-tooltip="在此块后新建块"
          @mousedown.prevent
          @click="addBlockAfterActive"
        >
          <FilePlus2 :size="14" />
        </button>
        <button
          class="block-action-button"
          :disabled="aiBusy || !store.settings.ai.enabled || !store.settings.ai.hasApiKey"
          title="AI 优化选区或此块表述"
          aria-label="AI 优化选区或此块表述"
          data-tooltip="AI 优化表述"
          @mousedown.prevent
          @click="runAiSuggestion"
        >
          <Sparkles :size="14" />
        </button>
        <button
          class="block-action-button"
          :disabled="aiBusy || !store.settings.ai.enabled || !store.settings.ai.hasApiKey"
          title="AI 提取选区或此块 Todo"
          aria-label="AI 提取选区或此块 Todo"
          data-tooltip="AI 提取 Todo"
          @mousedown.prevent
          @click="runAiTodoExtraction"
        >
          <ListTodo :size="14" />
        </button>
        <button
          class="block-action-button"
          :disabled="!canFormatCurrentBlock"
          title="格式化当前块（Shift+Alt+F）"
          aria-label="格式化当前块"
          data-tooltip="格式化当前块"
          @mousedown.prevent
          @click="formatBlock"
        >
          <AlignLeft :size="14" />
        </button>
        <button
          class="block-action-button danger"
          title="删除此块（Cmd/Ctrl+Shift+D）"
          aria-label="删除此块"
          data-tooltip="删除此块"
          @mousedown.prevent
          @click="removeBlock"
        >
          <Trash2 :size="14" />
        </button>
      </div>

      <div class="statusbar-actions">
        <button class="status-icon-button danger" title="删除当前块（Cmd/Ctrl+Shift+D）" @click="removeBlock">
          <Trash2 :size="15" />
        </button>
        <button class="status-icon-button" title="设置" @click="emit('open-settings')">
          <Settings :size="15" />
        </button>
      </div>
    </footer>
  </section>
</template>
