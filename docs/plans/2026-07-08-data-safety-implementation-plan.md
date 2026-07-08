# Data Safety Implementation Plan

## 背景与范围

本计划实现 Vibenote 的数据安全第一阶段。设计说明见 [Data Safety](../design/2026-07-08-data-safety.md)。

范围包括：

- 覆盖保存前备份。
- 最近草稿 recovery。
- 启动恢复扫描、状态栏提示和非破坏性恢复入口。
- 高风险操作前快照。
- 外部文件和图片隔离验证。
- 本地验证脚本与 e2e 回归。

不包括：

- 云同步。
- Time Machine 或 iCloud 配置自动化。
- 每个文本快照复制图片二进制。
- 多文件历史浏览器的完整 UI。

## 阶段计划

### 阶段 1：数据层备份与恢复

改动：

- 新增主进程 `BackupManager` 或等价模块。
- 为内部 stream、内部文件、外部文件生成稳定 `documentId`。
- 保存前先写 `recovery/<documentId>.vibenote`。
- 覆盖目标文件前写入旧内容快照。
- manifest 使用原子写入。
- 备份失败时阻止覆盖目标文件，并返回可读错误。

验证：

```sh
npm run build
node scripts/data-safety-runtime.mjs
```

阶段完成证据：

- 脚本能证明旧文件、备份文件和 recovery 文件内容分别正确。
- 模拟备份失败时，目标文件未被覆盖。
- 模拟主保存失败时，recovery 保留最新内容。

### 阶段 2：高风险操作前快照

改动：

- 删除 block、格式化、AI 替换、清空 stream 前触发强制快照。
- 快照 metadata 标记原因，例如 `delete-block`、`format-block`、`ai-rewrite`。
- 状态栏在快照失败时给出明确错误，不执行对应破坏性操作。

验证：

```sh
npm run test:e2e -- tests/e2e/editor-shortcuts.spec.ts --grep "delete|format|AI"
node scripts/data-safety-runtime.mjs --risk-actions
```

阶段完成证据：

- 每个高风险操作前都有新增快照。
- 快照失败时操作不会继续覆盖正文。

### 阶段 3：启动恢复提示

改动：

- 启动时扫描 recovery 和残留 tmp 文件。
- 如果 recovery 比目标文件新，renderer 收到脱敏恢复摘要。
- 第一版 UI 使用状态栏提示和设置页入口，不做复杂历史浏览器。
- 恢复动作默认非破坏性：插入为新 block。

验证：

```sh
npm run test:e2e -- tests/e2e/data-safety.spec.ts
npm run verify:runtime
```

阶段完成证据：

- 预置新 recovery 后启动，UI 显示恢复提示。
- 点击恢复后，内容以新 block 出现，原文件不被直接覆盖。
- 残留 tmp 不影响主文件加载。

### 阶段 4：图片与外部文件隔离验证

改动：

- 对应用数据目录图片模式增加隔离测试。
- 对当前文件旁边图片模式增加路径测试。
- manifest 记录图片引用、存在性、大小和 hash。
- 外部文件备份只写应用数据目录，不写用户原目录。

验证：

```sh
npm run test:e2e -- tests/e2e/editor-shortcuts.spec.ts --grep "image"
node scripts/data-safety-runtime.mjs --external --images
```

阶段完成证据：

- 两个不同文档的应用数据目录图片不在同一目录。
- 外部文件保存后，备份目录只出现在 `~/Library/Application Support/Vibenote/backups/`。
- 恢复 manifest 能报告图片存在或缺失。

### 阶段 5：发版前回归

验证：

```sh
npm run test:e2e
npm run build
npm run build:mac
npm run verify:package
npm run verify:runtime
npm run verify:stability
npm run verify:edges
node scripts/data-safety-runtime.mjs
```

阶段完成证据：

- 全量 e2e 通过。
- 打包应用可启动。
- 现有稳定性验证不回退。
- 新增数据安全脚本通过。

## 交付内容

- 主进程备份和 recovery 模块。
- 保存链路接入备份和 recovery。
- 高风险操作前快照 API。
- 启动恢复扫描 IPC。
- 状态栏或设置页恢复提示。
- `scripts/data-safety-runtime.mjs`。
- `tests/e2e/data-safety.spec.ts`。
- 数据安全验证报告。

## 验证方式

权威验证来源：

| 验证项 | 证据 |
| --- | --- |
| 原子保存不回退 | `npm run verify:stability` 输出 |
| 覆盖前备份存在 | `scripts/data-safety-runtime.mjs` 读取备份内容 |
| 保存失败不覆盖 | 故障注入后的目标文件内容对比 |
| recovery 可恢复 | 启动后 UI 状态和恢复后的新 block 内容 |
| 外部文件不被污染 | 用户原目录无隐藏备份目录，应用数据目录有备份 |
| 图片按文档隔离 | 两个文档生成不同图片目录 |

## 完成标准

- 正常保存、快速退出、重新打开均不丢内容。
- 任意覆盖保存前至少存在一个旧内容快照。
- 高风险操作前存在原因明确的快照。
- 保存失败时用户能看到错误，且旧文件或 recovery 至少保留一份可恢复内容。
- 启动时能发现并非破坏性恢复比主文件更新的草稿。
- 外部文件和图片隔离策略有自动化验证。

## Blocker 汇总

| Blocker | 影响 | 处理方式 |
| --- | --- | --- |
| 用户是否需要云同步 | 不影响本地数据安全第一阶段 | 先实现本地备份，后续单独设计同步。 |
| 恢复 UI 最终样式 | 不影响恢复数据层 | 第一版用状态栏提示和非破坏性恢复。 |
| 是否复制图片二进制到快照 | 影响磁盘占用 | 第一阶段只记录引用和 hash。 |

## 回退策略

- 如果备份模块引入保存失败，回退到当前原子写入路径，但保留 `recovery` 写入作为临时保护。
- 如果恢复 UI 影响主编辑器稳定性，隐藏 UI 入口，保留启动扫描日志和脚本验证。
- 如果高风险快照影响交互延迟，先只对删除、AI 替换、清空 stream 强制快照，格式化回退为普通覆盖前快照。
- 所有回退都不能删除已生成的备份和 recovery 文件。
