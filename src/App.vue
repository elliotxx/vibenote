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

function localizeMessage(message: string) {
  const knownMessages: Record<string, string> = {
    'AI is disabled': 'AI 未启用',
    'API key is required': '需要 API 密钥',
    'Connection OK': '连接成功',
    'Connection failed (401)': '连接失败（401）',
    'Model is required': '需要填写模型',
    'Nothing to send to AI': '没有可发送给 AI 的内容',
    'Secure storage is not available': '安全存储不可用',
  }
  return knownMessages[message] || message
}

function apiKeySavedMessage() {
  if (!store.settings.ai.hasApiKey) return '未保存 API 密钥'
  if (store.settings.ai.keyStorage === 'secure') return 'API 密钥已安全保存并隐藏'
  if (store.settings.ai.keyStorage === 'local-fallback') return 'API 密钥已本地保存并隐藏'
  return 'API 密钥已保存并隐藏'
}

function apiKeyPlaceholder() {
  return store.settings.ai.hasApiKey
    ? '已保存 API 密钥，粘贴新密钥可替换'
    : '粘贴 API 密钥'
}

async function saveApiKey() {
  apiKeyStatus.value = ''
  try {
    await store.setAiApiKey(apiKeyDraft.value)
    apiKeyDraft.value = ''
    apiKeyStatus.value = apiKeySavedMessage()
  } catch (error) {
    apiKeyStatus.value = `无法保存 API 密钥：${localizeMessage(errorMessage(error))}`
  }
}

async function clearApiKey() {
  apiKeyStatus.value = ''
  try {
    await store.clearAiApiKey()
    apiKeyDraft.value = ''
    apiKeyStatus.value = 'API 密钥已清除'
  } catch (error) {
    apiKeyStatus.value = `无法清除 API 密钥：${localizeMessage(errorMessage(error))}`
  }
}

async function testConnection() {
  connectionStatus.value = '连接测试中...'
  try {
    const result = await store.testAiConnection()
    connectionStatus.value = localizeMessage(result.message)
  } catch (error) {
    connectionStatus.value = `连接失败：${localizeMessage(errorMessage(error))}`
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
          <h2>设置</h2>
          <button class="icon-button" title="关闭设置" @click="showSettings = false">
            <X :size="16" />
          </button>
        </header>
        <div class="settings-sections">
          <section class="settings-section">
            <h3>外观</h3>
            <label>
              主题
              <select v-model="store.settings.theme" @change="store.saveSettings">
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label>
              字号
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
            <h3>编辑器</h3>
            <label>
              Tab 宽度
              <input
                v-model.number="store.settings.tabSize"
                type="number"
                min="2"
                max="8"
                @change="store.saveSettings"
              />
            </label>
            <label>
              默认格式
              <select v-model="store.settings.defaultLanguage" @change="store.saveSettings">
                <option value="text">纯文本</option>
                <option value="markdown">Markdown</option>
                <option value="json">JSON</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="sql">SQL</option>
                <option value="math">Math</option>
              </select>
            </label>
            <label>
              图片存储
              <select v-model="store.settings.imageStorage" @change="store.saveSettings">
                <option value="beside-file">当前文件旁边</option>
                <option value="app-data">应用数据目录</option>
              </select>
            </label>
          </section>

          <section class="settings-section">
            <h3>AI</h3>
            <label class="checkbox-label">
              <input v-model="store.settings.ai.enabled" type="checkbox" @change="store.saveSettings" />
              启用 AI
            </label>
            <label>
              服务商
              <select v-model="store.settings.ai.provider" @change="onAiProviderChange">
                <option value="deepseek">DeepSeek</option>
                <option value="openai">OpenAI</option>
                <option value="custom-openai-compatible">自定义 OpenAI 兼容服务</option>
              </select>
            </label>
            <label>
              基础 URL
              <input
                v-model.trim="store.settings.ai.baseUrl"
                type="url"
                placeholder="https://api.example.com/v1"
                @change="store.saveSettings"
              />
            </label>
            <label>
              模型
              <input
                v-model.trim="store.settings.ai.model"
                type="text"
                placeholder="模型名称"
                @change="store.saveSettings"
              />
            </label>
            <label>
              API 密钥
              <input
                v-model="apiKeyDraft"
                type="password"
                autocomplete="off"
                :placeholder="apiKeyPlaceholder()"
              />
            </label>
            <div class="settings-actions">
              <button class="secondary-button" :disabled="!apiKeyDraft.trim()" @click="saveApiKey">保存 API 密钥</button>
              <button class="ghost-button" :disabled="!store.settings.ai.hasApiKey" @click="clearApiKey">清除</button>
              <span class="settings-status">{{ apiKeyStatus || apiKeySavedMessage() }}</span>
            </div>
            <div class="settings-actions">
              <button class="secondary-button" :disabled="!store.settings.ai.enabled || !store.settings.ai.hasApiKey" @click="testConnection">
                测试连接
              </button>
              <span class="settings-status">{{ connectionStatus || '使用当前服务商和模型' }}</span>
            </div>
          </section>
        </div>
      </section>
    </div>
  </div>
</template>
