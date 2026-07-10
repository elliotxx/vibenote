# AI Native Assistance Implementation Plan

## 背景与范围

本计划实现 Vibenote 的第一阶段 AI Native 能力。设计说明见 [AI Native Assistance](../design/2026-07-02-ai-native-assistance.md)。

范围包括：

- AI 设置页分组。
- OpenAI、DeepSeek、Custom OpenAI-compatible provider 配置。
- API Key 安全保存与脱敏读取。
- provider 连接测试。
- Explain、Rewrite、Todo 提取等已有高 ROI AI action 的确认流。
- 需要用户确认的 AI 结果以文档锚定的建议卡片呈现，支持多卡片并发生成和逐个确认。

不包括：

- 全局 stream 自动整理。
- 向量库、RAG、长期记忆。
- 图片上传给模型。
- 多 provider 并发、成本统计、账户额度查询。
- 本阶段不新增标题生成或续写，不扩展为全局整理器。
- 跨应用重启恢复未处理 AI 建议卡片。

## 阶段计划

### 阶段 1：设置页结构

- 将现有 Settings modal 拆成 Appearance、Editor、AI 三组。
- 在 store 中增加脱敏 AI 设置状态。
- 增加 provider、base URL、model、enabled、has API key 的表单。
- API Key 输入只支持写入、替换、清除，不回显。

验收：

- 设置页在小窗口下不重叠。
- 非 AI 设置行为不回退。
- AI disabled 时不会显示可执行 AI action。

### 阶段 2：主进程 AI 配置与密钥存储

- 新增 `electron/aiSettings.js` 或同等主进程模块。
- 非敏感配置写入 userData。
- API Key 由主进程保存到 userData 下的独立文件；首发候选不调用 Electron `safeStorage`，避免未签名包触发 macOS Keychain 弹窗。
- UI 明示 `API key saved locally`。
- preload 暴露脱敏 IPC。
- dev mock 提供同形状 API，便于 e2e。

验收：

- localStorage 中没有 API Key。
- 读取设置只返回 `hasApiKey` 和脱敏存储状态，不返回明文 key。
- 清除 API Key 后 `hasApiKey=false`。

### 阶段 3：OpenAI-compatible adapter

- 新增主进程 `aiClient`，统一构造 Chat Completions 请求。
- 支持 OpenAI、DeepSeek、Custom 三类 provider。
- 实现 `ai:testConnection`。
- 规范化 base URL，避免重复拼接 `/v1` 或 `/chat/completions`。
- 所有错误信息脱敏。

验收：

- mock server 返回成功时，设置页显示 connected。
- 401/403/网络错误能显示可读错误。
- 请求 header 不进入日志。

### 阶段 4：AI action 边界

- 增加 `ai:runAction` IPC。
- 支持围绕当前选区或当前 block 的低风险 action。
- renderer 侧根据当前选区或当前 block 构造上下文。
- `explain-selection` 默认新建 block。
- 改写类 action 必须进入确认流，避免无确认覆盖。

验收：

- 无选区时只发送当前 block。
- 有选区时只发送选区。
- explain 结果插入为新 block，不覆盖原文。
- 关闭 AI 后 action 入口不可执行。

### 阶段 5：文档锚定的多建议卡片确认流

- 将 renderer 中单个 `aiSuggestion` 状态替换为 `aiSuggestions[]`。
- 每次触发 AI action 立即创建独立卡片，卡片先进入 `generating` 状态，模型返回后更新为 `ready` 或 `error`。
- 卡片位置锚定来源文本，创建后保存相对来源的偏移；编辑器滚动时重新投影位置。
- 来源文本离开可视区域后隐藏对应卡片，滚回时恢复；窗口 resize、缩放变化和拖拽结束时仅裁剪卡片边界。
- 保留现有拖动、缩放、关闭、替换原文、插入新块、复制能力，并让每张卡片独立操作。
- 为卡片增加“回到原文”入口，滚动到来源 block 并短暂高亮，但不修改正文。
- 替换原文前重新读取来源范围；如果当前文本不等于卡片保存的 `sourceText`，将卡片标记为 `stale`，禁止直接替换。

验收：

- 连续触发两次 AI action 会出现两张建议卡片，后一张不会覆盖前一张。
- 滚动编辑器时，已生成卡片跟随来源 block 移动；来源离开可视区域后隐藏，滚回后恢复。
- 拖动或缩放一张卡片不会改变其他卡片的位置和尺寸。
- 点击“回到原文”只定位来源，不插入、不替换、不删除内容。
- 来源文本被编辑后，点击替换会提示原文已变化，不覆盖用户的新内容。

### 阶段 6：保留的 AI action

- `rewrite-selection` 必须带预览确认、来源校验和取消不改文测试。
- Todo 提取必须只提取明确行动项，不把普通标题当成任务。
- 不做 `make-title` 和 `continue-writing`，避免产品偏向整理器或代写器。

### 阶段 7：验证与打包

- 增加 e2e 覆盖设置页、mock AI 请求、无 key 禁用和 action 插入。
- 增加 e2e 覆盖文档锚定的多建议卡片：多卡片生成、滚动隐藏与恢复、拖动缩放隔离、来源变化后禁止替换。
- 运行全量 e2e。
- 运行生产构建和 macOS 打包。
- 打开构建后的 `dist/mac-arm64/Vibenote.app` 手动验证设置页。

## 交付内容

- AI 设置页 UI。
- AI 设置 store 与类型。
- 主进程 AI 设置与密钥存储。
- OpenAI-compatible chat adapter。
- provider 连接测试。
- Explain、Rewrite、Todo 提取 action 的确认流记录。
- 文档锚定的多建议卡片确认流。
- e2e 测试与验证报告。

## 验证方式

建议命令：

```sh
npm run test:e2e
npm run build
npm run build:mac
open -n dist/mac-arm64/Vibenote.app
```

需要额外验证：

- 检查 localStorage 不包含 API Key。
- 检查保存文件不包含 API Key。
- 检查 Electron 日志不包含 Authorization header。
- 在无网络或错误 key 下确认 UI 可恢复。
- 在一个窗口内触发两张以上 AI 建议卡片，滚动编辑器后确认卡片随来源离开和恢复。
- 修改来源文本后再执行卡片的替换动作，确认不会覆盖新内容。

## 完成标准

- 用户可以在设置页配置 DeepSeek 或 OpenAI-compatible provider。
- 连接测试可用。
- API Key 不以明文暴露给 renderer 持久状态。
- AI action 只作用于当前 block 或选区。
- AI 建议卡片支持多张并发生成，滚动时与来源 block 一起移动。
- 改写类确认动作在来源变化后不会直接覆盖用户新内容。
- 未支持的 AI 操作不出现在可点击入口里。
- 全量 e2e、生产构建、macOS 打包通过。

## 回退策略

- 如果 provider 请求不稳定，保留设置页和密钥存储，只隐藏 AI action 入口。
- 如果后续引入系统加密存储导致兼容性问题，保留本机 fallback，并通过设置页状态提示用户。
- 如果 AI action 影响编辑器稳定性，先保留 `Test connection` 和设置页，回退 action IPC 与 UI 入口。
- 如果多卡片确认流影响编辑器稳定性，临时回退到单张建议卡片，但保留替换前来源校验。
