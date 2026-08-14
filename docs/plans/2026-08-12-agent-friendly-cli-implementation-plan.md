# Agent 友好 CLI 实施计划

## 背景与范围

本计划实现 [Agent 友好 CLI 设计](../design/2026-08-12-agent-friendly-cli.md) 的首版闭环：在不启动桌面应用、不访问真实笔记、不依赖网络的条件下，Agent 能发现能力、搜索和有界读取内部笔记，并通过 dry-run、revision、幂等与 snapshot 安全追加一个 block。

计划优先完成可自闭环的共享核心和 CLI。MCP、HTTP、外部文件、高风险 mutation 和签名发布不进入本计划。设置页安装作为 2026-08-13 的阶段 6 扩展加入。

源码 alpha 已于 2026-08-13 完成本计划的本地闭环，验证结果见 [Agent 友好 CLI 验收报告](../reports/2026-08-13-agent-friendly-cli-acceptance.md)。默认真实目录写入与新格式桌面写入仍保持 feature gate 关闭，等待公开启用决策。

## 阶段计划

### 阶段 1：冻结格式、响应与测试契约

目标：先让格式兼容和 Agent 契约在合成数据上可失败、可验证，再迁移生产读写。

交付内容：

- 新增 `core/noteErrors.js`，定义稳定错误码、退出码映射和安全英文错误文案。
- 新增 `core/noteContract.js`，集中 schema、命令、limits、错误/退出码、UUID namespace、请求指纹版本和能力开关。
- 新增 `core/noteFormat.js`，集中 metadata、delimiter、稳定 note/block ID、revision 和 cursor 的解析/序列化。
- 新增 `core/notePaths.js`，统一 CLI、Electron 和测试的数据目录及存储布局解析。
- delimiter parser 改为无序键值解析，保留未知字段，兼容现有格式。
- 定义 `v1alpha1` 成功与失败 envelope，并增加 schema assertion。
- 建立只含合成文本、图片名和目录名的 CLI fixtures。

验证方式：

```sh
node --test tests/unit/note-format.test.mjs tests/unit/cli-contract.test.mjs
npm run verify:public-safety
```

必须证明：

- 旧格式 parse -> serialize 在未修改时保持字节不变。
- 新格式字段换序和未知字段不会丢失。
- 重复关键字段、换行注入、非法 UUID 和损坏 metadata 返回确定错误码。
- JSON envelope 没有绝对路径、完整正文或原始 secret 字段。
- help、capabilities、参数校验与 schema assertions 使用同一 contract，不复制 magic numbers。

完成标准：单元测试输出和 fixture 前后 SHA-256 同时通过。

### 阶段 2：建立 NoteStore 深模块

目标：把正确性集中到一个可由 CLI、Electron 和测试共同调用的 seam。

交付内容：

- 新增 `core/noteStore.js` 和 `core/noteSearch.js`。
- 实现内部 note 列表、metadata 读取、block 分页/读取和 fixed-string 搜索。
- 实现仅排除纯 UI 白名单字段的内容 revision、完整字节 storage revision、opaque cursor 和 `CURSOR_STALE`。
- 实现基于原子目录创建的 note 锁、超时和保守 stale-lock 判断。
- 实现 `appendBlock` 的 dry-run、CAS、幂等、snapshot、recovery 和原子替换。
- 实现桌面专用 `saveNote`：以 storage revision 做 CAS；冲突时不改目标 note，只保存候选正文为冲突 recovery。
- CLI block ID 按版本化 UUIDv5 contract 生成；幂等记录同时校验 key hash 和规范化请求指纹；桌面 block ID 使用注入的 UUID 生成器。
- 将应用版本、UUID、时钟和文件系统作为构造依赖，不在核心中读取 Electron 全局状态。

验证方式：

```sh
node --test tests/unit/note-store.test.mjs tests/unit/note-search.test.mjs
node scripts/note-store-runtime.mjs
```

故障矩阵必须覆盖：

| 注入点 | 预期结果 | 证据 |
| --- | --- | --- |
| 获取锁失败 | note 不变，返回 `NOTE_BUSY` | note hash 与错误码 |
| revision 不匹配 | 无 snapshot/recovery/目标写入 | 三类路径 hash |
| snapshot 失败 | note 不变 | 目标 hash 与 manifest |
| recovery 失败 | note 不变，旧 snapshot 可读 | note/snapshot hash |
| atomic rename 失败 | note 保持旧版或 recovery 保存候选新版 | parse 与 recovery hash |
| 同 key 重试 | 不新增 block | block count 与相同 block ID |
| 同 key、不同请求 | 无写入，返回 `IDEMPOTENCY_MISMATCH` | note hash 与错误码 |
| 桌面完整保存冲突 | 目标 note 不变，候选正文进入冲突 recovery | 目标/recovery hash 与错误码 |

