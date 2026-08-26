# Markdown 预览光标保持验收记录

设计说明：[Markdown Block Session Preview](../design/2026-08-25-markdown-block-session-preview.md)

实施计划：[Markdown Block Session Preview Implementation Plan](../plans/2026-08-25-markdown-block-session-preview-plan.md)

## 结论

右上角 Markdown 预览按钮现在只切换 Block 的呈现状态，不再主动重设 CodeMirror selection。进入预览和返回源码后，当前 Block 的逻辑光标位置保持不变。Block 开头可见时，预览贴着原 Block 顶部且不增加空白；开头已滚出视口时，预览贴住视口顶部。

## 根因与修复

原实现进入预览时明确把 selection 设置为 `block.content.from + 1`，退出时又设置为 `block.content.from`，因此位置变化是应用逻辑造成的，并非 CodeMirror replacement decoration 的自动映射。

修复移除了工具栏切换中的强制 selection。双击预览时采用条件行为：selection 已属于目标 Block 时保持原位；selection 属于其他 Block 时聚焦被点击 Block 的内容开头，保留多预览导航能力。

第二层问题来自视口布局：长 Markdown 源码被短预览替换后，文档高度骤减，普通 `scrollTop` 恢复会被浏览器滚动边界钳制。修复为预览状态仅记录已经滚出视口的布局偏移，并在 CodeMirror 完成异步测量后做两轮视觉锚点对齐。偏移不会用于仍然可见的源码，因此不会在预览顶部产生空白。

## 验收证据

- 最小回归将光标放在三行 Markdown 的 `2:5`，进入预览后仍为 `2:5`，返回源码后仍为 `2:5`。
- 可见 Block 顶部回归将光标放在第 2 行，进入预览后顶部误差不超过 1px，计算后的 `margin-top` 为 0。
- 长 Block 回归将光标放在第 45 行且把 Block 顶部滚出视口；进入预览后，预览与视口顶部误差不超过 1px，占位空间保持在视口外。
- 多预览测试确认退出非当前预览后，工具栏仍能正确操作被点击 Block。
- 源文本、预览只读保护、折叠互斥和持久化行为没有改变。

| 检查 | 结果 |
| --- | --- |
| 修复前最小复现 | 失败：期望 `2:5`，实际进入预览后为 `1:2` |
| 修复前长 Block 复现 | 失败：高度收缩导致视口位置变化 |
| 首轮视觉锚点复现 | 失败：Block 顶部可见时产生可见空白 |
| 光标与视口保持专项 | 2 passed |
| Markdown 预览与折叠联合回归 | 17 passed |
| 全量 E2E | 110 passed |
| 生产构建 | 通过 |
| 公共仓库安全检查 | 通过 |
| `git diff --check` | 通过 |

## 影响分析

- 代码影响：调整预览切换 transaction 的 selection 语义、预览状态的视觉偏移，以及退出预览的条件聚焦。
- 兼容性：不改变笔记格式、metadata、渲染输出或快捷键。
- 性能：不增加 IO；进入预览时增加常数级布局偏移计算和两次 animation-frame 对齐，不在滚动或输入热路径持续执行。
- 副作用：不会写入用户内容；跨 Block 双击仍会显式切换编辑上下文。

## 验证命令

```bash
npm run test:e2e -- tests/e2e/markdown-block-preview.spec.ts --grep "keeps the (logical cursor position|editor viewport stable)"
npm run test:e2e -- tests/e2e/markdown-block-preview.spec.ts tests/e2e/block-folding.spec.ts
npm run build
npm run test:e2e
npm run verify:public-safety
git diff --check
```

## 手工验收

- 已在最新本地打包的 macOS 应用中重复点击验收，确认预览不再改变逻辑光标位置，且可见 Block 顶部不会出现补偿空白。
