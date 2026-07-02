# Markdown Enhancements Verification

## 目标

用 TDD 方式实现 Markdown block 第一优先级编写增强，并沉淀 e2e 覆盖与验证记录。

## TDD 过程

先新增 `tests/e2e/markdown-enhancements.spec.ts`，覆盖以下行为：

- Markdown 常见语法高亮保持纯文本存储。
- `Cmd/Ctrl+B`、`Cmd/Ctrl+I`、`Cmd/Ctrl+K`、`Cmd/Ctrl+Shift+8`、`Cmd/Ctrl+Shift+7` 快捷输入。
- `Enter` 续写无序列表、有序列表，并从空列表项退出。
- 点击任务 checkbox 在 `- [ ]` 与 `- [x]` 之间切换。

红灯结果：

```text
npm run test:e2e -- tests/e2e/markdown-enhancements.spec.ts
4 failed
```

失败原因符合预期：对应高亮类、快捷键行为、列表续行和任务 checkbox 尚未实现。

## 绿色验证

实现后重新运行：

```text
npm run test:e2e -- tests/e2e/markdown-enhancements.spec.ts
4 passed
```

全量 e2e：

```text
npm run test:e2e
13 passed
```

生产构建：

```text
npm run build
passed
```

构建输出存在 Vite 大 chunk 提醒，这是既有打包体积提醒，不阻断本次验收。

## 覆盖范围

| 能力 | 覆盖文件 | 结果 |
| --- | --- | --- |
| Markdown 语法高亮 | `tests/e2e/markdown-enhancements.spec.ts` | 通过 |
| Markdown 快捷输入 | `tests/e2e/markdown-enhancements.spec.ts` | 通过 |
| 列表续行与退出 | `tests/e2e/markdown-enhancements.spec.ts` | 通过 |
| 任务 checkbox 切换 | `tests/e2e/markdown-enhancements.spec.ts` | 通过 |
| 现有选择、复制、图片、block 行为回归 | `tests/e2e/editor-shortcuts.spec.ts` | 通过 |

## 结论

第一优先级 Markdown block 编写增强已满足当前验收标准。底层仍保持纯文本 Markdown，不引入独立文档树、富文本存储或全局自动整理。
