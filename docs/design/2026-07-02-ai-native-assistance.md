# AI Native Assistance

## 背景与目标

Vibenote 的 AI 能力应延续“沉浸式、顺手、AI Native 的纯文本笔记”定位。AI 不是全局整理器，也不应默认重写用户的 stream。首发目标是先建立可信的 AI 设置入口，再提供围绕当前 block 或选区的低风险辅助。

第一阶段目标：

- 支持 OpenAI-compatible provider 配置，优先覆盖 OpenAI 与 DeepSeek。
- 在设置页提供清晰、可测试、可关闭的 AI 配置。
- 将 API Key 放在 Electron 主进程侧管理，避免进入 localStorage、笔记正文或日志。
- AI 功能默认只作用于当前 block 或当前选区，结果先以可预览方式呈现，由用户确认插入或替换。
- AI action 只保留围绕当前 block 或选区的高 ROI 路线，确认类结果必须先预览，由用户决定替换、插入或复制。

相关实施计划见 [AI Native Assistance Implementation Plan](../plans/2026-07-02-ai-native-assistance-plan.md)。

## 现状与问题

当前应用已经具备适合 AI 的基础边界：

- 单一 stream 与 block 结构清晰，适合把当前 block 作为最小上下文。
- Markdown block 已有轻量输入增强，但没有 AI provider、API Key、调用链或 AI 操作入口。
- 设置页目前只包含主题、字号、Tab size、默认语言，缺少分组结构。
- 文档约定 AI 默认限制在当前 block 或选区，不能做破坏性全局整理。

主要问题不是模型能力，而是边界和信任：

- 用户需要知道 API Key 存在哪里、何时会请求模型、发送了哪些文本。
- AI 不能在无确认情况下改写多个 block。
- DeepSeek 与 OpenAI 都可通过 OpenAI-compatible 格式接入，但模型、base URL、测试方式需要可配置。
- 表述优化、Todo 提取等需要确认的 AI 结果如果只用单个跟随选区的弹窗承载，滚动后会打断用户继续浏览，也无法在多个 block 上并发触发后逐个确认。

## 方案设计

### 设置页

将现有 Settings modal 改成分组式设置页，保留轻量 modal，不引入新路由。

建议分组：

| 分组 | 内容 |
| --- | --- |
| Appearance | Theme、Font size |
| Editor | Tab size、Default language |
| AI | Enable AI、Provider、Base URL、Model、API Key、Test connection |

AI 分组交互：

- `Enable AI` 默认关闭。
- `Provider` 提供 `OpenAI`、`DeepSeek`、`Custom OpenAI-compatible`。
- 选择 `OpenAI` 时预填 OpenAI base URL 与推荐模型，但允许修改模型；实现前按官方文档确认默认模型。
- 选择 `DeepSeek` 时预填 DeepSeek OpenAI-compatible base URL 与推荐模型，但允许修改模型；实现前按官方文档确认默认模型。
- `Custom` 允许用户输入 base URL 和 model。
- API Key 输入框只显示空态、已保存态和替换入口，不回显完整 key。
- `Test connection` 只发送一条极短测试请求，不读取笔记内容。

### Provider 抽象

首版采用 OpenAI-compatible Chat Completions 作为统一协议。原因：

- DeepSeek 官方支持 OpenAI-compatible API。
- OpenAI Chat Completions 覆盖文本生成场景，适合与 DeepSeek 共享 adapter。
- 相比同时支持 OpenAI Responses API，首版实现成本更低，设置项更少。
- OpenAI Responses API 可作为后续 OpenAI 专用优化，不进入首个 provider 抽象。

建议 provider 配置结构：

```ts
type AiProviderKind = 'openai' | 'deepseek' | 'custom-openai-compatible'

type AiSettings = {
  enabled: boolean
  provider: AiProviderKind
  baseUrl: string
  model: string
  hasApiKey: boolean
}
```

API Key 不进入 renderer store 的持久化对象。renderer 只知道 `hasApiKey`。

base URL 保存前需要规范化：去掉末尾重复 `/`，请求时统一拼接 `/chat/completions` 或 provider 已声明的等价路径，避免用户输入 `.../v1` 时产生重复路径。

### 密钥存储

首版只做 macOS，因此建议使用 Electron 主进程持有 AI 配置与密钥：

- 非敏感配置存入 app userData 下的 `ai-settings.json`。
- API Key 存入 userData 下的独立文件，renderer 仍然只拿到脱敏状态，不拿明文 key。
- 首发候选是未签名小范围试用包，不调用 Electron `safeStorage`，避免触发 macOS Keychain 弹窗；UI 明确显示 `API key saved locally`。
- 后续如果切到 Developer ID 签名和 notarization，再评估 Keychain 或系统加密存储方案。
- 日志和错误提示不得输出 API Key、Authorization header 或完整请求体。

这比引入 `keytar` 更轻，避免新增 native dependency 和打包复杂度。

### IPC 边界

renderer 不能直接发起带 API Key 的请求。建议新增主进程 IPC：

| IPC | 作用 |
| --- | --- |
| `ai:getSettings` | 读取脱敏设置 |
| `ai:saveSettings` | 保存 provider/baseUrl/model/enabled |
| `ai:setApiKey` | 写入加密 API Key |
| `ai:clearApiKey` | 删除 API Key |
| `ai:testConnection` | 用当前配置测试模型连接 |
| `ai:runAction` | 对当前 block 或选区执行 AI 动作 |

所有 AI 请求由主进程完成，renderer 只传递 action 类型、用户确认的上下文和必要参数。

### 高 ROI AI 功能

按价值和风险排序，推荐只保留 2 个能力。

