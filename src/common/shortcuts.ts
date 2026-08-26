export type ShortcutGroup = '应用' | 'Block' | '编辑' | '搜索' | '视图'

export type ShortcutDefinition = {
  id: string
  group: ShortcutGroup
  label: string
  keys: string[]
}

export const shortcutGroups: ShortcutGroup[] = ['应用', 'Block', '编辑', '搜索', '视图']

export const shortcuts: ShortcutDefinition[] = [
  { id: 'app:toggle', group: '应用', label: '显示或隐藏应用', keys: ['⌘ ⇧ Space'] },
  { id: 'file:new', group: '应用', label: '新建 Vibenote 文件', keys: ['⌘ N'] },
  { id: 'file:open', group: '应用', label: '打开文件', keys: ['⌘ O'] },
  { id: 'settings:toggle', group: '应用', label: '打开或关闭设置', keys: ['⌘ ,'] },
  { id: 'shortcuts:toggle', group: '应用', label: '打开或关闭快捷键', keys: ['⌘ /'] },
  { id: 'block:add-after', group: 'Block', label: '在当前 Block 后新增', keys: ['⌘ Enter'] },
  { id: 'block:add-before', group: 'Block', label: '在当前 Block 前新增', keys: ['⌥ Enter'] },
  { id: 'block:add-end', group: 'Block', label: '在笔记末尾新增 Block', keys: ['⌘ ⇧ Enter'] },
  { id: 'block:add-start', group: 'Block', label: '在笔记开头新增 Block', keys: ['⌥ ⇧ Enter'] },
  { id: 'block:split', group: 'Block', label: '从光标处拆分 Block', keys: ['⌘ ⌥ Enter'] },
  { id: 'block:delete', group: 'Block', label: '删除当前 Block', keys: ['⌘ ⇧ D', '⌃ ⇧ D'] },
  { id: 'block:select', group: 'Block', label: '选择当前 Block，再按一次全选', keys: ['⌘ A'] },
  { id: 'block:previous', group: 'Block', label: '跳到上一个 Block', keys: ['⌘ ↑'] },
  { id: 'block:next', group: 'Block', label: '跳到下一个 Block', keys: ['⌘ ↓'] },
  { id: 'block:fold-toggle', group: 'Block', label: '折叠或展开当前 Block', keys: ['⌘ ⌥ ['] },
  { id: 'cursor:add-above', group: '编辑', label: '在上方添加多光标', keys: ['⌘ ⌥ ↑'] },
  { id: 'cursor:add-below', group: '编辑', label: '在下方添加多光标', keys: ['⌘ ⌥ ↓'] },
  { id: 'language:focus', group: '编辑', label: '聚焦语言选择器', keys: ['⌘ L'] },
  { id: 'block:format', group: '编辑', label: '格式化当前 Block', keys: ['⌥ ⇧ F'] },
  { id: 'markdown:bold', group: '编辑', label: '加粗 Markdown 选区', keys: ['⌘ B'] },
  { id: 'markdown:italic', group: '编辑', label: '倾斜 Markdown 选区', keys: ['⌘ I'] },
  { id: 'markdown:link', group: '编辑', label: '插入 Markdown 链接', keys: ['⌘ K'] },
  { id: 'markdown:list-unordered', group: '编辑', label: '切换无序列表', keys: ['⌘ ⇧ 8'] },
  { id: 'markdown:list-ordered', group: '编辑', label: '切换有序列表', keys: ['⌘ ⇧ 7'] },
  { id: 'search:block', group: '搜索', label: '在当前 Block 中查找', keys: ['⌘ F'] },
  { id: 'search:document', group: '搜索', label: '在整篇笔记中查找', keys: ['⌘ ⇧ F'] },
  { id: 'replace:block', group: '搜索', label: '在当前 Block 中替换', keys: ['⌘ R'] },
  { id: 'replace:document', group: '搜索', label: '在整篇笔记中替换', keys: ['⌘ ⇧ R'] },
  { id: 'search:next', group: '搜索', label: '下一个搜索结果', keys: ['⌘ G', 'Enter'] },
  { id: 'search:previous', group: '搜索', label: '上一个搜索结果', keys: ['⌘ ⇧ G', '⇧ Enter'] },
  { id: 'view:font-increase', group: '视图', label: '增大编辑器字号', keys: ['⌘ +'] },
  { id: 'view:font-decrease', group: '视图', label: '减小编辑器字号', keys: ['⌘ -'] },
  { id: 'view:font-reset', group: '视图', label: '重置编辑器字号', keys: ['⌘ 0'] },
]
