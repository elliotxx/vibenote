# AI Settings QA Execution Report

## 执行结论

P0 验收通过，可以进入下一步提交或发布候选流程。本次执行过程中发现并修复了三个会影响真实打包应用的 P0 问题：

- 保存 API Key 前未先持久化当前 AI 设置，导致 `enabled/provider/baseUrl/model` 被旧设置覆盖，`Test connection` 仍保持禁用。
- renderer 将 Vue reactive proxy 直接传给 Electron IPC，打包应用中触发 `An object could not be cloned`，导致 API Key 保存失败。
- Electron `safeStorage` 在未签名试用包中触发 macOS Keychain 弹窗；当前首发候选已改为本机 fallback，不再调用 Keychain。

修复后，web e2e、生产构建、macOS 打包、package 校验、runtime smoke、AI runtime smoke 和 checksum 校验均通过。

统计：

| 类型 | 数量 |
| --- | ---: |
| P0 总数 | 14 |
| P0 通过 | 14 |
| P0 失败 | 0 |
| P0 阻塞 | 0 |
| P1 总数 | 9 |
| P1 通过 | 8 |
| P1 部分通过 | 1 |
| P1 未执行 | 0 |

## 执行范围

执行对象来自 [AI Settings QA Acceptance Plan](../plans/2026-07-03-ai-settings-qa-acceptance-plan.md)。

已覆盖：

- AI 设置页分组、provider、base URL、model、API Key 表单。
- API Key 保存、fallback 状态、清除和 renderer 脱敏。
- Test connection 成功、失败、空 model、AI disabled 和请求边界。
- Markdown 外链修饰键打开行为。
- 打包 app 的真实 AI 设置 IPC、mock provider 请求和本地运行态。
- 构建、打包、package、runtime、checksum 门禁。

未覆盖或部分覆盖：

- 未使用真实 OpenAI 或 DeepSeek API Key 做线上调用。
- 旧版 Keychain key 文件已通过临时 userData runtime 验证，可清除且不触发系统钥匙串弹窗。
- 损坏 AI 设置文件已通过临时 userData runtime 验证，应用可正常打开设置页。

## 环境和数据准备

| 项目 | 实际准备 |
| --- | --- |
| 应用版本 | `0.1.4` |
| 平台 | macOS arm64 |
| 测试数据 | e2e fixture、占位测试 key、动态 mock provider、临时 userData |
| 外部依赖 | 真实 provider 未调用；Test connection 使用动态 mock provider |
| 清理策略 | Playwright browser context 自动清理；AI runtime 使用临时 userData 并在结束后删除；runtime smoke 恢复 note stream |

## Checklist 执行结果

