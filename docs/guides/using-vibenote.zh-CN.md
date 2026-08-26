# 使用 Vibenote

Vibenote 启动后直接进入一个持续增长的 note stream。在当前 block 中记录；想法或语言发生变化时创建新 block，其余交给自动保存。

长 Block 可以通过首行行号、当前 Block 工具栏或 `Command-Option-[` 折叠。首行行号只在交互时原位变为折叠控件；折叠后控件保持可见，并显示一行从源码确定性提取的摘要。折叠只改变本地视图状态，不修改 Block 源码；重新打开笔记时会恢复仍然有效的折叠范围。

## 快捷键

| 操作 | macOS 快捷键 |
| --- | --- |
| 显示或隐藏应用 | `Cmd+Shift+Space` |
| 打开或关闭设置 | `Cmd+,` |
| 打开或关闭快捷键面板 | `Cmd+/` |
| 在当前 block 后新增 block | `Cmd+Enter` |
| 在当前 block 前新增 block | `Option+Enter` |
| 在 note stream 末尾新增 block | `Cmd+Shift+Enter` |
| 在 note stream 开头新增 block | `Shift+Option+Enter` |
| 从光标处拆分 block | `Cmd+Option+Enter` |
| 删除当前 block | `Cmd+Shift+D` 或 `Ctrl+Shift+D` |
| 选择当前 block，再按一次全选 | `Cmd+A` |
| 跳到上一个 block | `Cmd+Up` |
| 跳到下一个 block | `Cmd+Down` |
| 在上方添加多光标 | `Cmd+Option+Up` |
| 在下方添加多光标 | `Cmd+Option+Down` |
| 聚焦语言选择器 | `Cmd+L` |
| 格式化当前 block | `Shift+Option+F` |

## 数据位置

Vibenote 把活动的内部笔记保存在独立的 Electron `userData` 目录中：

```text
$HOME/Library/Application Support/Vibenote/notes/stream.txt
$HOME/Library/Application Support/Vibenote/notes/stream.assets/
$HOME/Library/Application Support/Vibenote/images/
```

默认情况下，内部 stream 的图片保存在旁边的 `stream.assets/`。如果把图片存储方式设为应用数据目录，Vibenote 会改用 `images/`。旧版本还可能在 `notes/.images/` 中保留历史图片。

这些文件是唯一事实来源。可选的 [Git 快照备份](git-auto-backup.zh-CN.md)只会导出一份单向副本，不会改变 Vibenote 实际编辑笔记的位置。

排查问题、重新安装或手动修改应用数据前，请先退出 Vibenote，并把整个应用数据目录复制到安全位置。

## 卸载

删除应用：

```sh
rm -rf "/Applications/Vibenote.app"
```

删除应用不会同时删除笔记数据。只有在确认不再需要 note stream 和 recovery 文件后，才删除应用数据：

```sh
rm -rf "$HOME/Library/Application Support/Vibenote"
```
