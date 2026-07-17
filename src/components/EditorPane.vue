<script setup lang="ts">
import { EditorSelection, EditorState } from '@codemirror/state'
import { addCursorAbove, addCursorBelow, defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { lineNumbers, keymap, drawSelection, highlightActiveLine, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { searchKeymap } from '@codemirror/search'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AlignLeft,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Copy,
  FilePlus2,
  ListTodo,
  Pencil,
  Settings,
  Sparkles,
  Trash2,
  X,
} from 'lucide-vue-next'
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
import { flowMapField } from '../editor/flowMaps'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const emit = defineEmits<{
  (event: 'open-settings'): void
}>()
const editorHost = ref<HTMLElement | null>(null)
const editorMount = ref<HTMLElement | null>(null)
const languageSelect = ref<HTMLSelectElement | null>(null)
const currentBlock = ref<ScratchBlock | null>(null)
const cursorLabel = ref('1:1')
const aiPendingCount = ref(0)
const aiStatus = ref('')
const blockToolbar = ref({ visible: false, top: 0 })
type ScrollJumpTarget = 'top' | 'bottom'
const scrollJump = ref({ visible: false, target: 'bottom' as ScrollJumpTarget })
const aiQuickActions = ref({
  visible: false,
  top: 0,
  left: 0,
  placement: 'above' as 'above' | 'below',
  range: '',
  editing: false,
  instruction: '',
})
const aiQuickEditorInput = ref<HTMLInputElement | null>(null)
type AiSuggestionFrame = {
  top: number
  left: number
  width: number
  height: number
}
type AiPopoverInteraction = {
  suggestionId: string
  type: 'move' | 'resize'
  pointerId: number
  startX: number
  startY: number
  startFrame: AiSuggestionFrame
}
type AiSuggestionStatus = 'generating' | 'ready' | 'error' | 'stale'
type AiSuggestionPresentation = 'diff' | 'answer'
type AiSuggestionCard = {
  id: string
  mode: AiCompletionMode
  presentation: AiSuggestionPresentation
  status: AiSuggestionStatus
  sourceText: string
  instruction: string
  language: string
  sourceDirty: boolean
  content: string
  message: string
  from: number
  to: number
  scope: 'selection' | 'block'
  top: number
  left: number
  anchorOffsetTop: number
  anchorOffsetLeft: number
  visible: boolean
  width: number
  height: number
}
const aiSuggestions = ref<AiSuggestionCard[]>([])
const aiPopoverInteraction = ref<AiPopoverInteraction | null>(null)
type AiDiffSegment = { text: string; changed: boolean }
type AiDiffLine = { key: string; segments: AiDiffSegment[]; changed: boolean }
type AiSuggestionDiff = { sourceLines: AiDiffLine[]; targetLines: AiDiffLine[]; changed: boolean }
type AiDiffToken = { text: string; changed: boolean }
let view: EditorView | null = null
let note: LoadedNote | null = null
let saveTimer: number | null = null
let aiStatusTimer: number | null = null
let blockToolbarFrame: number | null = null
let editorScrollElement: HTMLElement | null = null
let scrollJumpHideTimer: number | null = null
let lastEditorScrollTop = 0
let lastEditorScrollTime = 0
let unsubscribeEditorCommand: (() => void) | null = null
let editorBufferPath: string | null = null
const EDITOR_FONT_MIN = 11
const EDITOR_FONT_MAX = 48
const EDITOR_FONT_DEFAULT = 13
const AI_POPOVER_MIN_WIDTH = 560
const AI_POPOVER_MIN_HEIGHT = 260
const AI_POPOVER_WIDTH_FACTOR = 34
const AI_POPOVER_HEIGHT_FACTOR = 22
const AI_POPOVER_MIN_MARGIN = 12
const AI_LOADING_POPOVER_MIN_WIDTH = 320
const AI_LOADING_POPOVER_MAX_WIDTH = 400
const AI_LOADING_POPOVER_MIN_HEIGHT = 80
const AI_LOADING_POPOVER_MAX_HEIGHT = 104
const AI_QUICK_ACTIONS_HEIGHT = 36
const AI_QUICK_ACTIONS_MARGIN = 10
const AI_QUICK_EDITOR_HEIGHT = 42
const AI_QUICK_EDITOR_GAP = 8
const SCROLL_JUMP_EDGE_TOLERANCE = 2
const SCROLL_JUMP_MIN_DELTA = 8
const SCROLL_JUMP_LARGE_DELTA = 96
const SCROLL_JUMP_MIN_VELOCITY = 0.5
const SCROLL_JUMP_HIDE_DELAY = 1500

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
const statusMessage = computed(() => aiStatus.value || recoveryStatus.value)
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
  if (scrollJumpHideTimer) window.clearTimeout(scrollJumpHideTimer)
  stopAiPopoverInteraction()
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

function dismissAiSuggestion(id: string) {
  if (aiPopoverInteraction.value?.suggestionId === id) stopAiPopoverInteraction()
  aiSuggestions.value = aiSuggestions.value.filter(suggestion => suggestion.id !== id)
}

function updateAiSuggestion(id: string, patch: Partial<AiSuggestionCard>) {
  aiSuggestions.value = aiSuggestions.value.map(suggestion => (
    suggestion.id === id ? { ...suggestion, ...patch } : suggestion
  ))
}

function toggleAutoMode() {
  autoMode.value = !autoMode.value
}

watch(
  () => [store.settings.fontSize, store.settings.tabSize, store.settings.theme],
  () => {
    applyEditorViewSettings(view)
    clampAiSuggestionFrames()
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
  if (!editorHost.value || !editorMount.value) return
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
      flowMapField,
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
          mapAiSuggestionRanges(update)
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

  view = new EditorView({ state, parent: editorMount.value })
  editorScrollElement = view.scrollDOM
  lastEditorScrollTop = editorScrollElement.scrollTop
  lastEditorScrollTime = performance.now()
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

function aiSuggestionFrameBounds() {
  const host = editorHost.value
  const hostRect = host?.getBoundingClientRect()
  const hostWidth = Math.max(1, hostRect?.width ?? window.innerWidth)
  const hostHeight = Math.max(1, hostRect?.height ?? window.innerHeight)
  const margin = Math.max(AI_POPOVER_MIN_MARGIN, Math.round(store.settings.fontSize * 0.7))
  const availableWidth = Math.max(1, hostWidth - margin * 2)
  const availableHeight = Math.max(1, hostHeight - margin * 2)
  const minWidth = Math.min(AI_POPOVER_MIN_WIDTH, Math.max(320, availableWidth))
  const minHeight = Math.min(AI_POPOVER_MIN_HEIGHT, Math.max(220, availableHeight))
  return {
    hostWidth,
    hostHeight,
    margin,
    minWidth,
    minHeight,
    maxWidth: Math.max(minWidth, availableWidth),
    maxHeight: Math.max(minHeight, availableHeight),
  }
}

function defaultAiSuggestionSize(): Pick<AiSuggestionFrame, 'width' | 'height'> {
  const bounds = aiSuggestionFrameBounds()
  return {
    width: Math.min(
      bounds.maxWidth,
      Math.max(bounds.minWidth, Math.round(store.settings.fontSize * AI_POPOVER_WIDTH_FACTOR)),
    ),
    height: Math.min(
      bounds.maxHeight,
      Math.max(bounds.minHeight, Math.round(store.settings.fontSize * AI_POPOVER_HEIGHT_FACTOR)),
    ),
  }
}

function loadingAiSuggestionInset(bounds: ReturnType<typeof aiSuggestionFrameBounds>) {
  return Math.min(
    Math.max(bounds.margin * 2, 20),
    Math.floor(Math.min(bounds.hostWidth, bounds.hostHeight) / 3),
  )
}

function loadingAiSuggestionSize(): Pick<AiSuggestionFrame, 'width' | 'height'> {
  const bounds = aiSuggestionFrameBounds()
  const inset = loadingAiSuggestionInset(bounds)
  const availableWidth = Math.max(1, bounds.hostWidth - inset * 2)
  const headerHeight = Math.min(
    44,
    Math.max(36, store.settings.fontSize * 2.3),
  )
  const loadingRowHeight = Math.min(
    56,
    Math.max(44, store.settings.fontSize * 2.9),
  )
  // Reserve space for the popover border as well as both fixed-height rows.
  const requiredHeight = Math.ceil(headerHeight + loadingRowHeight + 2)
  return {
    width: Math.min(
      availableWidth,
      AI_LOADING_POPOVER_MAX_WIDTH,
      Math.max(AI_LOADING_POPOVER_MIN_WIDTH, Math.round(store.settings.fontSize * 22)),
    ),
    height: Math.min(
      Math.max(1, bounds.hostHeight - inset * 2),
      AI_LOADING_POPOVER_MAX_HEIGHT,
      Math.max(AI_LOADING_POPOVER_MIN_HEIGHT, requiredHeight),
    ),
  }
}

function clampAiSuggestionFrame(frame: AiSuggestionFrame): AiSuggestionFrame {
  const bounds = aiSuggestionFrameBounds()
  const width = Math.min(Math.max(frame.width, bounds.minWidth), bounds.maxWidth)
  const height = Math.min(Math.max(frame.height, bounds.minHeight), bounds.maxHeight)
  const minLeft = bounds.margin
  const minTop = bounds.margin
  const maxLeft = Math.max(minLeft, bounds.hostWidth - width - bounds.margin)
  const maxTop = Math.max(minTop, bounds.hostHeight - height - bounds.margin)
  return {
    top: Math.min(Math.max(frame.top, minTop), maxTop),
    left: Math.min(Math.max(frame.left, minLeft), maxLeft),
    width,
    height,
  }
}

function aiSuggestionAnchorPosition(editor: EditorView, from: number) {
  const host = editorHost.value
  if (!host || !editor.visibleRanges.some(range => range.from <= from && from <= range.to)) return null
  const coords = editor.coordsAtPos(from)
  if (!coords) return null
  const scrollerRect = editor.scrollDOM.getBoundingClientRect()
  // coordsAtPos can resolve positions just outside CodeMirror's rendered
  // viewport. Treat those anchors as offscreen so a completed card never
  // reappears at a clamped viewport edge after the user has scrolled away.
  if (coords.bottom <= scrollerRect.top || coords.top >= scrollerRect.bottom) return null
  const hostRect = host.getBoundingClientRect()
  return {
    top: coords.bottom - hostRect.top,
    left: coords.left - hostRect.left,
  }
}

function loadingAiSuggestionPosition(editor: EditorView, from: number, width: number) {
  const bounds = aiSuggestionFrameBounds()
  const anchor = aiSuggestionAnchorPosition(editor, from)
  const inset = loadingAiSuggestionInset(bounds)
  const left = Math.min(
    Math.max(inset, (bounds.hostWidth - width) / 2),
    Math.max(inset, bounds.hostWidth - width - inset),
  )
  return {
    top: Math.max(inset, (anchor?.top ?? inset) + bounds.margin),
    left,
  }
}

function clampLoadingAiSuggestionFrame(frame: AiSuggestionFrame): AiSuggestionFrame {
  const bounds = aiSuggestionFrameBounds()
  const inset = loadingAiSuggestionInset(bounds)
  const maxWidth = Math.max(1, bounds.hostWidth - inset * 2)
  const maxHeight = Math.max(1, bounds.hostHeight - inset * 2)
  const width = Math.min(Math.max(1, frame.width), maxWidth)
  const height = Math.min(Math.max(1, frame.height), maxHeight)
  return {
    top: Math.min(Math.max(frame.top, inset), Math.max(inset, bounds.hostHeight - height - inset)),
    left: Math.min(Math.max(frame.left, inset), Math.max(inset, bounds.hostWidth - width - inset)),
    width,
    height,
  }
}

function syncAiSuggestionPositions(editor = view) {
  if (!editor || aiSuggestions.value.length === 0) return
  aiSuggestions.value = aiSuggestions.value.map(suggestion => {
    const anchor = aiSuggestionAnchorPosition(editor, suggestion.from)
    if (!anchor) return { ...suggestion, visible: false }
    const frame = {
      top: anchor.top + suggestion.anchorOffsetTop,
      left: anchor.left + suggestion.anchorOffsetLeft,
      width: suggestion.width,
      height: suggestion.height,
    }
    return {
      ...suggestion,
      ...frame,
      visible: true,
    }
  })
}

function updateAiSuggestionFrame(id: string, frame: AiSuggestionFrame) {
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion) return
  const nextFrame = suggestion.status === 'generating'
    ? clampLoadingAiSuggestionFrame(frame)
    : clampAiSuggestionFrame(frame)
  const anchor = view ? aiSuggestionAnchorPosition(view, suggestion.from) : null
  updateAiSuggestion(id, {
    ...nextFrame,
    visible: Boolean(anchor),
    anchorOffsetTop: anchor ? nextFrame.top - anchor.top : suggestion.anchorOffsetTop,
    anchorOffsetLeft: anchor ? nextFrame.left - anchor.left : suggestion.anchorOffsetLeft,
  })
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

function createAiSuggestionCard(
  editor: EditorView,
  source: ReturnType<typeof aiSourceForEditor>,
  mode: AiCompletionMode,
  instruction = '',
  presentation: AiSuggestionPresentation = 'diff',
) {
  if (!source.range) return null
  const size = loadingAiSuggestionSize()
  const position = loadingAiSuggestionPosition(editor, source.range.from, size.width)
  const frame = clampLoadingAiSuggestionFrame({ ...position, ...size })
  const anchor = aiSuggestionAnchorPosition(editor, source.range.from)
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `ai-${Date.now()}-${Math.random().toString(16).slice(2)}`
  const suggestion: AiSuggestionCard = {
    id,
    mode,
    presentation,
    status: 'generating',
    sourceText: source.input,
    instruction,
    language: source.language,
    sourceDirty: false,
    content: '',
    message: mode === 'extract-todos' ? '提取 Todo 中' : presentation === 'answer' ? '正在回答' : '优化表述中',
    from: source.range.from,
    to: source.range.to,
    scope: source.scope,
    anchorOffsetTop: frame.top - (anchor?.top ?? 0),
    anchorOffsetLeft: frame.left - (anchor?.left ?? 0),
    visible: Boolean(anchor),
    ...frame,
  }
  aiSuggestions.value = [...aiSuggestions.value, suggestion]
  return suggestion
}

function expandedAiSuggestionFrame(suggestion: AiSuggestionCard) {
  const size = defaultAiSuggestionSize()
  // Expand around the compact loading card instead of jumping back to the text anchor.
  const topDelta = (suggestion.height - size.height) / 2
  const leftDelta = (suggestion.width - size.width) / 2
  const unboundedFrame = {
    top: suggestion.top + topDelta,
    left: suggestion.left + leftDelta,
    ...size,
  }
  const anchor = view ? aiSuggestionAnchorPosition(view, suggestion.from) : null
  const frame = anchor ? clampAiSuggestionFrame(unboundedFrame) : unboundedFrame
  return {
    ...frame,
    // Completion must remain attached to the original source range. When the
    // source is outside the viewport, keep the card hidden until it returns.
    visible: Boolean(anchor),
    anchorOffsetTop: anchor ? frame.top - anchor.top : suggestion.anchorOffsetTop + topDelta,
    anchorOffsetLeft: anchor ? frame.left - anchor.left : suggestion.anchorOffsetLeft + leftDelta,
  }
}

function completeAiSuggestion(id: string, content: string) {
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion) return false
  const cleanContent = sanitizeAiBlockContent(content)
  if (!cleanContent) {
    updateAiSuggestion(id, {
      ...expandedAiSuggestionFrame(suggestion),
      status: 'error',
      message: suggestion.presentation === 'answer' ? '没有可展示的回答' : '没有可展示的建议',
      content: '',
    })
    return false
  }
  updateAiSuggestion(id, {
    ...expandedAiSuggestionFrame(suggestion),
    status: 'ready',
    message: suggestion.presentation === 'answer' ? '已生成回答' : '已生成建议',
    content: cleanContent,
  })
  return true
}

function failAiSuggestion(id: string, message: string) {
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion) return
  updateAiSuggestion(id, {
    ...expandedAiSuggestionFrame(suggestion),
    status: 'error',
    message,
  })
}

function markAiSuggestionStale(id: string) {
  updateAiSuggestion(id, {
    status: 'stale',
    message: '原文已变化，请复制、插入新块或回到原文后重新生成',
  })
}

function resetAiSuggestionForRetry(suggestion: AiSuggestionCard) {
  if (!view) return null
  if (!sourceStillMatchesSuggestion(suggestion)) {
    markAiSuggestionStale(suggestion.id)
    setAiStatus('AI：原文已变化，请回到原文后重新生成')
    return null
  }

  const size = loadingAiSuggestionSize()
  const position = loadingAiSuggestionPosition(view, suggestion.from, size.width)
  const frame = clampLoadingAiSuggestionFrame({ ...position, ...size })
  const anchor = aiSuggestionAnchorPosition(view, suggestion.from)
  updateAiSuggestion(suggestion.id, {
    ...frame,
    status: 'generating',
    sourceDirty: false,
    content: '',
    message: suggestion.mode === 'extract-todos'
      ? '提取 Todo 中'
      : suggestion.presentation === 'answer'
        ? '正在回答'
        : '优化表述中',
    visible: Boolean(anchor),
    anchorOffsetTop: anchor ? frame.top - anchor.top : suggestion.anchorOffsetTop,
    anchorOffsetLeft: anchor ? frame.left - anchor.left : suggestion.anchorOffsetLeft,
  })
  return aiSuggestions.value.find(item => item.id === suggestion.id) ?? null
}

function aiSuggestionDiff(suggestion: AiSuggestionCard) {
  if (suggestion.presentation !== 'diff' || !suggestion.content) return null
  return buildAiSuggestionDiff(suggestion.sourceText, suggestion.content)
}

function sourceStillMatchesSuggestion(suggestion: AiSuggestionCard) {
  if (!view) return false
  if (suggestion.sourceDirty) return false
  if (suggestion.from < 0 || suggestion.to > view.state.doc.length || suggestion.from > suggestion.to) return false
  return view.state.doc.sliceString(suggestion.from, suggestion.to) === suggestion.sourceText
}

function replaceWithAiSuggestion(id: string) {
  if (!view) return
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion || suggestion.status !== 'ready') return
  if (!sourceStillMatchesSuggestion(suggestion)) {
    markAiSuggestionStale(id)
    setAiStatus('AI：原文已变化，未替换', true)
    return
  }
  if (!snapshotCurrentSync('ai-polish-replace')) return
  view.dispatch({
    changes: { from: suggestion.from, to: suggestion.to, insert: suggestion.content },
    selection: EditorSelection.cursor(suggestion.from + suggestion.content.length),
    annotations: internalBlockEdit.of(true),
    scrollIntoView: true,
  })
  dismissAiSuggestion(id)
  view.focus()
  updateStatus(view)
  scheduleSave()
  setAiStatus('AI：已替换原文', true)
}

