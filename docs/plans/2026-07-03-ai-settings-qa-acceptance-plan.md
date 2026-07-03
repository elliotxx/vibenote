# AI Settings QA Acceptance Plan

## 验收目标

本计划验收 Vibenote 第一阶段 AI 设置能力：用户可以在设置页配置 DeepSeek、OpenAI 和 Custom OpenAI-compatible provider，保存或清除 API Key，通过连接测试验证 provider 可用性，并确保 API Key 不进入 renderer 持久状态、笔记正文或日志。

受影响工作流：

- 设置页分组与 AI 配置表单。
- Electron 主进程 AI 设置、API Key 存储和连接测试 IPC。
- renderer store 的脱敏 AI 状态读取与保存。
- Markdown 链接的修饰键打开外部链接。
- macOS 打包后的真实应用启动与设置页冒烟。

不在本次验收范围：

- Explain、Rewrite 等 AI action 的真实执行。
- 全局整理、RAG、长期记忆、图片上传给模型。
- 真实生产 API Key 或真实用户数据验证。

## 验收策略

采用分层验收：

| 层级 | 覆盖目标 | 方式 | 通过口径 |
| --- | --- | --- | --- |
| L1 规则验证 | provider 默认值、base URL 拼接、脱敏状态 | e2e fixture、mock AI API | 输入后 UI 和持久状态符合规则 |
| L2 IPC/集成 | 主进程保存设置、保存 key、清除 key、测试连接 | Electron 主进程路径、mock provider 或可控错误 | renderer 不接触明文 key，错误提示可见 |
| L3 本地运行态 | 打包 app 启动、设置页可操作 | 构建后 macOS app 冒烟 | 应用无白屏，设置页可打开和保存 |
| L4 UI 验收 | 表单、按钮、状态、错误提示、小窗口布局 | Playwright 与人工截图 | 文案、禁用态、保存态、错误态可见 |
| L5 工程门禁 | 回归、构建、打包、diff 清洁度 | 项目脚本和 git 检查 | 命令通过，未验证项明确记录 |

Mock 结果只能证明本地 UI 和数据流，不代表真实 provider 线上连通。真实 provider 连接只在使用专用测试 key 时执行。

## 可行性分析

| 验收方向 | 可行性 | 说明 |
| --- | --- | --- |
| 设置页 UI | 可真实执行 | 本地应用即可打开设置页，操作不依赖外部服务。 |
| API Key 保存 | 可真实执行 | 使用占位测试 key，不调用真实模型也能验证保存和脱敏状态。 |
| 本机 fallback 存储 | 可真实执行 | 首发候选不调用 macOS Keychain；计划要求覆盖保存、清除和 fallback 状态。 |
| Test connection 成功 | 适合 Mock，真实调用可选 | 真实 provider 需要测试 key 和网络；默认用 mock response 验证 UI。 |
| 401/403/网络错误 | 适合 Mock | 使用 stub response 避免消耗真实额度或泄露 key。 |
| 打包 app | 可真实执行 | 使用项目 `build:mac` 生成 macOS app 并启动冒烟。 |
| Markdown 外链 | 可 Mock | 拦截 `openExternal`，验证普通点击不打开、修饰键点击打开。 |

## 验收准备

### 环境准备

- macOS 本地环境。
- 已安装项目依赖。
- 不使用真实笔记数据；使用 e2e fixture 或新建临时测试内容。
- 不克隆、读取或迁移 Heynote 数据。

建议命令：

```sh
npm run test:e2e
npm run build
npm run build:mac
open -n dist/mac-arm64/Vibenote.app
```

### Mock 或测试数据准备

