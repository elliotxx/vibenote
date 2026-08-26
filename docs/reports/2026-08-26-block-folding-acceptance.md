# Block 折叠验收记录

设计说明：[Block Folding](../design/2026-08-26-block-folding.md)

实施计划：[Block Folding Implementation Plan](../plans/2026-08-26-block-folding-implementation-plan.md)

## 验收结论

Block 折叠已在现有行号 gutter 内实现，没有增加独立列，也没有改变正文起始位置。折叠只改变编辑器呈现和笔记 UI 元数据，源文本、复制语义与内容修订保持不变。

## 已验证行为

| 范围 | 结果 |
| --- | --- |
| 低打扰入口 | 展开态默认显示行号 `1`，悬停或键盘聚焦时在原位置切换为向下箭头；折叠态持续显示向右箭头 |
| 布局稳定性 | 折叠前后 gutter 数量均为 1，正文左边界像素坐标一致 |
| 折叠摘要 | 使用首个有意义的源文本行生成单行摘要，并展示语言与行数；不使用 AI，不创建卡片列 |
| 数据安全 | 折叠前后源文本逐字一致；普通编辑不能改写隐藏源码 |
| 持久化 | 精确 Block 内容范围会写入 `metadata.foldedRanges` 并在重载后恢复；失效范围会安全展开并清理 |
| 功能协同 | Markdown 预览与折叠互斥；搜索命中、语言切换、格式化和 AI 操作会先展开目标 Block |
| 可访问性 | gutter 与摘要均使用原生按钮、可聚焦、带展开状态和可读标签；支持 `⌘⌥[` 切换 |
| 适配 | 520 像素深色编辑器中摘要不溢出；reduced-motion 下关闭行号与箭头过渡 |

## 视觉验收

使用隔离的合成笔记在真实 renderer 中生成并人工检查了本地截图。截图确认折叠态仍只有一列行号 gutter，摘要与普通文本行保持同一内容轴，右侧元数据弱化显示，界面没有新增卡片边框或常驻操作列。截图属于临时验收证据，不进入 Git。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| Block 折叠专项 E2E | 6 passed |
| 折叠、Markdown 增强与预览联合 E2E | 25 passed |
| 全量 E2E | 108 passed |
| 生产构建 | 通过 |
| macOS arm64 本地包 | 构建与包结构验证通过，应用可启动 |
| 公共仓库安全检查 | 通过 |
| `git diff --check` | 通过 |

## 影响与兼容性

- 复用现有 CodeMirror 状态、装饰和行号扩展，没有引入新的 UI runtime、服务、数据表或后台任务。
- `foldedRanges` 属于可忽略的 UI 元数据；旧版本会保持全部展开，因此不需要源文件迁移或破坏性回滚。
- 折叠装饰只在文档、Block 表示、预览状态或折叠状态变化时重建；悬停切换由 CSS 完成，不触发编辑器状态更新。
- 当前范围仅支持平级 Block 折叠。Markdown 标题树、嵌套折叠、全部折叠与 AI 摘要不在本次范围内。

## 验证命令

```bash
npm run build
npm run test:e2e -- tests/e2e/block-folding.spec.ts
npm run test:e2e -- tests/e2e/block-folding.spec.ts tests/e2e/markdown-enhancements.spec.ts tests/e2e/markdown-block-preview.spec.ts
npm run test:e2e
npm run build:mac
npm run verify:package
npm run verify:public-safety
git diff --check
```

## 未验证项

- macOS 本地包已构建、通过结构验证并成功启动，但没有在打包应用中重复完整的折叠场景验收。
- 自动几何与样式断言不能替代最终主观视觉确认，最终密度与颜色偏好仍以产品评审为准。
