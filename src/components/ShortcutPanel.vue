<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { Search, X } from 'lucide-vue-next'
import { shortcutGroups, shortcuts } from '../common/shortcuts'

const emit = defineEmits<{
  (event: 'close'): void
}>()
const query = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const visibleGroups = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return shortcutGroups.map(group => ({
    group,
    shortcuts: shortcuts.filter((shortcut) => {
      if (shortcut.group !== group) return false
      if (!needle) return true
      return `${shortcut.group} ${shortcut.label} ${shortcut.keys.join(' ')}`.toLocaleLowerCase().includes(needle)
    }),
  })).filter(section => section.shortcuts.length > 0)
})

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  void nextTick(() => searchInput.value?.focus())
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <section
    class="shortcut-panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="shortcut-panel-title"
  >
    <header>
      <h2 id="shortcut-panel-title">快捷键</h2>
      <button class="icon-button" title="关闭快捷键" aria-label="关闭快捷键" @click="$emit('close')">
        <X :size="16" />
      </button>
    </header>
    <label class="shortcut-search">
      <Search :size="15" aria-hidden="true" />
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        aria-label="搜索快捷键"
        placeholder="搜索功能或按键"
      />
    </label>
    <div class="shortcut-sections">
      <section v-for="section in visibleGroups" :key="section.group" class="shortcut-section">
        <h3>{{ section.group }}</h3>
        <div class="shortcut-list">
          <div v-for="shortcut in section.shortcuts" :key="shortcut.id" class="shortcut-row">
            <span>{{ shortcut.label }}</span>
            <span class="shortcut-keys">
              <kbd v-for="keys in shortcut.keys" :key="keys">{{ keys }}</kbd>
            </span>
          </div>
        </div>
      </section>
      <p v-if="visibleGroups.length === 0" class="shortcut-empty">没有匹配的快捷键</p>
    </div>
  </section>
</template>