| 数据 | 关键字段 | 创建方式 | 用途 | 清理策略 |
| --- | --- | --- | --- | --- |
| AI 设置 fixture | `enabled=false`、`provider=deepseek`、无 key | e2e 初始化 localStorage mock | 验证默认 UI 和禁用态 | 测试结束清空浏览器上下文 |
| 测试 API Key | `<TEST_API_KEY>` | UI 输入框手动输入或 e2e 填充 | 验证保存、清除和脱敏 | Clear API Key 或删除测试 userData |
| Custom provider | `baseUrl=https://example.test/v1`、`model=test-chat` | UI 表单输入 | 验证自定义 provider 配置 | 清空设置或重置 fixture |
| 成功连接 response | 200 + 简短 chat completion body | mock provider/stub | 验证 Test connection 成功文案 | 测试结束销毁 mock |
| 失败连接 response | 401、403、500、网络错误 | mock provider/stub | 验证错误提示脱敏 | 测试结束销毁 mock |
| Markdown 链接 fixture | `[docs](https://example.com/docs)` | e2e note fixture | 验证修饰键外链行为 | 测试结束清空 fixture |

不得把真实 API Key、真实用户笔记、真实私有服务地址写入测试代码、文档或截图。

## 验收 CheckList

### P0 必测

| ID | 验收项 | 描述 | 准备工作 | 验收步骤 | 验收标准 | 证据要求 |
| --- | --- | --- | --- | --- | --- | --- |
| AI-UI-01 | 设置页 AI 分组可见 | 验证用户能找到 AI 配置入口 | 启动应用，打开设置页 | 打开 Settings，查看 Appearance、Editor、AI 分组 | 三个分组均可见；AI 分组包含 Enable AI、Provider、Base URL、Model、API Key、Test connection | UI 截图或 e2e 断言 |
| AI-UI-02 | provider 默认值正确 | 验证 DeepSeek、OpenAI、Custom 的表单映射 | 使用空白 AI 设置 fixture | 依次选择 DeepSeek、OpenAI、Custom | DeepSeek 填入 DeepSeek 默认 base URL/model；OpenAI 填入 OpenAI 默认 base URL/model；Custom 不覆盖用户输入 | e2e 输出或表单截图 |
| AI-KEY-01 | API Key 保存后不进 renderer 持久状态 | 防止密钥进入 localStorage 或 note fixture | 使用 `<TEST_API_KEY>` | 输入 key，点击 Save API key，读取 renderer localStorage 与笔记内容 | localStorage 和笔记正文不包含 `<TEST_API_KEY>`；UI 显示保存成功状态 | e2e 断言和状态截图 |
| AI-KEY-02 | API Key 保存失败可见 | 防止密钥保存失败时静默失败 | mock `ai:setApiKey` 抛出错误 | 输入 key，点击 Save API key | UI 显示 `Could not save API key`；输入框保留原输入以便重试；不显示保存成功 | e2e 断言 |
| AI-KEY-03 | 本机 fallback 可识别 | 验证 API Key 落盘后用户可感知本机保存状态，且输入框不回显密钥 | 保存测试 key | 保存 key 后读取脱敏设置 | `hasApiKey=true`；`keyStorage=local-fallback`；UI 显示 `API key saved locally and hidden` | e2e 或 runtime 断言 |
| AI-KEY-04 | 清除 API Key | 验证用户能撤销保存状态 | 已保存测试 key | 点击 Clear | `hasApiKey=false`；Test connection 禁用；UI 显示 `API key cleared` 或 `No API key saved` | e2e 断言或截图 |
| AI-CONN-01 | AI disabled 时不可测试连接 | 避免用户未启用 AI 时触发请求 | 默认 `enabled=false` | 保存 key 后保持 Enable AI 关闭 | Test connection 按钮禁用或返回 `AI is disabled`，不发送真实 provider 请求 | e2e 断言和网络/IPC mock 记录 |
| AI-CONN-02 | Test connection 成功 | 验证可通过当前配置调用 provider | mock 成功 response；AI enabled；已保存 key | 点击 Test connection | UI 显示 `Connection OK`；请求只包含极短测试消息，不读取笔记正文 | mock 请求摘要和 UI 截图 |
| AI-CONN-03 | Test connection 失败脱敏 | 验证错误恢复和安全提示 | mock 401/403/网络错误 | 点击 Test connection | UI 显示可读错误；错误消息不包含 API Key、Authorization header 或完整请求体 | e2e 断言或日志检查 |
| AI-IPC-01 | renderer 只使用脱敏 IPC | 验证主进程持有 key，renderer 不接触明文 | 查看 preload 和 renderer 行为 | 检查 `getSettings` 返回值和 store 状态 | renderer 只包含 `hasApiKey`、`keyStorage` 等脱敏字段，不包含明文 key | 代码审查记录和 e2e localStorage 断言 |
| MD-LINK-01 | Markdown 外链只通过修饰键打开 | 避免普通编辑点击误打开外链 | Markdown 链接 fixture | 普通点击链接，再用主修饰键点击链接 | 普通点击不调用外部打开；修饰键点击只打开 http/https 链接；正文不变 | e2e 断言 |
| GATE-01 | 全量自动化回归 | 验证已有编辑器能力未回退 | 项目依赖可用 | 执行 `npm run test:e2e` | 所有 e2e 通过；失败项必须定位并修复或记录 | 命令输出摘要 |
| GATE-02 | 生产构建和 macOS 打包 | 验证变更能进入首发候选包 | 清理旧构建产物或覆盖构建 | 执行 `npm run build`、`npm run build:mac` | 构建和打包通过，生成 macOS app 和 DMG；仅允许记录已知 bundle 体积警告 | 命令输出摘要 |
| GATE-03 | 构建后 app 冒烟 | 验证用户实际打开的应用可用 | 已完成打包 | 打开构建后的 app，进入 Settings | 应用无白屏；设置页可打开；AI 分组可见；API Key 保存按钮有反馈 | 人工截图或运行态记录 |

