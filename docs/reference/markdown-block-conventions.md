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