| ID | 优先级 | 验收项 | 期望结果 | 实际结果 | 状态 | 原因 | 证据 | 清理 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AI-UI-01 | P0 | 设置页 AI 分组可见 | Settings 中可见 Appearance、Editor、AI 分组和 AI 表单 | e2e 与打包 app runtime 均能打开 AI 分组 | PASSED | 满足入口和字段可见要求 | `tests/e2e/ai-settings.spec.ts`；`npm run verify:ai-runtime` | 自动清理 |
| AI-UI-02 | P0 | provider 默认值正确 | DeepSeek/OpenAI/Custom 映射正确 | DeepSeek、OpenAI 默认值和 Custom 输入均通过断言 | PASSED | 表单映射符合计划 | `npm run test:e2e` 22 passed | 自动清理 |
| AI-KEY-01 | P0 | API Key 保存后不进 renderer 持久状态 | localStorage 和笔记正文不含测试 key | web e2e 和打包 app runtime 均确认 localStorage 不含测试 key | PASSED | 脱敏边界成立 | `npm run test:e2e`；`npm run verify:ai-runtime` | 临时 userData 删除 |
| AI-KEY-02 | P0 | API Key 保存失败可见 | 保存失败显示可见错误且输入可重试 | mock 保存失败时 UI 显示 `Could not save API key` | PASSED | 不再静默失败 | `tests/e2e/ai-settings.spec.ts` | 自动清理 |
| AI-KEY-03 | P0 | 本机 fallback 可识别 | `hasApiKey=true` 且 UI 显示 hidden/local 状态 | e2e 和打包 app runtime 均显示 `API key saved locally and hidden` | PASSED | 用户可感知 fallback，且不会在输入框回显密钥 | `npm run verify:ai-runtime` | 临时 userData 删除 |
| AI-KEY-04 | P0 | 清除 API Key | 清除后 `hasApiKey=false`，连接测试不可用 | e2e 与打包 app runtime 均能清除 key | PASSED | 清除链路可用 | `npm run test:e2e`；`npm run verify:ai-runtime` | 自动清理 |
| AI-CONN-01 | P0 | AI disabled 时不可测试连接 | 未启用 AI 时 Test connection 禁用或返回 disabled | e2e 验证默认 disabled 时按钮不可用 | PASSED | 未启用不会触发请求 | `npm run test:e2e` | 自动清理 |
| AI-CONN-02 | P0 | Test connection 成功 | mock provider 成功时显示 `Connection OK` | web e2e 和打包 app 主进程 mock provider 均通过 | PASSED | 成功链路可用 | `npm run test:e2e`；`npm run verify:ai-runtime` | mock provider 关闭 |
| AI-CONN-03 | P0 | Test connection 失败脱敏 | 失败提示可读且不泄露 key/header | mock 401 显示错误；UI 不显示测试 key 或 Authorization | PASSED | 错误 UI 脱敏 | `tests/e2e/ai-settings.spec.ts` | 自动清理 |
| AI-IPC-01 | P0 | renderer 只使用脱敏 IPC | renderer 不获取明文 key | 打包 app runtime 确认 localStorage 不含 key；IPC clone bug 已修复为 plain object payload | PASSED | renderer 持久状态脱敏 | `npm run verify:ai-runtime`；代码审查 | 临时 userData 删除 |
| MD-LINK-01 | P0 | Markdown 外链只通过修饰键打开 | 普通点击不打开，修饰键点击打开 http/https | e2e 验证外链行为和正文不变 | PASSED | 编辑体验不被普通点击破坏 | `tests/e2e/markdown-enhancements.spec.ts` | 自动清理 |
| GATE-01 | P0 | 全量自动化回归 | 全量 e2e 通过 | 22 passed | PASSED | 编辑器和 AI 设置回归均通过 | `npm run test:e2e` | 无 |
| GATE-02 | P0 | 生产构建和 macOS 打包 | build 与 build:mac 通过，生成 app 和 DMG | build:mac 通过；仅有既有 bundle 体积 warning 和未签名 warning | PASSED | 产物可生成 | `npm run build:mac` | 无 |
| GATE-03 | P0 | 构建后 app 冒烟 | 打包 app 无白屏，设置页可打开，保存有反馈 | runtime smoke 通过；AI runtime 打开设置页并保存/清除 key | PASSED | 真实打包应用链路通过 | `npm run verify:runtime`；`npm run verify:ai-runtime` | runtime smoke 已恢复 note stream |
| AI-UI-03 | P1 | 小窗口布局 | 小窗口下 AI 表单不遮挡 | 窄窗口 e2e 验证 AI 表单字段和按钮在 panel 内可见 | PASSED | 低宽度布局可用 | `tests/e2e/ai-settings.spec.ts` | 自动清理 |
| AI-CFG-01 | P1 | base URL 末尾斜杠兼容 | 不重复拼接 `/chat/completions` | 打包 app 对 `/v1/` 和完整 `/v1/chat/completions` 均请求同一路径 | PASSED | endpoint 规范化通过 | `npm run verify:ai-runtime` | mock provider 关闭 |
| AI-CFG-02 | P1 | 模型名为空 | 显示 `Model is required`，不误判成功 | e2e 通过 | PASSED | 空 model 有明确提示 | `tests/e2e/ai-settings.spec.ts` | 自动清理 |
| AI-CFG-03 | P1 | provider 切换后保留 key 状态 | 切 provider 不清除 key | e2e 通过 | PASSED | key 状态不丢失 | `tests/e2e/ai-settings.spec.ts` | 自动清理 |
| AI-SEC-01 | P1 | 日志脱敏抽查 | 日志不出现测试 key 或完整 Authorization | UI 和 runtime 输出不包含测试 key；未做完整系统日志采集 | PARTIAL | 缺少持久日志采集链路 | e2e UI 断言；runtime 输出摘要 | 无 |
| AI-DATA-01 | P1 | 旧 key 文件兼容 | 旧 Keychain 文件不会触发系统弹窗，并可清除 | `verify:ai-runtime` 预置旧 Keychain 记录后可打开设置页并 Clear | PASSED | 旧记录不再触发 macOS Keychain | `npm run verify:ai-runtime` | 临时 userData 删除 |
| AI-DATA-02 | P1 | 设置文件缺失或损坏 | 应用不白屏并恢复默认值 | `verify:ai-runtime` 预置损坏 `ai-settings.json` 后应用可打开 AI 设置页 | PASSED | 损坏设置文件回退默认值 | `npm run verify:ai-runtime` | 临时 userData 删除 |
| AI-ROLL-01 | P1 | 回滚策略 | 关闭 AI 不影响普通编辑 | 全量 e2e 和 runtime smoke 覆盖普通编辑、保存和 block 结构 | PASSED | 非 AI 主链路未回退 | `npm run test:e2e`；`npm run verify:runtime` | runtime smoke 已恢复 note stream |
| REL-01 | P1 | 发布产物校验 | package、checksum、安装阻拦说明可用 | package 验证通过，SHA256 校验 OK；Developer ID 缺失 warning 已记录 | PASSED | 小范围试用产物可校验 | `npm run verify:package`；`shasum -a 256 -c SHA256SUMS` | 无 |