### P1 补测

| ID | 验收项 | 描述 | 准备工作 | 验收步骤 | 验收标准 | 证据要求 |
| --- | --- | --- | --- | --- | --- | --- |
| AI-UI-03 | 小窗口布局 | 验证设置页在窄窗口下不重叠 | 调整窗口到小尺寸 | 打开 Settings 并滚动 AI 分组 | 表单文字不截断关键内容；按钮和状态不堆叠遮挡 | 截图 |
| AI-CFG-01 | base URL 末尾斜杠兼容 | 避免重复拼接 `/chat/completions` | Custom provider fixture | 输入带尾部 `/` 或完整 `/chat/completions` 的 base URL | 请求 endpoint 不重复斜杠，不重复追加路径 | mock 请求 URL |
| AI-CFG-02 | 模型名为空 | 验证无效配置的错误提示 | Custom provider，清空 model | 点击 Test connection | UI 显示 `Model is required` 或等价可读错误，不发送真实请求 | e2e 断言 |
| AI-CFG-03 | provider 切换后保留 key 状态 | 避免切 provider 误清除 key | 已保存测试 key | DeepSeek、OpenAI、Custom 间切换 | `hasApiKey` 保持 true；只更新 provider/baseUrl/model | e2e 断言 |
| AI-SEC-01 | 日志脱敏抽查 | 防止 token 和 header 泄漏 | 使用测试 key，触发失败连接 | 检查运行日志和控制台错误 | 不出现 `<TEST_API_KEY>`，不出现完整 Authorization header | 日志摘录，不能包含真实 key |
| AI-DATA-01 | 旧 key 文件兼容 | 验证旧版 Keychain 记录不会触发系统弹窗，并可清除 | 使用旧格式 fixture 或迁移前备份 | 启动后读取设置并点击 Clear | `hasApiKey=true`，可正常 clear；Test connection 给出可读提示，不弹 macOS Keychain | 手动记录或单测 |
| AI-DATA-02 | 设置文件缺失或损坏 | 验证异常数据恢复默认值 | 删除或写入损坏的 AI 设置 fixture | 启动应用 | 应用不白屏；AI 设置回到默认 DeepSeek disabled 状态 | e2e 或人工截图 |
| AI-ROLL-01 | 回滚策略 | 验证隐藏 AI 入口不会影响普通编辑 | 手动关闭 AI 或回滚 UI 入口 | 打开应用并编辑普通 Markdown block | 普通编辑、保存、快捷键、图片路径不受影响 | 回归测试摘要 |
| REL-01 | 发布产物校验 | 验证首发候选包可安装 | 完成 `release:mac` 或等价流程 | 生成 checksum，按安装提示下载/校验/安装 | checksum 校验通过，app 可启动；未签名阻拦步骤有文档说明 | 命令输出和安装记录 |

