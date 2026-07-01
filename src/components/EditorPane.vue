<script setup lang="ts">
import { EditorSelection, EditorState } from '@codemirror/state'
import { addCursorAbove, addCursorBelow, defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { lineNumbers, keymap, drawSelection, highlightActiveLine, EditorView } from '@codemirror/view'
import { searchKeymap } from '@codemirror/search'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Code2, FilePlus2, Keyboard, Settings, Trash2, Wand2 } from 'lucide-vue-next'
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
  insertBlock,
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
import { richDecorations } from '../editor/richDecorations'
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
let view: EditorView | null = null
let note: LoadedNote | null = null
let saveTimer: number | null = null
let unsubscribeEditorCommand: (() => void) | null = null

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

const cursorStatus = computed(() => {
  const [line = '1', column = '1'] = cursorLabel.value.split(':')
  return `Ln ${line} Col ${column}`
})

const shortcutSummary = '⌘↵ New · ⌥↵ Before · ⇧⌘↵ End · ⇧⌥F Format'
const shortcutTitle = [
  'Cmd/Ctrl+Enter: new block after current',
  'Alt+Enter: new block before current',
  'Cmd/Ctrl+Alt+Enter: split current block',
  'Cmd/Ctrl+Shift+D: delete current block',
  'Cmd/Ctrl+Up/Down: move between blocks',
  'Shift+Alt+F: format current block',
].join('\n')

onMounted(() => {
  mountEditor()
  unsubscribeEditorCommand = window.vibenote.commands.onEditorCommand(onEditorCommand)
  window.addEventListener('vibenote:goto-line', onGotoLine as EventListener)
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('beforeunload', flushSaveSync)
  window.addEventListener('pagehide', flushSaveSync)
})

onBeforeUnmount(() => {
  flushSaveSync()
  unsubscribeEditorCommand?.()
  unsubscribeEditorCommand = null
  window.removeEventListener('vibenote:goto-line', onGotoLine as EventListener)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('beforeunload', flushSaveSync)
  window.removeEventListener('pagehide', flushSaveSync)
  view?.destroy()
  view = null
})

watch(
  () => [store.settings.fontSize, store.settings.tabSize, store.settings.theme],
  () => {
    view?.dom.style.setProperty('--editor-font-size', `${store.settings.fontSize}px`)
    view?.dom.classList.toggle('dark-editor', store.settings.theme === 'dark')
  },
)

function mountEditor() {
  if (!editorHost.value) return
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
        { key: 'Backspace', run: removeBlankBlockFromDeleteKey },
        { key: 'Delete', run: removeBlankBlockFromDeleteKey },
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
        },
        '.cm-lineNumbers .cm-gutterElement': {
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          minWidth: '44px',
          padding: '0 10px 0 8px',
          textAlign: 'right',
        },
        '.cm-lineNumbers': {
          minWidth: '44px',
        },
        '.cm-activeLine': {
          backgroundColor: 'oklch(95.5% 0.01 228)',
        },
        '.cm-activeLineGutter': {
          backgroundColor: 'oklch(95.5% 0.01 228)',
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
        '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
          backgroundColor: 'oklch(80.5% 0.058 252 / 0.62)',
        },
      }),
      blockField,
      blockDecorations,
      blockGutterDecorations,
      richDecorations,
      protectDelimiters,
      delimiterChangeProtection,
      autoDetectPlugin,
      EditorView.domEventHandlers({
        keydown(event, view) {
          return handleEditorShortcut(event, view)
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
          if (!image) return false
          event.preventDefault()
          const file = image.getAsFile()
          if (!file) return true
          file.arrayBuffer().then(async data => {
            const url = await window.vibenote.image.save({ mime: file.type, data })
            view.dispatch(view.state.replaceSelection(`![image](${url})`))
            scheduleSave()
          })
          return true
        },
      }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          scheduleSave()
        }
        if (update.docChanged || update.selectionSet) {
          if (normalizeSelectionToBlockContent(update.view)) return
          updateStatus(update.view)
        }
      }),
    ],
  })

  view = new EditorView({ state, parent: editorHost.value })
  view.dom.style.setProperty('--editor-font-size', `${store.settings.fontSize}px`)
  view.dom.classList.toggle('dark-editor', store.settings.theme === 'dark')
  moveCursorToEditableContent(view)
  updateStatus(view)
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

