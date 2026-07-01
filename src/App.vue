<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import EditorPane from './components/EditorPane.vue'
import { useWorkspaceStore } from './stores/workspace'

const store = useWorkspaceStore()
const showSettings = ref(false)

onMounted(async () => {
  await store.init()
})
</script>

<template>
  <div class="app-shell">
    <main class="main-area">
      <header class="windowbar">
        <div class="window-title">{{ store.currentPath ? store.bufferTitle(store.currentPath) : 'Vibenote' }}</div>
      </header>

      <EditorPane v-if="store.currentPath" :key="store.currentPath" @open-settings="showSettings = true" />
    </main>

    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <section class="settings-panel">
        <header>
          <h2>Settings</h2>
          <button class="icon-button" title="Close settings" @click="showSettings = false">
            <X :size="16" />
          </button>
        </header>
        <label>
          Theme
          <select v-model="store.settings.theme" @change="store.saveSettings">
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label>
          Font size
          <input
            v-model.number="store.settings.fontSize"
            type="number"
            min="11"
            max="22"
            @change="store.saveSettings"
          />
        </label>
        <label>
          Tab size
          <input
            v-model.number="store.settings.tabSize"
            type="number"
            min="2"
            max="8"
            @change="store.saveSettings"
          />
        </label>
        <label>
          Default language
          <select v-model="store.settings.defaultLanguage" @change="store.saveSettings">
            <option value="text">Text</option>
            <option value="markdown">Markdown</option>
            <option value="json">JSON</option>
            <option value="javascript">JavaScript</option>
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
            <option value="sql">SQL</option>
            <option value="math">Math</option>
          </select>
        </label>
      </section>
    </div>
  </div>
</template>
