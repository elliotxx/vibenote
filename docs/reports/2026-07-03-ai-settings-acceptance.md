# AI Settings Acceptance Report

## 验收结论

当前阶段通过。已交付 AI 设置页、本机密钥保存、OpenAI-compatible provider 配置和连接测试。Explain 与 Rewrite 作为后续阶段保留，不计入本次已交付验收。

## 真实来源与范围

- 当前仓库：`repo root`
- 当前分支：`main`
- 用户校正后的范围：保留 Custom OpenAI-compatible；精简掉标题生成和续写；当前先闭环 AI 设置页与连接测试。
- 数据来源：应用设置页表单、Electron 主进程 userData 配置，以及本机 fallback 密钥保存状态。

## 端到端路径

本次验证覆盖从设置页到持久化和连接测试的真实应用路径：

1. 打开应用设置页。
2. 启用 AI。
3. 切换 DeepSeek、OpenAI、Custom OpenAI-compatible provider。
4. 保存 API Key。
5. 执行 Test connection。
6. 检查 renderer localStorage 不包含明文 API Key。
7. 模拟 API Key 保存失败时，设置页显示可见错误。
8. 生产构建并打包为 macOS app。
9. 打开构建后的 app。

UI 截图已作为本地验收产物生成。仓库文档未嵌入本地绝对路径，避免提交机器相关引用。

## 命令与结果

```sh
npm run test:e2e
```

结果：22 passed。

```sh
npm run build
```

结果：通过。Vite 仍提示主 bundle 超过 500 kB，这是既有体积警告，不影响本次功能。

```sh
npm run build:mac
```

结果：通过，生成 `dist/Vibenote-0.1.4-arm64.dmg`。

```sh
npm run verify:runtime
npm run verify:ai-runtime
```

结果：通过。构建后的应用可启动、可保存编辑内容；AI 设置页在打包应用中可见，API Key 可保存和清除，renderer localStorage 不包含测试 key，Test connection 通过 mock provider 验证。

```sh
open -n dist/mac-arm64/Vibenote.app
```

结果：已启动构建后的应用进程。

## 代码影响分析

- 设置页新增 AI 分组，展示 Enable AI、Provider、Base URL、Model、API Key 和 Test connection。
- 主进程新增 AI 设置和 API Key 保存路径；renderer 只获取脱敏的 `hasApiKey` 和存储状态。
- preload 新增 AI IPC 暴露层。
- dev mock 新增同形状 AI 接口，用于 e2e 覆盖。
- e2e 新增 AI 设置页用例，覆盖保存成功、保存失败可见错误、fallback、清除、provider 切换、空 model、小窗口布局，并保留既有编辑器和 Markdown 验证。

## 兼容性分析

兼容性好。现有笔记文件、block 格式、图片路径、Markdown 输入增强和普通设置项没有迁移要求。未启用 AI 时，现有编辑流程不变。

## 边界分析

- 当前阶段只验证 AI 设置页、本机密钥保存和连接测试。
- 当前阶段不实现 Explain、Rewrite、标题生成、续写、RAG、向量库或全局整理。
- Custom OpenAI-compatible 按 `/chat/completions` 兼容路径测试，不承诺支持 provider 私有扩展字段。

## 性能分析

设置页保存只增加少量本地文件 IO。Test connection 只在用户点击时触发一次外部请求，不增加编辑器常驻开销。

## 副作用分析

- 会在 Electron userData 下写入 AI 非敏感设置和 API Key 文件；首发候选使用本机 fallback，并在 UI 明示。
- Test connection 会向用户配置的 provider 发起一次网络请求。
- 不写入笔记正文，不修改 Heynote 数据，不创建后台定时任务。

## 未验证项

- 未使用真实 OpenAI 或 DeepSeek API Key 做线上连接测试；e2e 使用 dev mock 验证 UI 与数据流，`verify:ai-runtime` 使用本地 mock provider 验证打包应用主进程请求链路。
- 未实现 Explain 与 Rewrite，因此没有对 AI action 的真实模型输出做验收。
