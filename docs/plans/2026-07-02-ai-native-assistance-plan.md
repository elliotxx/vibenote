# AI Native Assistance Implementation Plan

## 背景与范围

本计划只实施 AI 交互视觉收敛。设计与验收条件见 [AI Native Assistance](../design/2026-07-02-ai-native-assistance.md)。设置、OpenAI-compatible 调用、Todo 提取和多建议卡片属于已交付基线，不在本轮重复实现；历史证据见 [AI 建议卡片验收记录](../reports/2026-07-09-ai-suggestion-cards-acceptance.md)。

本轮修改范围：

- `src/components/EditorPane.vue`：建议卡运行时计时、Selection Actions、Prompt Bar 和卡片状态呈现。
- `src/style.css`：统一视觉 token 使用、loading mark、shimmer、焦点和 reduced-motion。
- `tests/e2e/ai-settings.spec.ts`：状态、键盘、几何、主题、动效和安全边界回归。
- `docs/reports/`：实现完成后新增使用合成内容的验收记录。

不修改 provider、API Key 存储、IPC payload、prompt、response 解析、diff 算法、笔记格式和写入逻辑；不增加 React、Tailwind 或其他 UI runtime。

## 阶段计划

### 阶段 1：建立计时与状态契约

先补测试，再改生成中 UI：

1. 为建议卡增加运行时 `startedAt`，使用 `performance.now()`。
2. 实现一个 100ms 共享时钟；仅在存在 `generating` 卡时运行。
3. 最后一张生成卡完成、失败、关闭或组件卸载时清理时钟。
4. 将耗时格式固定为一位小数秒数，例如 `2.4s`。
5. 把动态耗时从高频 `aria-live` 播报中隔离，动作名称仍由 `role="status"` 表达。
6. 用 Vue/CSS loading mark、shimmer 动作名称和耗时替换旋转圈。

交付证据：

- Playwright 在应用脚本运行前包装 `window.setInterval` 和 `window.clearInterval`；两张 pending 卡仍只有一个活动计时器，全部进入终态或关闭后活动数回到零。
- pending e2e 证明 `0.0s -> 0.1s -> 1.0s` 单调递增。
- 完成、失败和关闭 e2e 证明耗时节点消失且卡片状态不再变化。
- loading 卡高度小于 120px、无内部滚动、位于 `.editor-host` 内。

### 阶段 2：统一选区操作与 Prompt Bar

1. 统一工具条和输入框的间距、边框、圆角、阴影、焦点及按压反馈。
2. 保留“编辑、改写、提取 Todo”三个动作、名称和 payload。
3. 打开输入框时保存当前请求上下文；Esc 关闭并恢复编辑器焦点，Enter 提交。
4. 不增加模型选择、语音、`@` 来源、`/` 命令或新的快捷键。

交付证据：

- e2e 断言三个按钮、输入框焦点、Esc、Enter、关闭后的编辑器焦点和最终 payload。
- 1158px 与 520px 宽度下，工具条和输入框边界都在 `.editor-host` 内。
- 浅色和深色截图仅包含合成笔记，显示焦点环且没有遮挡或裁切。

### 阶段 3：统一建议卡终态

1. 统一 answer、diff、error、stale 的标题区、内容区和动作区。
2. answer 只提供插入、复制和来源返回，不出现替换原文。
3. diff 保持现有 token 算法；替换原文为主操作，插入、复制和来源返回为次操作。
4. error 只提供脱敏错误、安全说明、来源返回和重试。
5. stale 禁止替换，保留来源返回、插入和复制。
6. 保持多卡片、来源锚定、拖动、缩放和滚动隐藏/恢复逻辑不变。

交付证据：

- answer、diff、error、stale 四种合成状态的按钮和 DOM 断言。
- token diff、多卡片、stale、移动缩放和来源滚动测试继续通过。
- 加载卡到完成卡的水平中心偏移不超过 1px。
- 1158px 与 520px、浅色与深色截图覆盖四种终态。

### 阶段 4：可访问性与闭环验证

