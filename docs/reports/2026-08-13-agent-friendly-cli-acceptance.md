# Agent 友好 CLI 验收报告

## 验收结论

Agent 友好 CLI alpha 的源码实现与本地自动化闭环通过。CLI 可独立于桌面窗口运行，提供能力发现、内部笔记列表/读取、block 列表/读取、固定字符串搜索和安全 append。写入具备 dry-run、内容 revision、幂等请求指纹、snapshot、recovery、note lock 与原子替换。

默认真实数据目录 mutation 仍保持关闭；alpha 写入必须显式提供 `--data-dir`。新 block delimiter 的桌面写入 feature gate 默认关闭，先交付兼容 parser，再决定公开启用时点。公共 PATH 安装、签名发布、MCP 和第三方同步兼容不在本次完成范围。

## 分阶段结果

| 阶段 | 实现 | 验证结果 |
| --- | --- | --- |
| 共享契约与格式 | 集中 schema、limits、退出码、路径、UUIDv5、请求指纹和新旧 delimiter parser | 通过 |
| NoteStore | 有界读取、搜索、双 revision、锁、幂等 append、snapshot/recovery、桌面 storage CAS | 通过 |
| CLI adapter | JSON/stdout/stderr 契约、stdin、确定退出码、显式目录写入门禁 | 通过 |
| Electron 协作 | preload 维护 storage revision；clean 自动加载外部更新；dirty CAS 冲突保留 recovery | 通过 |
| 兼容与安全 | 旧格式只读不改写；桌面新格式写入默认关闭；外部文件继续使用原 adapter | 通过 |

## 真实端到端路径

`scripts/cli-runtime.mjs` 在系统临时目录创建合成 stream，通过真实 CLI 子进程执行：

```text
capabilities -> notes list -> search -> blocks list
-> dry-run -> revision apply -> idempotent replay
-> mismatched payload rejection -> stale revision rejection
-> two-process concurrency competition -> independent file/hash verification
```

`scripts/cli-coordination-runtime.mjs` 启动新构建的 macOS `.app`，使用隔离 `userData` 验证两条生产路径：

- clean editor 收到 CLI append 后，由文件 watcher 通知并加载新 block。
- dirty editor 收到 CLI append 后不覆盖外部版本；延迟 autosave 被 storage CAS 拒绝，本地草稿进入 recovery，目标 note 保留 CLI block。

验收使用无可见窗口的 headless Electron 模式，因此没有生成或提交含笔记内容的截图。磁盘 note、recovery 和运行时断言是该路径的权威证据。

## 已执行命令

以下命令在当前实现上成功完成：

```sh
node --test tests/unit/*.test.mjs
npm run verify:cli
npm run build
npm run verify:runtime
npm run verify:data-safety
npm run verify:cli-coordination
npm run verify:stability
npm run verify:edges
npm run verify:ai-runtime
npm run verify:git-backup-export
npm run verify:git-backup-module
npm run verify:git-backup
npm run test:e2e
npm run verify:public-safety
npm run test:public-safety
git diff --check
```

单元测试共 17 项，Playwright E2E 共 75 项。macOS `.app` 通过 `electron-builder --mac dir --arm64` 生成并用于协调、数据安全、稳定性、Git 备份和边界验收。DMG 生成不是本次 CLI 源码验收条件。

## 影响与兼容性

- 新增 `core/` 共享模块和 `cli/` adapter；Electron 内部笔记保存迁移到 `NoteStore`，外部文件路径保持原实现。
- preload 的公开 `load/save/saveSync` 返回形态对 renderer 保持不变，storage revision 在 bridge 内部维护。
- 旧 delimiter 可读取且只读命令保持原始字节；未知字段被保留。
- 新 delimiter 写入默认关闭，避免尚未经过兼容阶段的旧应用读取新格式。
- CLI package 文件已进入 Electron 构建清单，但公共安装方式仍未决定。

## 边界、性能与副作用

- CLI mutation 仅允许 internal append，不提供 replace、delete、move、restore、外部文件或任意绝对路径访问。
- 每次成功 append 增加一次旧内容 snapshot、一次候选 recovery 和一次目标原子替换；这是预期额外 IO。
- 搜索当前逐个读取内部 `.txt`，适合首版小型本地库；大库索引和增量 events 不在本次范围。
- note lock 只协调本机进程，不保证网络文件系统或第三方同步软件的分布式一致性。
- 测试只使用合成临时数据，成功与失败路径均清理隔离目录；没有访问或修改真实用户笔记。

## 未验证与 Blocker

- 公共 PATH/DMG 中的 CLI 安装体验。
- Developer ID 签名与 notarization。
- iCloud、Dropbox 等第三方同步目录并发。
- 目标 Agent 客户端的主观工具调用体验。
- MCP、HTTP、高风险 mutation 与恢复命令。
