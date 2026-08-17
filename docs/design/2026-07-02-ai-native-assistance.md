# AI Native Assistance

## 背景与目标

Vibenote 的 AI 能力服务于单一 note stream 中的即时写作，不把产品变成聊天工作台或全局整理器。AI 默认只读取当前选区或 block；任何正文替换都必须先展示结果，并由用户明确确认。

当前设置、OpenAI-compatible 非流式调用、选区快捷操作、Todo 提取和文档锚定的多建议卡片已经落地。本轮只收敛以下连续交互：

`选择内容 -> 选择动作或输入要求 -> 等待结果 -> 审阅回答或 diff -> 明确处理结果`

相关实施步骤见 [AI Native Assistance Implementation Plan](../plans/2026-07-02-ai-native-assistance-plan.md)，已交付基线见 [AI 建议卡片验收记录](../reports/2026-07-09-ai-suggestion-cards-acceptance.md)。

## 现状与问题

当前源码已经具备以下边界：

- renderer 从可见选区或当前 block 生成 `input`、`language`、`scope` 和来源范围。
- 主进程保存 provider 配置和本地 API Key 记录，renderer 只持有 `hasApiKey` 与 `keyStorage` 等脱敏状态。
- 主进程通过 OpenAI-compatible Chat Completions 一次性返回完整 JSON，不提供流式 chunk、工具调用或任务事件。
- 改写结果使用文档锚定的建议卡片，支持多卡片、拖动、缩放、来源返回、失败重试和 stale 校验。
- 选区快捷工具条已经提供“编辑、改写、提取 Todo”；自定义输入根据内容进入回答或改写呈现。

剩余问题是同一条交互链缺少一致表达：

- 生成中状态只有旋转图标和动作文字，无法表达已经等待多久。
- 选区工具条、自定义输入框、加载卡和完成卡的边框、阴影、间距、焦点及动效节奏不统一。
- 回答、diff、错误和 stale 状态共享一张卡片，但标题、内容和动作层级仍可更清楚。
- 当前没有结构化 Agent 事件，界面不能用模拟步骤伪装 Thinking、Tool Chips 或 Task Rows。

## 方案设计

### 采用原则