function copyVisibleSelection(event: ClipboardEvent, editor: EditorView) {
  const text = visibleSelectionText(editor)
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
  const text = visibleSelectionText(editor)
  if (text === null) return false

  event.clipboardData?.setData('text/plain', text)
  event.preventDefault()

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
  store.saveCurrent(raw).finally(() => {
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
  store.saveCurrentSync(serializeNote(note))
  saving.value = false
}

function addBlock() {
  if (!view) return
  insertBlock(view, store.settings.defaultLanguage, true)
  scheduleSave()
}

function removeBlock() {
  if (!view) return
  removeBlockFromKeymap(view)
}

function removeBlockFromKeymap(editor: EditorView) {
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

function handleEditorShortcut(event: KeyboardEvent, editor: EditorView) {
  const primary = event.metaKey || event.ctrlKey
  const key = event.key.toLowerCase()
  let handled = false

  if ((key === 'backspace' || key === 'delete') && removeBlankBlockFromDeleteKey(editor)) {
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
  } else if (key === 'f' && event.altKey && event.shiftKey) {
    handled = formatBlockFromKeymap()
  }

  if (handled) {
    event.preventDefault()
    event.stopPropagation()
  }
  return handled
}

function runEditorCommand(command: EditorCommand, editor: EditorView) {
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
  return false
}

function onEditorCommand(command: EditorCommand) {
  if (!view) return
  runEditorCommand(command, view)
}

function onWindowKeydown(event: KeyboardEvent) {
  if (!view || event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  const hasEditorModifier = event.metaKey || event.ctrlKey || event.altKey
  if (!hasEditorModifier && target?.closest('input, select, textarea, button')) return
  handleEditorShortcut(event, view)
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
    <div ref="editorHost" class="editor-host" @mousedown.self="focusEditorContent"></div>

    <footer class="statusbar">
      <div class="statusbar-left">
        <span class="status-pill strong">{{ cursorStatus }}</span>
        <label class="status-control" title="Current block language (Cmd/Ctrl+L)">
          <Code2 :size="14" />
          <select ref="languageSelect" v-model="activeLanguage" aria-label="Current block language">
            <option v-for="language in languages" :key="language.token" :value="language.token">
              {{ language.name }}
            </option>
          </select>
        </label>
        <label class="status-toggle" title="Auto detect language for current block">
          <input v-model="autoMode" type="checkbox" />
          <span>{{ currentBlock?.auto ? 'Auto' : 'Manual' }}</span>
        </label>
        <span class="status-pill">{{ saving ? 'Saving' : 'Saved' }}</span>
      </div>

      <div class="statusbar-center" :title="shortcutTitle">
        <Keyboard :size="14" />
        <span>{{ shortcutSummary }}</span>
      </div>

      <div class="statusbar-actions">
        <button class="status-icon-button" title="New block after current (Cmd/Ctrl+Enter)" @click="addBlock">
          <FilePlus2 :size="15" />
        </button>
        <button class="status-icon-button" title="Format current block (Shift+Alt+F)" @click="formatBlock">
          <Wand2 :size="15" />
        </button>
        <button class="status-icon-button danger" title="Delete current block (Cmd/Ctrl+Shift+D)" @click="removeBlock">
          <Trash2 :size="15" />
        </button>
        <button class="status-icon-button" title="Settings" @click="emit('open-settings')">
          <Settings :size="15" />
        </button>
      </div>
    </footer>
  </section>
</template>