function insertAiSuggestionAsBlock(id: string) {
  if (!view) return
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion || !suggestion.content || suggestion.status === 'generating') return
  const content = suggestion.content
  if (!snapshotCurrentSync('ai-polish-insert-block')) return
  if (insertAiBlockAfterCurrent(view, content)) {
    dismissAiSuggestion(id)
    setAiStatus('AI：已插入新块', true)
  } else {
    setAiStatus('AI：没有可插入内容')
  }
}

async function copyAiSuggestion(id: string) {
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion?.content) return
  try {
    await navigator.clipboard.writeText(suggestion.content)
    setAiStatus('AI：已复制建议', true)
  } catch {
    setAiStatus('AI：复制失败')
  }
}

function gotoAiSuggestionSource(id: string) {
  if (!view) return
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion) return
  const from = Math.max(0, Math.min(suggestion.from, view.state.doc.length))
  const to = Math.max(from, Math.min(suggestion.to, view.state.doc.length))
  view.dispatch({
    selection: suggestion.scope === 'selection'
      ? EditorSelection.range(from, to)
      : EditorSelection.cursor(from),
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  })
  view.focus()
}

function mapAiSuggestionRanges(update: ViewUpdate) {
  if (aiSuggestions.value.length === 0) return
  aiSuggestions.value = aiSuggestions.value.map(suggestion => {
    let sourceChanged = false
    update.changes.iterChangedRanges((fromA, toA) => {
      if (sourceChanged) return
      if (fromA === toA) {
        sourceChanged = fromA >= suggestion.from && fromA <= suggestion.to
        return
      }
      sourceChanged = fromA < suggestion.to && toA > suggestion.from
    })
    return {
      ...suggestion,
      sourceDirty: suggestion.sourceDirty || sourceChanged,
      from: update.changes.mapPos(suggestion.from, 1),
      to: update.changes.mapPos(suggestion.to, -1),
    }
  })
  syncAiSuggestionPositions(update.view)
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
    updateAiQuickActions(editor)
  })
}

