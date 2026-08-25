# Markdown Block Conventions

## 原则

- Markdown block 是纯文本记录单元。
- 视觉增强不能改变复制结果和保存格式。
- 输入辅助应减少打断，不增加新面板或复杂模式。
- AI 能力默认限制在当前 block 或选区。

## 支持能力

- 语法高亮：标题、列表、任务列表、引用、链接、图片语法、分割线、代码块、行内代码、加粗。
- 快捷输入：加粗、斜体、链接、有序列表、无序列表。
- 列表续行：Enter 自动续写，空列表项退出。
- 任务列表：点击 checkbox 切换 Markdown 标记。
- 会话预览：仅通过当前 Markdown block 工具条显式进入整块只读排版；刷新后恢复源码态，不写入 delimiter 或笔记内容。

## 复制约定

- 编辑器中的复制和剪切始终使用 Markdown 原文，并排除 `---block:` delimiter。
- 唯一例外是完全位于单个只读排版预览内的浏览器选区：复制返回可见文本；剪切不修改原文。

## 存储约定

任务列表以 Markdown 原文保存：

```md
- [ ] task
- [x] done
```

图片继续以 Markdown 图片语法保存：

```md
![image](</absolute/path/to/image.png>)
```
