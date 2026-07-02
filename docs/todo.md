# Todo

## 第二优先级 Markdown 增强

- 代码块增强：输入 fenced code block 时自动补全闭合标记，并为代码块内部提供基础语言高亮。
- 链接点击行为：支持 `Cmd/Ctrl+Click` 打开链接，普通点击仍保留编辑行为，避免误触。
- 图片行操作：支持复制图片路径、复制 Markdown、在 Finder 中显示；删除本地图片文件需要单独确认，默认只删除 Markdown 行。
- Markdown folding：支持按标题折叠内容，但需要评估是否会破坏当前极简 stream 体验。

## 设计约束

- 不引入侧边栏、文档树或多 buffer 模式。
- 不把 Markdown block 改造成完整预览编辑器。
- AI 相关增强只作用于当前 block 或选区，避免破坏性全局整理。