function hideAiQuickActions() {
  if (!aiQuickActions.value.visible) return
  aiQuickActions.value = { ...aiQuickActions.value, visible: false }
}

function preserveAiQuickActionSelection(event: MouseEvent) {
  if (event.target instanceof HTMLInputElement) return
  event.preventDefault()
}

function updateAiQuickActions(editor: EditorView | null) {
  const quickEditorHasFocus = aiQuickActions.value.editing
    && document.activeElement === aiQuickEditorInput.value
  if (
    !editor ||
    !editorHost.value ||
    (!editor.hasFocus && !quickEditorHasFocus) ||
    !store.settings.ai.enabled ||
    !store.settings.ai.hasApiKey
  ) {
    hideAiQuickActions()
    return
  }

  const range = visibleSelectionRange(editor)
  if (!range) {
    hideAiQuickActions()
    return
  }

  const selectionIsVisible = editor.visibleRanges.some(visible =>
    visible.to >= range.from && visible.from <= range.to,
  )
  const startCoords = editor.coordsAtPos(range.from, -1)
  const endCoords = editor.coordsAtPos(range.to, -1)
  if (!selectionIsVisible || !startCoords || !endCoords) {
    hideAiQuickActions()
    return
  }

  const hostRect = editorHost.value.getBoundingClientRect()
  const left = hostRect.width / 2
  const requiredAboveSpace = AI_QUICK_ACTIONS_HEIGHT + AI_QUICK_ACTIONS_MARGIN + AI_QUICK_EDITOR_GAP + AI_QUICK_EDITOR_HEIGHT
  const placement = startCoords.top - hostRect.top >= requiredAboveSpace ? 'above' : 'below'
  const top = placement === 'above'
    ? startCoords.top - hostRect.top - AI_QUICK_ACTIONS_HEIGHT - AI_QUICK_ACTIONS_MARGIN
    : Math.min(
        hostRect.height - AI_QUICK_ACTIONS_HEIGHT - AI_QUICK_ACTIONS_MARGIN,
        endCoords.bottom - hostRect.top + AI_QUICK_ACTIONS_MARGIN,
      )
  const rangeKey = `${range.from}:${range.to}`
  const keepsEditorState = aiQuickActions.value.range === rangeKey

  aiQuickActions.value = {
    ...aiQuickActions.value,
    visible: true,
    top: Math.max(AI_QUICK_ACTIONS_MARGIN, top),
    left,
    placement,
    range: rangeKey,
    editing: keepsEditorState ? aiQuickActions.value.editing : false,
    instruction: keepsEditorState ? aiQuickActions.value.instruction : '',
  }
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
  updateScrollJump()
  syncAiSuggestionPositions()
  scheduleBlockToolbarUpdate()
}