| 优先级 | 功能 | 作用范围 | ROI | 风险控制 |
| --- | --- | --- | --- | --- |
| P0 | Explain selection | 当前选区 | 高 | 新建结果 block，不改原文 |
| P1 | Rewrite selection | 当前选区 | 高 | 先预览 diff，用户确认替换 |

推荐优先保证 `Explain selection` 和 `Rewrite selection` 的确认边界。`Explain selection` 价值清晰、不会改原文，适合验证 provider 调用链；`Rewrite selection` ROI 高，但必须依赖预览确认、来源校验与可回退路径。

不建议首批做：

- 全局整理整个 stream。
- 自动合并、删除或移动 block。
- 自动分类、标签系统或知识库索引。
- 长期记忆、向量库、RAG。
- 标题生成和续写能力。

这些能力会破坏“无脑记笔记”的低负担体验，也会显著增加隐私和解释成本。

### AI 操作入口

入口要轻，不要让产品变成 AI 控制台。

建议：

- 状态栏增加一个小的 AI 图标按钮，只有启用 AI 后显示为可用。
- 选中文本时，右键菜单或快捷键打开 AI action menu。
- 当前 block 无选区时，AI 默认作用于当前 block。
- 快捷键建议保留给后续，不在首版塞太多。

结果呈现：

- `Explain` 默认插入到当前 block 后的新 block。
- `Rewrite` 使用预览卡片，用户确认后替换选区或当前 block。

### AI 建议卡片

需要用户确认的 AI 结果不应继续作为“跟随选区滚动的单例弹窗”，而应升级为可停放的 AI 建议卡片。卡片创建时锚定来源文本；编辑器滚动时与来源 block 一起移动，来源离开可视区域后卡片随之隐藏，滚回时恢复到原位置。

核心交互：

- 每次触发 AI action 都创建一张独立卡片，不覆盖已有卡片。
- 卡片支持生成中、已完成、失败、原文已变化四种状态。
- 卡片可拖动、可调整大小、可关闭；拖动后保存相对来源文本的偏移，多个卡片互不影响。
- 卡片保留来源锚点，提供“回到原文”能力，点击后滚动到来源 block 并短暂高亮。
- 卡片操作保留当前确认动作：替换原文、插入新块、复制。

数据模型从单个 `aiSuggestion` 调整为 `aiSuggestions[]`。每张卡片至少保存：

```ts
type AiSuggestionCard = {
  id: string
  action: 'polish' | 'extract-todo' | 'explain'
  status: 'generating' | 'ready' | 'error' | 'stale'
  sourceText: string
  content: string
  from: number
  to: number
  scope: 'selection' | 'block'
  frame: { top: number; left: number; width: number; height: number }
  createdAt: number
}
```

安全边界：

- 替换原文前必须重新读取 `from` 到 `to` 的当前内容，确认仍等于 `sourceText`。
- 如果来源文本已经变化，卡片进入 `stale` 状态，禁止直接替换，只允许复制、插入新块或回到原文重新触发。
- 卡片位置不写入笔记文件，不跨应用重启恢复；首版只保留在当前运行时，避免把临时 AI 状态混入用户数据。
- 右下角状态栏只展示最近一次 AI 状态，不承担多卡片列表职责。

## 验收标准

当前设置页交付必须满足：

- 设置页能配置 OpenAI、DeepSeek、Custom OpenAI-compatible provider。
- API Key 保存后不出现在 localStorage、笔记文件、renderer store 明文状态或日志中。
- `Test connection` 能在不读取笔记正文的情况下验证 provider 可用性。

后续 `Explain` action 必须满足：

- 未启用 AI 或未保存 API Key 时，AI 入口不可执行并给出明确提示。
- `Explain` 默认只读取当前选区；无选区时只读取当前 block。
- `Explain` 结果新建 block，不覆盖原文。
- e2e 覆盖无 key 禁用、当前选区 explain。

后续改写类 action 必须满足：

- AI 结果不会自动改写多个 block。
- `Rewrite` 必须有确认步骤，取消后原文不变。
- e2e 覆盖取消 rewrite 不改文、确认 rewrite 只替换选区。

固定多卡片确认流必须满足：

- 连续在不同 block 或选区触发 AI action，会出现多张独立建议卡片。
- 滚动编辑器时，建议卡片跟随来源 block 移动；来源文本离开可视区域后卡片隐藏，滚回后恢复。
- 拖动或缩放某张卡片不会影响其他卡片。
- 点击“回到原文”能定位到对应来源，并且不改变笔记内容。
- 来源文本变化后点击替换不会覆盖新内容，必须提示原文已变化。

## 风险与边界

- 首版不承诺支持所有 OpenAI-compatible provider 的非标准字段。
- 首版不做 streaming UI，先用非流式响应降低状态复杂度。
- 首版不做 token 估算和历史上下文裁剪，只发送当前选区或当前 block。
- 首版不上传图片内容，只处理文本。
- AI 输出必须走用户确认，不做后台自动整理。
- 多张 AI 建议卡片可能遮挡编辑区；首版先依赖拖动、缩放和关闭解决，不引入侧边栏或卡片管理中心。

## 待确认点

- OpenAI 默认模型使用哪个名称需要在实现前按最新官方可用模型确认。
- DeepSeek 默认模型使用哪个名称需要在实现前按最新官方可用模型确认。

## 参考资料

- [DeepSeek API Docs](https://api-docs.deepseek.com/)
- [OpenAI API Reference](https://developers.openai.com/api/reference/overview/)
- [OpenAI Chat Completions API Reference](https://developers.openai.com/api/reference/chat-completions/overview/)
