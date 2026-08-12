# Vibenote Docs

## 目录结构

- `design/`：设计说明、实现边界、交互原则。
- `plans/`：实施计划、阶段拆分、验证和回退策略。
- `reports/`：验证报告、发版检查、阶段性验收记录。
- `reference/`：长期有效的参考资料、约定和术语。
- `todo.md`：后续待办事项。

## 当前重点

- 保持单一 stream、block 化、纯文本的核心体验。
- Markdown 增强只做低干扰输入辅助，不引入重型知识库或富文本编辑器复杂度。
- AI Native 能力默认作用于当前 block 或选区，避免自动重写全局内容。
- 数据安全采用原子保存、覆盖前备份、草稿恢复和资源隔离的分层策略。见 [Data Safety](design/2026-07-08-data-safety.md)、[Data Safety Implementation Plan](plans/2026-07-08-data-safety-implementation-plan.md) 与 [Data Safety Acceptance](reports/2026-07-08-data-safety-acceptance.md)。
- Agent 友好能力先以独立 CLI 和共享 `NoteStore` 落地，首版只开放内部笔记读取与安全 append。见 [Agent 友好 CLI 设计](design/2026-08-12-agent-friendly-cli.md)、[实施计划](plans/2026-08-12-agent-friendly-cli-implementation-plan.md)、[竞品调研](research/2026-08-12-agent-friendly-note-tools.md)与[验收报告](reports/2026-08-13-agent-friendly-cli-acceptance.md)。