function updateScrollJump() {
  const scroller = editorScrollElement
  if (!scroller) return

  const now = performance.now()
  const scrollTop = scroller.scrollTop
  const delta = scrollTop - lastEditorScrollTop
  const elapsed = Math.max(1, now - lastEditorScrollTime)
  const distance = Math.abs(delta)
  const velocity = distance / elapsed
  const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)

  lastEditorScrollTop = scrollTop
  lastEditorScrollTime = now

  if (distance < SCROLL_JUMP_MIN_DELTA) return

  const target: ScrollJumpTarget = delta < 0 ? 'top' : 'bottom'
  const atTarget = target === 'top'
    ? scrollTop <= SCROLL_JUMP_EDGE_TOLERANCE
    : maxScrollTop - scrollTop <= SCROLL_JUMP_EDGE_TOLERANCE

  if (atTarget) {
    hideScrollJump()
    return
  }

  if (distance < SCROLL_JUMP_LARGE_DELTA && velocity < SCROLL_JUMP_MIN_VELOCITY) return

  scrollJump.value = { visible: true, target }
  scheduleScrollJumpHide()
}

function scheduleScrollJumpHide() {
  if (scrollJumpHideTimer) window.clearTimeout(scrollJumpHideTimer)
  scrollJumpHideTimer = window.setTimeout(() => {
    scrollJump.value = { ...scrollJump.value, visible: false }
    scrollJumpHideTimer = null
  }, SCROLL_JUMP_HIDE_DELAY)
}