完成标准：每个成功写入都有可验证 snapshot ID；每个失败场景都不存在半文件或无证据覆盖。

### 阶段 3：实现 Agent-first CLI adapter

目标：形成完整的独立子进程调用路径。

交付内容：

- 新增 `cli/vibenote.mjs` 和 package `bin` 入口。
- 实现 `version`、`capabilities`、`doctor`、`notes list/read`、`blocks list/read/append`、`search`。
- 支持 human/JSON 输出、TTY 判定、`NO_COLOR`、stdin 正文和确定退出码。
- 支持测试专用 `--data-dir`、环境变量和 macOS 默认目录解析；阶段 4 协作验收通过前，mutation 必须要求显式 `--data-dir`，不得写默认真实目录。
- capabilities、help 和参数验证从同一命令注册表生成。
- 限制 list/search 分页、snippet 和最大输入字节数。

端到端验证：

```sh
node scripts/cli-runtime.mjs
```

runtime 必须用子进程依次验证：

1. `capabilities --output json`。
2. `notes list`、`search`、`blocks list/read`。
3. stdin dry-run，复核所有持久路径无变化。
4. 用 dry-run revision 正式 append，并验证 block ID 与预演一致。
5. 独立比较写入前后的 block 序列和字节范围，证明只在末尾新增目标 block。
6. 重放相同 idempotency key，并用相同 key、不同正文验证 `IDEMPOTENCY_MISMATCH`。
7. 使用旧 revision 再写，得到冲突。
8. 两个并发子进程竞争相同 revision，最多一个成功。
9. stdout/stderr 分流、JSON schema 和退出码。

完成标准：`scripts/cli-runtime.mjs` 退出 0，并独立复核最终 note 可解析、block ID 唯一、snapshot/recovery hash 正确。

### 阶段 4：迁移 Electron 到共享核心

目标：消除 CLI 与桌面应用两套存储实现，建立 CAS 保存。

交付内容：

- 主进程通过 `NoteStore` 实现现有内部 buffer 的 list/load/save/snapshot/search。
- renderer 加载时保存 storage revision，后续 save/saveSync 传 `expectedStorageRevision` 并接收新的内容/storage revision；冲突候选只写 recovery，不改目标 note。
- 先迁移 parser，使桌面能读新旧 delimiter，但保持只写旧格式；通过旧格式回归后，再以独立 feature gate 启用 metadata UUID 和新 block delimiter。
- 新格式启用后，新建内部文档写入 metadata UUID；未带 ID 的旧非 stream 文档对 CLI 保持 `stable: false` 且只读，桌面仍经共享核心和 storage CAS 保存。
- 主进程监听内部 note 变化并向 renderer 发送 revision 事件。
- clean editor 自动加载外部更新；dirty editor 遇到冲突时保留 recovery、暂停自动保存并显示冲突入口。
- 外部文件暂时保留现有 adapter，但不得绕过 internal note 的共享核心。

验证方式：

```sh
npm run test:e2e -- tests/e2e/cli-coordination.spec.ts
npm run verify:runtime
npm run verify:data-safety
npm run verify:git-backup
```

`cli-coordination.spec.ts` 必须覆盖：

- 桌面打开但 clean 时，CLI append 后界面出现新 block。
- 桌面有未保存编辑时，CLI append 后旧 renderer 保存被拒绝，CLI block 保留，本地编辑进入 recovery。
- watcher 事件被测试 adapter 丢弃时，CAS 仍阻止旧内容覆盖。
- 关闭窗口的同步保存也携带 revision，不能绕开冲突检查。
- parser 兼容阶段仍只写旧 delimiter；打开 feature gate 后只新增带 ID block，不改写既有 block。

完成标准：CLI 和桌面没有任何可直接写内部 note 的第二条实现路径；clean/dirty 两条 e2e 均有磁盘 hash 和 UI 状态证据。

### 阶段 5：统一验收与开发者入口

目标：把本地自闭环固化为单一、可重复的交付 gate。

交付内容：

- 在 `package.json` 增加 `verify:cli`。
- 在 README 增加 CLI alpha 使用、安全边界和 Agent 示例，不宣传未实现的 MCP/HTTP。
- 在 `docs/README.md` 链接设计、计划和调研。
- 增加 CLI 合成数据的 public-safety canary，禁止真实笔记与本机路径进入 fixture、日志或截图。

最终验证：

```sh
npm run build
npm run verify:cli
npm run verify:runtime
npm run verify:data-safety
npm run verify:git-backup-export
npm run verify:git-backup-module
npm run verify:git-backup
npm run verify:stability
npm run verify:edges
npm run test:e2e
npm run verify:public-safety
git diff --check
```

完成标准：全部命令退出 0；若任何既有 gate 失败，必须定位并修复，不能以“与 CLI 无关”作为交付依据。

### 阶段 6：设置页一键安装

