<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
import EditorPane from './components/EditorPane.vue'
import { useWorkspaceStore } from './stores/workspace'

const store = useWorkspaceStore()
const showSettings = ref(false)
const apiKeyDraft = ref('')
const apiKeyStatus = ref('')
const connectionStatus = ref('')
const gitBackupMessage = ref('')
const agentCliMessage = ref('')
const agentCliBusy = ref(false)

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

const gitRepositoryLabel = computed(() => {
  const configured = store.gitBackupSettings.repositoryPath
  if (!configured) return '尚未选择仓库'
  return configured.split(/[\\/]/).filter(Boolean).at(-1) || '已选择 Git 仓库'
})

const gitBackupStatusLabel = computed(() => {
  if (gitBackupMessage.value) return gitBackupMessage.value
  if (store.gitBackupStatus.lastErrorMessage) return store.gitBackupStatus.lastErrorMessage
  const labels: Record<string, string> = {
    disabled: '自动备份已关闭',
    ready: '仓库已就绪',
    'no-changes': '内容已是最新',
    'committed-local': '已创建本地快照提交',
    pushed: '已安全推送',
    'push-failed': '本地提交已保留，推送失败',
    'push-manual-required': '本地提交已保留，请手动检查远端',
    'repository-unavailable': '备份仓库不可用',
    'mirror-conflict': '备份快照被外部修改，已停止更新',
    conflict: 'Git 仓库存在未解决操作',
    'identity-missing': '请先配置 Git 用户名和邮箱',
  }
  return labels[store.gitBackupStatus.lastResult] || '等待下一次快照'
})

const gitBackupTimeLabel = computed(() => {
  const timestamp = store.gitBackupStatus.lastPushAt || store.gitBackupStatus.lastCommitAt || store.gitBackupStatus.lastExportAt
  if (!timestamp) return '尚无快照记录'
  return `最近更新：${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(timestamp))}`
})

async function chooseGitRepository() {
  gitBackupMessage.value = ''
  try {
    await store.chooseGitBackupRepository()
  } catch (error) {
    gitBackupMessage.value = localizeMessage(errorMessage(error))
  }
}

async function toggleGitBackup(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  gitBackupMessage.value = ''
  try {
    await store.setGitBackupEnabled(enabled)
  } catch (error) {
    gitBackupMessage.value = localizeMessage(errorMessage(error))
  }
}

const agentCliStatusLabel = computed(() => {
  if (agentCliMessage.value) return agentCliMessage.value
  const labels: Record<AgentCliStatus['state'], string> = {
    'not-installed': '尚未安装',
    installed: `已安装 · v${store.agentCliStatus.appVersion}`,
    'update-available': `有可用更新 · v${store.agentCliStatus.appVersion}`,
    conflict: '安装位置存在其他同名命令',
    'unsupported-location': '请先将 Vibenote 移到“应用程序”目录',
  }
  return labels[store.agentCliStatus.state]
})

async function installAgentCli() {
  agentCliMessage.value = ''
  agentCliBusy.value = true
  try {
    await store.installAgentCli()
  } catch (error) {
    agentCliMessage.value = `安装失败：${localizeMessage(errorMessage(error))}`
  } finally {
    agentCliBusy.value = false
  }
}

async function uninstallAgentCli() {
  agentCliMessage.value = ''
  agentCliBusy.value = true
  try {
    await store.uninstallAgentCli()
  } catch (error) {
    agentCliMessage.value = `卸载失败：${localizeMessage(errorMessage(error))}`
  } finally {
    agentCliBusy.value = false
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

          <section class="settings-section settings-section-wide">
            <h3>Git 自动备份</h3>
            <p class="settings-description">每 5 分钟将内部笔记导出为单向快照。原始笔记目录仍是唯一数据来源。</p>
            <label class="checkbox-label">
              <input
                :checked="store.gitBackupSettings.enabled"
                type="checkbox"
                :disabled="!store.gitBackupSettings.repositoryPath"
                @change="toggleGitBackup"
              />
              启用自动快照与安全推送
            </label>
            <div class="git-repository-row">
              <button class="secondary-button" @click="chooseGitRepository">选择 Git 仓库</button>
              <span class="git-repository-name" :title="gitRepositoryLabel">{{ gitRepositoryLabel }}</span>
            </div>
            <div class="git-backup-state" :class="{ error: store.gitBackupStatus.lastErrorCode || gitBackupMessage }">
              <span>{{ gitBackupStatusLabel }}</span>
              <span>{{ gitBackupTimeLabel }}</span>
            </div>
            <p class="settings-description">仅提交 Vibenote 管理的快照路径；远端不安全或需要人工判断时只保留本地提交。</p>
          </section>

          <section class="settings-section settings-section-wide">
            <h3>Agent CLI</h3>
            <p class="settings-description">安装 <code>vibenote</code> 命令，让本机 Agent 通过版本化 JSON 契约读取、搜索和安全追加笔记。</p>
            <div class="settings-actions">
              <button
                v-if="store.agentCliStatus.state === 'not-installed' || store.agentCliStatus.state === 'update-available'"
                class="secondary-button"
                :disabled="agentCliBusy"
                @click="installAgentCli"
              >
                {{ store.agentCliStatus.state === 'update-available' ? '更新 Agent CLI' : '安装 Agent CLI' }}
              </button>
              <button
                v-if="store.agentCliStatus.state === 'installed' || store.agentCliStatus.state === 'update-available'"
                class="ghost-button"
                :disabled="agentCliBusy"
                @click="uninstallAgentCli"
              >
                卸载
              </button>
            </div>
            <div class="git-backup-state" :class="{ error: store.agentCliStatus.state === 'conflict' || agentCliMessage }">
              <span>{{ agentCliStatusLabel }}</span>
              <span v-if="store.agentCliStatus.commandPath" :title="store.agentCliStatus.commandPath">{{ store.agentCliStatus.commandPath }}</span>
            </div>
            <p v-if="(store.agentCliStatus.state === 'installed' || store.agentCliStatus.state === 'update-available') && !store.agentCliStatus.pathConfigured" class="settings-description">
              命令已安装，但登录 shell 的 PATH 不包含 <code>{{ store.agentCliStatus.binDirectory }}</code>；Vibenote 不会自动修改 shell 配置。
            </p>
            <p v-if="store.agentCliStatus.state === 'unsupported-location'" class="settings-description">
              请先将 Vibenote.app 移到系统或用户的“应用程序”目录，避免应用移动后命令失效。
            </p>
            <p v-if="store.agentCliStatus.state === 'conflict'" class="settings-description">
              Vibenote 不会覆盖或删除非本应用管理的同名命令。请先手动检查安装位置。
            </p>
          </section>

          <section class="settings-section settings-section-wide">
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