function hideScrollJump() {
  if (scrollJumpHideTimer) {
    window.clearTimeout(scrollJumpHideTimer)
    scrollJumpHideTimer = null
  }
  scrollJump.value = { ...scrollJump.value, visible: false }
}

function jumpEditorScroll() {
  const scroller = editorScrollElement
  if (!scroller) return

  const top = scrollJump.value.target === 'top'
    ? 0
    : Math.max(0, scroller.scrollHeight - scroller.clientHeight)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  hideScrollJump()
  scroller.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' })
}

function onWindowResize() {
  clampAiSuggestionFrames()
  scheduleBlockToolbarUpdate()
}

function clampAiSuggestionFrames() {
  if (aiSuggestions.value.length === 0) return
  aiSuggestions.value.forEach(suggestion => {
    updateAiSuggestionFrame(suggestion.id, clampAiSuggestionFrame(suggestion))
  })
}

function aiSuggestionCurrentFrame(id: string): AiSuggestionFrame | null {
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion) return null
  return {
    top: suggestion.top,
    left: suggestion.left,
    width: suggestion.width,
    height: suggestion.height,
  }
}

function startAiPopoverMove(event: PointerEvent, id: string) {
  if (event.button !== 0) return
  const frame = aiSuggestionCurrentFrame(id)
  if (!frame) return
  event.preventDefault()
  stopAiPopoverInteraction()
  aiPopoverInteraction.value = {
    suggestionId: id,
    type: 'move',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startFrame: frame,
  }
  window.addEventListener('pointermove', onAiPopoverPointerMove)
  window.addEventListener('pointerup', onAiPopoverPointerUp)
  window.addEventListener('pointercancel', onAiPopoverPointerUp)
}