[Beautiful UI](https://www.beautifului.dev/) 只作为交互和视觉参考，不作为运行时依赖。Vibenote 保持 Vue 3、现有 CSS token 与 Lucide 图标体系，不引入 React、Tailwind 或新的 UI 组件库。如果复制了实质性实现代码，必须按其 [MIT License](https://www.beautifului.dev/license) 保留许可声明。

本轮采用四类原语：

| 原语 | 现有落点 | 采用内容 | 不改变的边界 |
| --- | --- | --- | --- |
| Selection Actions | 选区快捷工具条 | 紧凑动作层级、稳定锚定、键盘焦点 | 保留三个现有动作，不增加全局命令面板 |
| Prompt Bar | 自定义编辑或提问输入框 | composer 外观、焦点、提交与关闭反馈 | 不加入模型选择、语音、`@` 来源或 `/` 命令 |
| Loading State | 建议卡生成中状态 | 明确动作名称、shimmer、经过时间 | 不展示虚构步骤、思考过程或进度百分比 |
| Diff | 建议卡完成态 | 清楚的原文/建议层级、变化 token 聚焦、动作主次 | 不修改现有 diff 算法或来源一致性校验 |

### 交互状态

一张建议卡只允许以下状态转换：

```text
generating -> ready
generating -> error -> generating
generating -> closed
ready -> stale
ready|error|stale -> closed
```

- `generating`：显示真实动作名称和经过时间，不显示取消能力，避免暗示当前 IPC 支持中断。
- `ready + answer`：展示只读回答，不提供“替换原文”。
- `ready + diff`：展示原文与优化后内容，并提供替换、插入和复制。
- `error`：展示脱敏错误、安全说明、来源返回和重试；不提供无内容的插入或复制。
- `stale`：禁止替换，只允许回到原文、插入或复制。
- `closed`：移除卡片；如果它是最后一张生成卡，同时停止共享计时器。

### 数据流与计时

现有 `AiSuggestionCard` 保持 `mode`、`presentation`、`status`、来源快照、来源范围、锚点偏移和 frame 字段。本轮只增加一个运行时字段：

```ts
type AiSuggestionCard = ExistingAiSuggestionCard & {
  startedAt: number
}
```

数据流：

1. 用户触发动作后，renderer 读取当前选区或 block，并立即创建 `generating` 卡片。
2. `startedAt` 使用 `performance.now()`，不使用系统墙钟时间，也不持久化。
3. 只要存在 `generating` 卡片，一个 100ms 共享时钟更新显示时间；多个卡片不得各自创建 interval。
4. 请求完成、失败或卡片关闭后重新计算生成卡数量；数量为零时立即清理时钟。
5. 完整响应通过现有 `ai:complete` IPC 返回，更新为 `ready` 或 `error`。
6. 替换前继续比较当前来源范围和 `sourceText`；不一致时进入 `stale`，不覆盖新内容。

计时信息只存在 renderer 内存，不进入笔记、localStorage、设置、恢复文件或日志。

### 视觉与动效

- `src/style.css` 中现有 `--surface-*`、`--ink-*`、`--line-*`、`--accent-*` 仍是唯一主题来源。
- Selection Actions、Prompt Bar、Loading State 和完成卡使用相同的边框强度、圆角尺度、阴影层级和焦点环。
- 加载卡保持当前紧凑尺寸，完成后围绕原中心扩展；水平中心偏移不得超过 1px。
- diff 继续只突出变化 token，不给整行或目标列增加误导性底色。
- `prefers-reduced-motion: reduce` 下关闭 shimmer、旋转和位移动画，但保留动作名称、静态耗时、状态变化与全部操作。
- 所有截图只使用合成笔记内容，不包含真实笔记、密钥、机器路径或私人服务地址。

### 键盘与可访问性

- Selection Actions 保持 `role="toolbar"` 和可读名称。
- 打开 Prompt Bar 后焦点进入输入框；Esc 关闭并恢复编辑器焦点，Enter 提交。
- 打开或关闭 Prompt Bar 不改变原选区对应的请求上下文。
- 加载状态使用 `role="status"` 与 `aria-live="polite"`；经过时间更新不应每 100ms 重复触发完整播报，动态耗时应对辅助技术隐藏或降低播报频率。
- 可操作图标必须有可读 `aria-label`，键盘焦点不能被颜色或动效替代。

### 不采用的原语

- Approval Card：当前替换已经是显式确认；只有未来 Agent 能主动执行多步或外部操作时才需要独立审批。
- Chat、Sidebar Nav、Records/Filter Table、Insight Cards：会把单一 note stream 推向工作台。
- Recommendation Card 置信度：后端没有经过校准的置信度，不展示装饰性百分比。
- Fine-tune Card：设置页已有直接表单，不增加设计检查器式交互。

## 自闭环验证范围

本轮可以用本地源码、dev mock、Playwright、构建命令和合成截图完整闭环：

- Selection Actions 和 Prompt Bar 的焦点、选区上下文、键盘操作及请求 payload。
- Loading State 的动作名称、经过时间、共享计时器启停和 reduced-motion 行为。
- 回答、diff、error、stale 的 DOM 状态、按钮可用性和写入安全边界。
- 多卡片、来源锚定、拖动、缩放、窄窗口和主题回归。
- 公共仓库安全检查与生产构建。

不需要真实 API Key：e2e 使用现有 dev mock 或页面内 stub 返回合成响应。

## 验收标准

| ID | 验收条件 | 权威证据 |
| --- | --- | --- |
| AC-01 | 选区工具条保留“编辑、改写、提取 Todo”，Prompt Bar 的打开、Esc、Enter 不丢失请求上下文 | `tests/e2e/ai-settings.spec.ts` 的按钮、焦点、payload 断言 |
| AC-02 | 生成卡展示真实动作名称和一位小数秒数；可控时钟前进后耗时单调递增 | Playwright 可控时钟和 loading DOM 断言 |
| AC-03 | 多张生成卡共用一个计时源；最后一张完成、失败或关闭后停止更新 | Playwright 启动前包装 `setInterval`/`clearInterval`，断言活动计时器从 0 到 1 再回到 0 |
| AC-04 | 加载卡扩展为回答或 diff 时水平中心偏移不超过 1px，卡片仍锚定原来源 | Playwright `boundingBox()` 与滚动恢复断言 |
| AC-05 | answer 不出现替换按钮；diff 保持 token 级变化；error 只提供来源返回和重试；stale 禁止替换 | 四种合成响应状态的 e2e |
| AC-06 | 1158px 和 520px 宽度、浅色和深色下，工具条、输入框和卡片均位于 `.editor-host` 内且无裁切 | 几何断言和合成截图 |
| AC-07 | reduced-motion 下没有 shimmer、旋转或位移动画，文本与操作完整 | `page.emulateMedia({ reducedMotion: 'reduce' })` 后的 computed-style 与行为断言 |
| AC-08 | 现有多卡片、拖动、缩放、来源返回、stale 校验、替换、插入和复制测试不回退 | AI focused e2e 与全量 e2e |
| AC-09 | 没有新增 React、Tailwind 或 UI runtime；没有公共仓库敏感内容 | `package.json` diff、`npm run verify:public-safety`、`git diff --check` |

## 风险与边界

- 100ms 时钟只更新生成卡的显示值；不得触发 CodeMirror transaction、笔记保存或卡片重新定位。
- 多卡片可能遮挡编辑区；继续依靠拖动、缩放、关闭和来源离开时隐藏，不增加侧栏管理中心。
- 视觉验收不能只看 computed style；必须检查标准和窄窗口的实际截图。
- 本轮不修改 provider、API Key 存储、请求 prompt、response 解析、diff 算法或笔记写入逻辑。
- 本轮不承诺改进真实网络延迟，也不把耗时显示解释为模型进度。

## 非自闭环 Blocker

| 能力 | 阻塞原因 | 本轮可继续内容 | 解锁条件 |
| --- | --- | --- | --- |
| Streaming Text | `ai:complete` 只返回完整结果，没有 chunk、done、error、cancel 事件 | 完成非流式 Loading State 与回答卡 | 定义并实现可测试的流式 IPC，并明确取消语义 |
| Thinking、Tool Chips、Task Rows | 没有可信的结构化 Agent 事件 | 只显示真实动作名称和请求状态 | Agent runtime 输出带 ID、顺序、状态和错误的事件流 |
| Context Cards | 没有稳定、可跳转的 note/block/line 来源契约 | 继续只发送当前选区或 block | 完成来源契约、跳转行为和隐私评审 |

## 待确认点

本轮没有阻塞实施的待确认点。Provider 默认模型、流式协议和跨笔记检索均在范围外，不能在本轮顺带调整。

## 参考资料

- [Beautiful UI](https://www.beautifului.dev/)
- [Beautiful UI MIT License](https://www.beautifului.dev/license)
- [AI 建议卡片验收记录](../reports/2026-07-09-ai-suggestion-cards-acceptance.md)