## UI 截图证据

| 验收项 | 截图 | 说明 |
| --- | --- | --- |
| GATE-03 | 未写入持久报告 | `verify:runtime` 捕获了实际运行截图；因未上传远端图床，报告中不记录本地截图路径。 |
| AI-UI-01 / AI-KEY-03 | 未写入持久报告 | `verify:ai-runtime` 通过实际打包 app DOM 状态验证设置页和保存状态；未生成需持久引用的截图。 |

## 非 UI 证据

| 验收项 | 证据摘要 |
| --- | --- |
| GATE-01 | `npm run test:e2e`：22 passed |
| GATE-02 | `npm run build:mac`：build 和 macOS packaging 通过，生成 DMG |
| GATE-03 | `npm run verify:runtime`：app 启动、输入保存、block 结构保持、测试后恢复 note stream |
| AI runtime | `npm run verify:ai-runtime`：设置页可见、key 可保存/清除、renderer localStorage 无 key、provider 请求路径规范化、不发送笔记正文 |
| REL-01 | `npm run verify:package` 通过；`SHA256SUMS` 校验 `Vibenote-0.1.4-arm64.dmg: OK` |
| 静态检查 | `git diff --check` 通过 |

## 失败和阻塞项

无 P0 失败或阻塞。

P1 剩余项：

- `AI-SEC-01`：部分通过。已确认 UI 和 runtime 输出不泄露测试 key，但未采集系统级日志做完整扫描。

本次补充关闭项：

- `AI-DATA-01`：已通过 runtime 验证。旧 Keychain 格式可清除且不触发系统钥匙串弹窗。
- `AI-DATA-02`：已通过 runtime 验证。损坏 `ai-settings.json` 不会导致应用白屏。

## 覆盖总结

已覆盖高风险链路：

- 真实打包应用中的 AI 设置保存、IPC clone、API Key 本机 fallback、清除和连接测试。
- renderer localStorage 不保存明文 key。
- provider endpoint 规范化和测试请求不读取笔记正文。
- Markdown 外链增强和编辑器核心回归。
- 打包产物可校验。

未覆盖真实线上 provider 可用性，因为本次不使用真实 API Key。

## 清理记录

- e2e browser context 自动清理。
- AI runtime 使用临时 userData，执行结束后删除。
- mock provider 执行结束后关闭。
- runtime smoke 执行结束后恢复 note stream。
- 未写入或迁移 Heynote 数据。

## QA 建议

建议可以继续提交当前修改。P0 已全部通过，执行中发现的三个真实打包应用问题已修复并补入 `verify:ai-runtime` 防回归。

正式发版前建议补一项 P1：

- 若后续扩大分发范围，补充 Developer ID 签名/notarization 和更完整的日志脱敏检查。