function startAiPopoverResize(event: PointerEvent, id: string) {
  if (event.button !== 0) return
  const frame = aiSuggestionCurrentFrame(id)
  if (!frame) return
  event.preventDefault()
  stopAiPopoverInteraction()
  aiPopoverInteraction.value = {
    suggestionId: id,
    type: 'resize',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startFrame: frame,
  }
  window.addEventListener('pointermove', onAiPopoverPointerMove)
  window.addEventListener('pointerup', onAiPopoverPointerUp)
  window.addEventListener('pointercancel', onAiPopoverPointerUp)
}

function onAiPopoverPointerMove(event: PointerEvent) {
  const interaction = aiPopoverInteraction.value
  if (!interaction || interaction.pointerId !== event.pointerId) return
  event.preventDefault()
  const deltaX = event.clientX - interaction.startX
  const deltaY = event.clientY - interaction.startY
  const nextFrame = interaction.type === 'move'
    ? {
      ...interaction.startFrame,
      left: interaction.startFrame.left + deltaX,
      top: interaction.startFrame.top + deltaY,
    }
    : {
      ...interaction.startFrame,
      width: interaction.startFrame.width + deltaX,
      height: interaction.startFrame.height + deltaY,
    }
  updateAiSuggestionFrame(interaction.suggestionId, nextFrame)
}

function onAiPopoverPointerUp(event: PointerEvent) {
  const interaction = aiPopoverInteraction.value
  if (interaction && interaction.pointerId !== event.pointerId) return
  stopAiPopoverInteraction()
}

