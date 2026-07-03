<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import EditorPane from './components/EditorPane.vue'
import { useWorkspaceStore } from './stores/workspace'

const store = useWorkspaceStore()
const showSettings = ref(false)
const apiKeyDraft = ref('')
const apiKeyStatus = ref('')
const connectionStatus = ref('')

const aiProviderDefaults = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
  },
  'custom-openai-compatible': {
    baseUrl: '',
    model: '',
  },
} satisfies Record<AiProviderKind, { baseUrl: string; model: string }>

onMounted(async () => {
  await store.init()
})

function onAiProviderChange() {
  const defaults = aiProviderDefaults[store.settings.ai.provider]
  if (defaults.baseUrl) store.settings.ai.baseUrl = defaults.baseUrl
  if (defaults.model) store.settings.ai.model = defaults.model
  store.saveSettings()
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error || 'Unknown error')
}

function apiKeySavedMessage() {
  if (!store.settings.ai.hasApiKey) return 'No API key saved'
  if (store.settings.ai.keyStorage === 'secure') return 'API key saved securely and hidden'
  if (store.settings.ai.keyStorage === 'local-fallback') return 'API key saved locally and hidden'
  return 'API key saved and hidden'
}

function apiKeyPlaceholder() {
  return store.settings.ai.hasApiKey
    ? 'API key saved - paste a new key to replace'
    : 'Paste API key'
}

async function saveApiKey() {
  apiKeyStatus.value = ''
  try {
    await store.setAiApiKey(apiKeyDraft.value)
    apiKeyDraft.value = ''
    apiKeyStatus.value = apiKeySavedMessage()
  } catch (error) {
    apiKeyStatus.value = `Could not save API key: ${errorMessage(error)}`
  }
}

async function clearApiKey() {
  apiKeyStatus.value = ''
  try {
    await store.clearAiApiKey()
    apiKeyDraft.value = ''
    apiKeyStatus.value = 'API key cleared'
  } catch (error) {
    apiKeyStatus.value = `Could not clear API key: ${errorMessage(error)}`
  }
}

async function testConnection() {
  connectionStatus.value = 'Testing...'
  try {
    const result = await store.testAiConnection()
    connectionStatus.value = result.message
  } catch (error) {
    connectionStatus.value = `Connection failed: ${errorMessage(error)}`
  }
}
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
        <div class="settings-sections">
          <section class="settings-section">
            <h3>Appearance</h3>
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
                max="48"
                @change="store.saveSettings"
              />
            </label>
          </section>

          <section class="settings-section">
            <h3>Editor</h3>
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

          <section class="settings-section">
            <h3>AI</h3>
            <label class="checkbox-label">
              <input v-model="store.settings.ai.enabled" type="checkbox" @change="store.saveSettings" />
              Enable AI
            </label>
            <label>
              Provider
              <select v-model="store.settings.ai.provider" @change="onAiProviderChange">
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="custom-openai-compatible">Custom OpenAI-compatible</option>
              </select>
            </label>
            <label>
              Base URL
              <input
                v-model.trim="store.settings.ai.baseUrl"
                type="url"
                placeholder="https://api.example.com/v1"
                @change="store.saveSettings"
              />
            </label>
            <label>
              Model
              <input
                v-model.trim="store.settings.ai.model"
                type="text"
                placeholder="model-name"
                @change="store.saveSettings"
              />
            </label>
            <label>
              API Key
              <input
                v-model="apiKeyDraft"
                type="password"
                autocomplete="off"
                :placeholder="apiKeyPlaceholder()"
              />
            </label>
            <div class="settings-actions">
              <button class="secondary-button" :disabled="!apiKeyDraft.trim()" @click="saveApiKey">Save API key</button>
              <button class="ghost-button" :disabled="!store.settings.ai.hasApiKey" @click="clearApiKey">Clear</button>
              <span class="settings-status">{{ apiKeyStatus || apiKeySavedMessage() }}</span>
            </div>
            <div class="settings-actions">
              <button class="secondary-button" :disabled="!store.settings.ai.enabled || !store.settings.ai.hasApiKey" @click="testConnection">
                Test connection
              </button>
              <span class="settings-status">{{ connectionStatus || 'Uses the current provider and model' }}</span>
            </div>
          </section>
        </div>
      </section>
    </div>
  </div>
</template>