## 覆盖关系

| 改动面 | 主要风险 | 覆盖验收项 |
| --- | --- | --- |
| 设置页分组和 AI 表单 | 入口不可见、布局拥挤、默认值错误 | `AI-UI-01`, `AI-UI-02`, `AI-UI-03` |
| renderer store AI 状态 | 明文 key 泄漏、旧 localStorage 污染、状态不同步 | `AI-KEY-01`, `AI-KEY-04`, `AI-IPC-01`, `AI-CFG-03` |
| 主进程 API Key 存储 | 保存失败、清除失败、旧格式不兼容、Keychain 弹窗 | `AI-KEY-02`, `AI-KEY-03`, `AI-KEY-04`, `AI-DATA-01` |
| OpenAI-compatible Test connection | endpoint 错误、错误不脱敏、误读笔记正文 | `AI-CONN-01`, `AI-CONN-02`, `AI-CONN-03`, `AI-CFG-01`, `AI-CFG-02` |
| preload IPC 暴露 | renderer 越界、外部链接协议不受控 | `AI-IPC-01`, `MD-LINK-01` |
| Markdown 链接增强 | 普通点击误打开、正文被改写 | `MD-LINK-01`, `GATE-01` |
| 文档、构建、打包 | 交付证据不足、首发包不可用 | `GATE-01`, `GATE-02`, `GATE-03`, `REL-01` |

## 验收证据要求

- 命令证据：记录 `npm run test:e2e`、`npm run build`、`npm run build:mac` 的结果摘要和失败项。
- UI 证据：设置页 AI 分组、保存成功、保存失败、连接测试结果至少各保留一张截图。写入持久文档前应上传到项目指定图床或文档系统，不使用本地路径。
- 数据证据：记录 renderer localStorage 检查摘要，证明不包含测试 key。
- IPC/安全证据：记录 `getSettings` 脱敏字段和日志脱敏抽查结果。
- 打包证据：记录 DMG 生成结果、构建后 app 启动结果。
- 未验证项：真实 provider 在线连接如果未执行，需要记录原因、风险和补验方式。

## 通过准入

- 所有 P0 验收项必须通过，或者存在明确、可接受、已记录的环境性跳过原因。
- P1 中涉及安全、旧数据兼容、发布产物的项在正式 release 前至少完成一次。
- 任何证据不得包含真实 API Key、Authorization header、私有服务地址、真实用户笔记或本地绝对截图路径。
- 若 Test connection 真实调用失败，必须区分是配置错误、网络错误、provider 错误还是应用错误，不能用 mock 成功替代真实失败结论。

## 未覆盖风险

- 未使用真实 OpenAI 或 DeepSeek API Key 时，无法证明线上 provider 真实可用，只能证明 OpenAI-compatible 请求构造和 UI 数据流正确。
- 本机 fallback 能保证可用性，但不等同于系统加密存储；若发布给更大范围用户，建议补充签名/notarization 和 Keychain 方案评估。
- Explain 与 Rewrite 尚未实现，不能把当前 AI 设置验收外推为 AI 写作能力验收通过。