- 设置页展示未安装、已安装、可更新、冲突和应用位置不受支持状态。
- 安装到 `~/.local/bin/vibenote`，使用应用内 Electron runtime，不依赖系统 Node.js。
- 不修改 shell 配置；基于登录 shell 检测 PATH，并在缺少 `~/.local/bin` 时提示。
- 不覆盖符号链接、非受管同名文件或被修改的受管启动器；更新和卸载在最终变更点重新验证所有权。
- 仅允许从 `/Applications` 或 `~/Applications` 安装，避免移动应用后启动器失效。
- 通过打包应用的真实设置页执行安装，再由独立子进程验证 `version`、`capabilities` 和卸载。

## 组件责任

| 类别 | 预期文件 | 职责 |
| --- | --- | --- |
| 共享契约 | `core/noteContract.js`、`core/notePaths.js` | 协议常量、limits、能力与存储路径解析 |
| 格式核心 | `core/noteFormat.js` | 无序 metadata、旧格式兼容、稳定 ID、revision、cursor |
| 存储核心 | `core/noteStore.js` | append/save、锁、CAS、幂等、snapshot、recovery、原子写入 |
| 搜索核心 | `core/noteSearch.js` | block-aware fixed-string 搜索和有界结果 |
| 错误契约 | `core/noteErrors.js` | 错误码、退出码、安全消息 |
| CLI adapter | `cli/vibenote.mjs` | 参数、stdin、输出与进程退出 |
| Electron adapter | `electron/main.js`、`electron/preload.cjs` | IPC 到 NoteStore、revision 事件 |
| Renderer 协作 | `src/stores/workspace.ts`、`src/components/EditorPane.vue` | revision 状态、clean reload、dirty conflict |
| 自动验证 | `tests/unit/*`、`tests/e2e/cli-coordination.spec.ts`、`scripts/cli-runtime.mjs` | 合成数据闭环和故障注入 |
| 文档入口 | `README.md`、`docs/README.md` | 用户与 Agent 的可执行说明 |

实际实现可以在保持职责不变的前提下调整文件拆分；不得把核心写入语义重新放回 CLI 或 IPC adapter。

## 验证方式

阶段 1 至 6 的具体命令和场景即为执行顺序，最终统一由 `npm run verify:cli`、`npm run verify:agent-cli-install` 和现有回归 gates 收口。

### 验收证据保存原则

- 自动化只输出合成对象 ID、hash、计数、错误码和退出码。
- 不保存完整正文、真实用户目录、截图或真实 `userData`。
- runtime 使用系统临时目录并在成功结束后清理；失败时只报告经过脱敏的临时目录标识。
- 测试不能通过调用被测 `NoteStore` 自己来验证最终文件，必须使用独立 parser/hash 辅助逻辑。

## 完成标准

首版只有同时满足以下条件才算完成：

- 独立 CLI 在临时数据目录闭环执行成功。
- 只读命令无副作用，dry-run 无持久副作用。
- append 具备 revision、幂等、snapshot、recovery 和原子性证据。
- append 只新增末尾 block，既有 block 的字节、顺序和 ID 保持不变。
- 并发竞争不会产生双写成功或损坏文件。
- Electron 和 CLI 共用 NoteStore，旧 renderer 内容不能覆盖外部写入。
- 旧笔记只读兼容，新 block 全部有稳定 ID。
- stdout/stderr、JSON schema、退出码和读取上限稳定。
- 现有数据安全、Git backup、编辑器和 public-safety gates 全部通过。

完成不包括：MCP 可连接、Vibenote 自动修改 shell PATH、签名 DMG 已发布、任意 Agent 客户端体验已获用户认可。

## Blocker 汇总

非自闭环 blocker 及其解锁条件统一维护在[设计文档](../design/2026-08-12-agent-friendly-cli.md#非自闭环-blocker)。它们不阻塞阶段 1 至 5 的源码与合成数据闭环，但阻塞公共安装、无警告分发、第三方同步兼容和“所有 Agent 均体验友好”等对外结论。

## 回退策略

- 在阶段 4 前，CLI 默认只对临时或显式开发数据目录启用 mutation；不得对真实默认目录宣传可写。
- 阶段 4 如无法证明桌面 dirty 协作安全，保留独立只读 CLI，并让 mutation 在检测到桌面实例时 fail closed。
- 格式变更分两步发布：先部署兼容 parser 且继续写旧格式，再单独开启新格式 feature gate；关闭 gate 只能停止新增新格式，不能声称旧应用可以读取已经写入的新 block。
- CLI append 前的 snapshot 是单次回退依据；失败不得自动调用 Git reset、覆盖 recovery 或删除用户数据。
- 删除 CLI 入口不应影响桌面读取，因为 NoteStore 是共享核心；如需回退 adapter，只回退调用入口，不回退已写入的稳定 block ID。