function stopAiPopoverInteraction() {
  aiPopoverInteraction.value = null
  window.removeEventListener('pointermove', onAiPopoverPointerMove)
  window.removeEventListener('pointerup', onAiPopoverPointerUp)
  window.removeEventListener('pointercancel', onAiPopoverPointerUp)
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
  note.content = view.state.doc.toString()
  const raw = serializeNote(note)
  store.saveBuffer(editorBufferPath, raw)
    .catch(error => {
      setAiStatus(`保存失败：${error instanceof Error ? error.message : '无法写入文件'}`)
      void store.refreshRecoveries()
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

async function requestAiSuggestion(suggestion: AiSuggestionCard) {
  aiPendingCount.value += 1
  setAiStatus(suggestion.presentation === 'answer' ? 'AI：正在回答' : 'AI：优化表述中')
  try {
    const result = await store.completeWithAi({
      input: suggestion.sourceText,
      language: suggestion.language,
      scope: suggestion.scope,
      mode: suggestion.mode,
      ...(suggestion.instruction ? { instruction: suggestion.instruction } : {}),
      ...(suggestion.presentation === 'answer' ? { intent: 'answer' as const } : {}),
    })
    if (!result.ok) {
      setAiStatus(`AI：${result.message}`)
      failAiSuggestion(suggestion.id, result.message)
      return
    }
    if (!completeAiSuggestion(suggestion.id, result.content)) {
      setAiStatus(suggestion.presentation === 'answer' ? 'AI：没有可展示的回答' : 'AI：没有可展示的建议')
      return
    }
    setAiStatus(suggestion.presentation === 'answer' ? 'AI：已生成回答' : 'AI：已生成建议', true)
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败'
    failAiSuggestion(suggestion.id, message)
    setAiStatus(`AI：${message}`)
  } finally {
    aiPendingCount.value = Math.max(0, aiPendingCount.value - 1)
  }
}

async function retryAiSuggestion(id: string) {
  const suggestion = aiSuggestions.value.find(item => item.id === id)
  if (!suggestion || suggestion.status !== 'error') return
  const retryingSuggestion = resetAiSuggestionForRetry(suggestion)
  if (!retryingSuggestion) return
  await requestAiSuggestion(retryingSuggestion)
}

async function runAiAction(
  mode: AiCompletionMode,
  instruction = '',
  presentation: AiSuggestionPresentation = 'diff',
) {
  if (!view) return

  setAiStatus('')
  const source = aiSourceForEditor(view)
  if (!source.input) {
    setAiStatus('AI：没有可发送内容')
    return
  }

  const suggestion = mode === 'polish'
    ? createAiSuggestionCard(view, source, mode, instruction, presentation)
    : null
  if (mode === 'polish' && !suggestion) {
    setAiStatus('AI：没有可发送内容')
    return
  }

  if (suggestion) {
    await requestAiSuggestion(suggestion)
    return
  }

  aiPendingCount.value += 1
  setAiStatus(mode === 'extract-todos' ? 'AI：提取 Todo 中' : 'AI：优化表述中')
  try {
    const result = await store.completeWithAi({
      input: source.input,
      language: source.language,
      scope: source.scope,
      mode,
      ...(instruction ? { instruction } : {}),
    })
    if (!result.ok) {
      setAiStatus(`AI：${result.message}`)
      return
    }
    if (!snapshotCurrentSync(mode === 'extract-todos' ? 'ai-extract-todos' : 'ai-polish')) return
    if (!insertAiBlockAfterCurrent(view, result.content, { todo: mode === 'extract-todos' })) {
      setAiStatus(mode === 'extract-todos' ? 'AI：没有识别到明确 Todo' : 'AI：没有可插入内容')
      return
    }
    setAiStatus(mode === 'extract-todos' ? 'AI：已插入 Todo' : 'AI：已插入优化版本', true)
  } catch (error) {
    const message = error instanceof Error ? error.message : '请求失败'
    setAiStatus(`AI：${message}`)
  } finally {
    aiPendingCount.value = Math.max(0, aiPendingCount.value - 1)
  }
}

function runAiQuickAction(
  mode: AiCompletionMode,
  instruction = '',
  presentation: AiSuggestionPresentation = 'diff',
) {
  hideAiQuickActions()
  return runAiAction(mode, instruction, presentation)
}

async function openAiQuickEditor() {
  aiQuickActions.value = { ...aiQuickActions.value, editing: true }
  await nextTick()
  aiQuickEditorInput.value?.focus()
}

function closeAiQuickEditor() {
  aiQuickActions.value = { ...aiQuickActions.value, editing: false, instruction: '' }
}

function customAiPresentation(instruction: string): AiSuggestionPresentation {
  const questionPattern = /[?？]|你觉得|你认为|怎么看|写得怎么样|为什么|怎么(?:样|办)|如何|是否|能不能|可以吗|请问|分析(?:一下)?|评价(?:一下)?|评估(?:一下)?|解释(?:一下)?|有什么问题/u
  return questionPattern.test(instruction) ? 'answer' : 'diff'
}

function submitAiQuickEditor() {
  const instruction = aiQuickActions.value.instruction.trim()
  if (!instruction) {
    aiQuickEditorInput.value?.focus()
    return
  }
  return runAiQuickAction('polish', instruction, customAiPresentation(instruction))
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
      <div ref="editorMount" class="editor-mount" />
      <Transition name="scroll-jump">
        <button
          v-if="scrollJump.visible"
          type="button"
          class="scroll-jump-button"
          :title="scrollJump.target === 'top' ? '回到顶部' : '直达底部'"
          :aria-label="scrollJump.target === 'top' ? '回到顶部' : '直达底部'"
          :data-tooltip="scrollJump.target === 'top' ? '回到顶部' : '直达底部'"
          @mousedown.prevent
          @click="jumpEditorScroll"
        >
          <ArrowUpToLine v-if="scrollJump.target === 'top'" :size="16" />
          <ArrowDownToLine v-else :size="16" />
        </button>
      </Transition>
      <div
        v-if="aiQuickActions.visible"
        class="ai-quick-actions"
        :class="{ 'is-below': aiQuickActions.placement === 'below' }"
        :style="{
          top: `${aiQuickActions.top}px`,
          left: `${aiQuickActions.left}px`,
          transform: 'translateX(-50%)',
        }"
        role="toolbar"
        aria-label="AI 快捷操作"
        @mousedown="preserveAiQuickActionSelection"
      >
        <form
          v-if="aiQuickActions.editing"
          class="ai-quick-editor"
          aria-label="自定义编辑要求"
          @submit.prevent="submitAiQuickEditor"
        >
          <input
            ref="aiQuickEditorInput"
            v-model="aiQuickActions.instruction"
            type="text"
            placeholder="描述如何修改，或直接提问"
            aria-label="自定义修改或提问"
            @keydown.esc.prevent="closeAiQuickEditor"
          />
          <button type="submit" title="提交编辑要求" aria-label="提交编辑要求">
            <ArrowUp :size="15" />
          </button>
        </form>
        <button
          type="button"
          title="自定义修改或提问"
          @click="openAiQuickEditor"
        >
          <Pencil :size="14" />
          编辑
        </button>
        <span aria-hidden="true" />
        <button
          type="button"
          title="改写选区并查看差异"
          @click="runAiQuickAction('polish')"
        >
          <Sparkles :size="14" />
          改写
        </button>
        <span aria-hidden="true" />
        <button
          type="button"
          title="从选区提取可执行 Todo"
          @click="runAiQuickAction('extract-todos')"
        >
          <ListTodo :size="14" />
          提取 Todo
        </button>
      </div>
      <aside
        v-for="suggestion in aiSuggestions"
        :key="suggestion.id"
        class="ai-suggestion-popover"
        :class="{
          moving: aiPopoverInteraction?.suggestionId === suggestion.id && aiPopoverInteraction?.type === 'move',
          resizing: aiPopoverInteraction?.suggestionId === suggestion.id && aiPopoverInteraction?.type === 'resize',
          loading: suggestion.status === 'generating',
          answer: suggestion.presentation === 'answer',
          hidden: !suggestion.visible,
        }"
        :style="{
          '--editor-font-size': `${store.settings.fontSize}px`,
          top: `${suggestion.top}px`,
          left: `${suggestion.left}px`,
          width: `${suggestion.width}px`,
          height: `${suggestion.height}px`,
        }"
        aria-label="AI 表述优化建议"
        @mousedown.stop
      >
        <header class="ai-suggestion-header" title="拖动建议窗口" @pointerdown="startAiPopoverMove($event, suggestion.id)">
          <div>
            <strong>{{ suggestion.presentation === 'answer' ? 'AI 回复' : 'AI 建议' }}</strong>
            <span>
              {{ suggestion.presentation === 'answer'
                ? suggestion.scope === 'selection' ? '针对选区' : '针对当前块'
                : suggestion.scope === 'selection' ? '表述优化 / 选区' : '表述优化 / 当前块' }}
            </span>
          </div>
          <button
            type="button"
            class="ai-suggestion-close"
            title="关闭建议"
            @pointerdown.stop
            @click="dismissAiSuggestion(suggestion.id)"
          >
            <X :size="14" />
          </button>
        </header>
        <div v-if="suggestion.status === 'generating'" class="ai-suggestion-loading" role="status" aria-live="polite">
          <span class="ai-suggestion-spinner" aria-hidden="true" />
          <span>{{ suggestion.message || '正在生成建议' }}</span>
        </div>
        <template v-else>
          <div v-if="suggestion.status === 'error'" class="ai-suggestion-error-state">
            <strong>AI：{{ suggestion.message || '请求失败' }}</strong>
            <span>请检查网络和 API 设置后重试，原文不会被修改。</span>
          </div>
          <template v-else-if="suggestion.presentation === 'answer'">
            <div class="ai-answer-body">
              <p>{{ suggestion.content }}</p>
            </div>
          </template>
          <template v-else>
            <p v-if="suggestion.status === 'stale'" class="ai-suggestion-message stale">
              {{ suggestion.message || '原文已经变化，请回到原文确认后再替换。' }}
            </p>
            <p v-if="aiSuggestionDiff(suggestion) && !aiSuggestionDiff(suggestion)?.changed" class="ai-suggestion-empty-diff">
              AI 返回内容与原文基本一致，未检测到文字差异。
            </p>
            <div class="ai-suggestion-body">
            <div class="ai-suggestion-column">
              <span>原文</span>
              <div class="ai-diff-lines" data-testid="ai-diff-source">
                <div
                  v-for="line in aiSuggestionDiff(suggestion)?.sourceLines || []"
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
                  v-for="line in aiSuggestionDiff(suggestion)?.targetLines || []"
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
          </template>
          <footer class="ai-suggestion-actions">
            <span class="ai-suggestion-status">{{ suggestion.message || (suggestion.status === 'ready' ? '已生成建议' : '等待中') }}</span>
            <button
              type="button"
              class="ghost-button compact"
              title="回到这条建议对应的原文"
              @click="gotoAiSuggestionSource(suggestion.id)"
            >
              回到原文
            </button>
            <button
              v-if="suggestion.status === 'error'"
              type="button"
              class="primary-button"
              title="重新生成这条建议"
              @click="retryAiSuggestion(suggestion.id)"
            >
              重试
            </button>
            <button
              v-else-if="suggestion.presentation === 'diff'"
              type="button"
              class="primary-button"
              title="用优化后的内容替换原文"
              :disabled="suggestion.status !== 'ready'"
              @click="replaceWithAiSuggestion(suggestion.id)"
            >
              替换原文
            </button>
            <button
              type="button"
              class="secondary-button"
              title="将优化后的内容插入为新块"
              :disabled="!suggestion.content.trim()"
              @click="insertAiSuggestionAsBlock(suggestion.id)"
            >
              插入新块
            </button>
            <button
              type="button"
              class="ghost-button compact"
              title="复制优化后的内容"
              :disabled="!suggestion.content.trim()"
              @click="copyAiSuggestion(suggestion.id)"
            >
              <Copy :size="13" />
              复制
            </button>
          </footer>
          <span class="ai-suggestion-resize-handle" title="调整建议窗口大小" @pointerdown.stop="startAiPopoverResize($event, suggestion.id)" />
        </template>
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
          :disabled="!store.settings.ai.enabled || !store.settings.ai.hasApiKey"
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
          :disabled="!store.settings.ai.enabled || !store.settings.ai.hasApiKey"
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
