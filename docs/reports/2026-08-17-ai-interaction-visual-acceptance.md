# AI 交互视觉收敛验收记录

## 实现范围

- 参考 Beautiful UI 的 Selection Actions、Prompt Bar、Loading State 和 Diff 原语，使用现有 Vue、CSS token 与 Lucide 图标重新收敛交互视觉，没有引入新的 UI runtime。
- 建议卡增加仅存在于 renderer 内存的 `startedAt`，多张生成卡共用一个 100ms 计时器；最后一张进入终态、关闭或组件卸载时清理。
- 生成态展示真实动作、一位小数耗时、3×3 像素标记和 shimmer；reduced-motion 下保留文本与耗时并关闭动画。
- Prompt Bar 支持打开后聚焦、Esc 关闭并恢复编辑器焦点、Enter 提交，保持原选区请求上下文。
- answer、diff、error、stale 使用明确的动作边界：answer 不替换，error 只允许返回来源和重试，stale 不允许替换；建议卡与 Todo 提取错误会隐藏 URL、机器路径和凭据形态。
- 深色设置为编辑区和 AI 浮层提供明确的深色 token；520px 下动作区改为两列布局，避免按钮被卡片裁切。

## 自动化验收

| 项目 | 结果 |
| --- | --- |
| AI focused e2e | 33 passed |
| 全量 e2e | 92 passed |
| 生产构建 | 通过 |
| macOS arm64 打包 | 通过，生成 app 与 DMG |
| 包结构验证 | 通过；本机无 Developer ID，未执行签名与公证 |
| 打包应用 AI runtime | 通过 |
| 公共仓库安全检查 | 通过 |
| `git diff --check` | 通过 |

覆盖的关键行为包括：共享计时器从基线增加一个并回到基线、loading 到完成卡水平中心偏移不超过 1px、Prompt Bar 键盘焦点、四种终态动作边界、token diff、多卡片、来源锚定、拖动缩放、1158px 浅色、520px 深色和 reduced-motion。

## 视觉验收

使用合成笔记生成并检查以下 8 张临时截图，截图保存在 `/tmp/vibenote-ai-evidence`，不进入 Git：

- 1158px/light：loading、diff。
- 1158px/dark：answer、error。
- 520px/light：selection actions、prompt。
- 520px/dark：stale、diff。

视觉检查发现并修复了两个自动几何断言未暴露的问题：深色设置仍继承浅色 token，以及 520px diff 的最后一个动作被固定高度裁切。修复后重新检查对应深色与窄窗口截图，卡片边界、动作层级和内容均连续可见。

## 验证命令

```bash
npm run test:e2e -- tests/e2e/ai-settings.spec.ts
npm run test:e2e
npm run build
npm run build:mac
npm run verify:package
npm run verify:ai-runtime
npm run verify:public-safety
git diff --check
```

## 未验证项

- Computer Use 无法在本机同时存在已安装版与打包版相同 bundle ID 时稳定读取指定打包窗口；指定应用路径重试仍超时，因此没有把原生窗口截图列为通过证据。已终止本轮启动的隔离实例，没有访问已安装实例或真实用户数据。
- 打包应用的隔离 AI runtime 已完成设置、密钥脱敏、请求路径、建议插入与清理验证，但它不能替代原生窗口的人工视觉复核。