1. 用 `page.emulateMedia({ reducedMotion: 'reduce' })` 验证 shimmer、旋转和位移动画关闭。
2. 验证 reduced-motion 下动作名称、耗时、状态变化和全部操作仍可用。
3. 运行 focused e2e、全量 e2e、生产构建、AI runtime、公共仓库安全检查和 diff 检查。
4. 使用合成内容生成临时截图并逐张检查像素连续性、边界、裁切、主题和焦点。
5. 构建 macOS 应用，验证真实 Electron 窗口中的编辑器焦点、选区工具条和建议卡定位。
6. 将命令结果、截图矩阵和未验证项写入新的验收报告；临时截图不进入 Git。

## 交付内容

- Vue/CSS 实现的 Loading State、Selection Actions、Prompt Bar 和建议卡视觉收敛。
- 可测试的共享计时控制与清理逻辑。
- AI focused e2e 和视觉矩阵证据。
- 不含真实用户内容的验收报告。

## 验证方式

实现完成后依次运行：

```sh
npm run test:e2e -- tests/e2e/ai-settings.spec.ts
npm run test:e2e
npm run build
npm run verify:ai-runtime
npm run build:mac
npm run verify:package
npm run verify:public-safety
git diff --check
open -n dist/mac-arm64/Vibenote.app
```

自动化矩阵：

| 维度 | 覆盖值 |
| --- | --- |
| 窗口宽度 | 1158px、520px |
| 主题 | light、dark |
| 动效 | normal、reduced-motion |
| 状态 | selection actions、prompt、loading、answer、diff、error、stale |

自动断言覆盖上述维度的有效组合，负责 DOM 状态、几何和 computed style。截图只保留以下 8 个代表性场景，避免重复证据：

| 宽度/主题 | 场景 |
| --- | --- |
| 1158px/light | loading、diff |
| 1158px/dark | answer、error |
| 520px/light | selection actions、prompt |
| 520px/dark | stale、diff |

reduced-motion 由 normal/reduce 两组 computed-style 与行为断言覆盖，不额外复制全部截图。所有测试使用合成笔记数据。截图负责像素连续性、视觉层级、裁切和遮挡。打包后的 Electron 窗口至少复核 normal/light 与 normal/dark 两组，不能用浏览器页面代替这一层证据。

## 完成标准

- AC-01 至 AC-09 均有测试输出、截图、构建结果或依赖 diff 作为证据。
- focused 与全量 e2e、生产构建、AI runtime、macOS 打包、包验证和公共仓库安全检查全部通过。
- 标准/窄窗口、浅色/深色、normal/reduced-motion 没有超界、裁切、焦点丢失或不可操作状态。
- 现有 AI payload、回答/改写判定、diff、来源一致性校验和笔记写入语义不变。
- `package.json` 未增加 React、Tailwind 或其他 UI runtime。
- 验收报告明确区分自动化通过、Electron 实机截图通过和未验证项。

## Blocker 汇总

| 能力 | 当前阻塞 | 本轮处理 | 解锁方 |
| --- | --- | --- | --- |
| Streaming Text | 缺少 chunk、done、error、cancel IPC 和取消语义 | 不实现；使用非流式 Loading State | 后续流式协议设计与主进程实现 |
| Thinking、Tool Chips、Task Rows | 缺少可信结构化 Agent 事件 | 不模拟；只显示真实动作和请求状态 | 后续 Agent runtime |
| Context Cards | 缺少稳定的 note/block/line 来源契约与隐私边界 | 不实现；上下文仍限当前选区或 block | 后续检索与隐私设计 |

这些 Blocker 不阻塞阶段 1 至阶段 4。

## 回退策略

- 每个阶段保持独立 diff，按阶段 3、2、1 的逆序回退；阶段 4 只增加验证与报告，不改变运行时。
- 如果共享计时器影响性能，回退经过时间与 shimmer，恢复静态动作文字；不得保留每卡一个 interval 的降级实现。
- 如果视觉样式造成窄窗口或可访问性回退，回退本轮 CSS 与模板结构，保留现有卡片状态和业务逻辑。
- 不得回退来源一致性校验、用户确认、原文保护或密钥脱敏边界。
