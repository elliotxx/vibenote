# Agent 友好 CLI

## 背景与目标

Vibenote 已经具备本地纯文本、block 边界、原子保存、recovery、覆盖前快照和 Git 备份，但这些能力只通过 Electron 主进程的私有 IPC 提供。外部 Agent 目前只能绕过应用直接修改文件，既不了解 Vibenote 格式，也无法获得 revision、快照和冲突证据。

本设计把 CLI 定义为 Agent 使用的独立本地控制面。Vibenote 桌面应用未启动时，CLI 仍可发现、搜索、读取并安全追加笔记；桌面应用和 CLI 共享同一套存储语义，不各自实现文件读写。

首版闭环如下：

```text
发现能力 -> 搜索上下文 -> 有界读取 -> 预演追加 -> 带 revision 提交 -> 返回恢复证据
```

目标：

- 让 Codex、Claude Code、Cursor 和脚本通过稳定命令与 JSON 契约使用 Vibenote。
- 保持本地优先，不依赖桌面窗口、云服务、模型或网络。
- 首个 mutation 只允许向内部笔记追加 block，不覆盖既有原文。
- 每次实际写入都具备并发检查、幂等、快照、recovery 和原子替换。
- 为未来 MCP 提供共享核心，但首版不实现 MCP。

相关实施步骤见 [Agent 友好 CLI 实施计划](../plans/2026-08-12-agent-friendly-cli-implementation-plan.md)，实现证据见 [Agent 友好 CLI 验收报告](../reports/2026-08-13-agent-friendly-cli-acceptance.md)，竞品依据见 [Agent 友好型笔记工具调研](../research/2026-08-12-agent-friendly-note-tools.md)。

## 现状与问题

### 已确认现状

- 内部笔记位于 Electron `userData/notes`，`stream.txt` 是主 stream。
- 文档由首行 JSON metadata 和 `---block:<language>;auto=<0|1>;created=<time>` delimiter 组成。
- `FileLibrary`、`BackupManager`、格式解析和搜索逻辑分散在 Electron 主进程、renderer TypeScript 和编辑器模块中。
- 保存接口以文件 identifier 和完整正文为参数，返回布尔值，没有 revision 或 compare-and-swap。
- renderer 编辑后等待 350 ms 自动保存；应用关闭时再同步保存。
- 当前原子重命名可以防止半文件，但不能防止两个进程基于旧内容顺序覆盖。
- 现有 block 只有创建时间，没有正式稳定 ID。
- 外部文件可以登记后编辑，但不进入 Git 自动备份。

### 根本问题

直接给 `electron/main.js` 套一层 CLI 会形成浅模块：CLI、IPC 和未来 MCP 都需要了解 delimiter、文件路径、快照顺序和错误恢复。任何格式或安全修复都要跨多个入口同步修改。

普通文件锁也不足以解决问题。它只能阻止两个进程同时落盘，不能阻止桌面编辑器稍后用旧内存内容覆盖 CLI 已追加的 block。正确性必须同时依靠短时排他锁和 revision 校验；外部变更通知只改善体验，不能承担正确性。

## 方案设计

### 总体架构

新增一个无 Electron 依赖的 `NoteStore` 深模块。它的接口是桌面主进程、CLI、runtime verifier 和未来 MCP 共用的唯一存储 seam。

```text
                    +----------------------+
CLI adapter ------> |                      |
Electron adapter -> |      NoteStore       | -> notes / snapshots / recovery
Test adapter ------> |                      |
                    +----------------------+
                       parse / ID / lock
                       revision / CAS
                       idempotency / atomic save
```

建议目录：

```text
core/
  noteContract.js
  noteFormat.js
  notePaths.js
  noteStore.js
  noteSearch.js
  noteErrors.js
cli/
  vibenote.mjs
scripts/
  cli-runtime.mjs
```

首版使用项目现有的 Node ESM，不增加数据库、daemon 或 CLI 框架依赖。`noteContract.js` 是 schema 版本、退出码、错误码、命令、limit 和能力开关的唯一来源；`notePaths.js` 是 `userData`、notes、locks、snapshot 和 recovery 布局的唯一来源。help、capabilities、参数校验、Electron 和测试不得复制这些常量。参数解析保持小而明确；当命令面增长到现有解析器难以维护时，再独立评估 CLI 框架。

### NoteStore 接口

外部接口保持窄，不暴露文件路径、delimiter 或 BackupManager：

```js
class NoteStore {
  capabilities()
  doctor()
  listNotes(query)
  readNote(request)
  listBlocks(request)
  readBlock(request)
  search(request)
  appendBlock(request)
  saveNote(request)
}
```

`appendBlock` 内部完成以下全部行为：验证输入、获取 note 锁、重新读取、revision 校验、幂等检查、序列化新 block、创建旧内容快照、写入新 recovery、原子替换目标文件、返回结果。调用方不得自行组合这些步骤。

`saveNote` 只供桌面 adapter 使用，提交完整候选正文和 `expectedStorageRevision`。正常保存与 `appendBlock` 使用同一把 note 锁、相同的 snapshot/recovery/原子替换实现；若字节 revision 冲突，它不得改写目标 note，而是把 renderer 的候选正文保存为冲突 recovery，再返回 `STORAGE_REVISION_CONFLICT`。CLI 不暴露该接口，防止 Agent 绕过 append-only 边界。

所有依赖通过构造参数注入：`userDataPath`、时钟、UUID 生成器、文件系统 adapter 和应用版本。生产环境使用真实 adapter；runtime verifier 使用临时目录和可控故障 adapter。

### 数据身份与格式兼容

主 stream 沿用固定身份 `internal:stream`。新建内部文档在首行 metadata 保存 UUID，并使用 `internal:<uuid>`；旧的非 stream 文档没有 metadata ID，只返回路径派生的 legacy locator 和 `stable: false`，首版 CLI 允许读取但不允许 mutation，桌面端仍可通过受控的 legacy locator 保存。外部文件不进入首版 CLI。

桌面新建 block 使用 `crypto.randomUUID()` 生成 ID。CLI append 使用标准 UUIDv5：namespace UUID 及算法版本集中定义在 `noteContract.js`，name 为 `v1\0<noteId>\0<idempotencyHash>`。因此 dry-run、正式提交和同 key 重放会得到同一 block ID，同时不暴露原始 key；协议升级必须使用新 namespace 或 name 版本，不能静默改变既有映射。delimiter 升级为可扩展的键值格式：

```text
---block:markdown;id=550e8400-e29b-41d4-a716-446655440000;auto=1;created=2026-08-12T12:00:00.000Z
```

parser 不再依赖字段固定顺序，必须：

- 接受旧 delimiter。
- 接受字段顺序变化。
- 保留未知字段，避免未来版本读取后丢失 metadata。
- 拒绝重复关键字段、非法 ID、非法时间和换行注入。

只读命令不得偷偷改写旧笔记。旧 block 返回：

```json
{
  "id": null,
  "stable": false,
  "legacyIndex": 3
}
```

新格式 feature gate 开启后，新建 block 一律带 ID。旧 block ID 的批量迁移不属于首版；`doctor` 只报告数量。这样可以先安全开放 append，同时避免首次查询触发全库重写。

### Revision 与并发协议

对外 `revision` 是规范化内容的 SHA-256，格式为 `sha256:<hex>`。它覆盖 note 身份、名称、tags、block 顺序、block metadata、正文和所有未知 metadata 字段，但排除已明确列入白名单的 `cursors`、`foldedRanges` 等纯 UI 状态。未知字段默认参与 revision，避免误把未来业务字段当成 UI 状态。内部另算 `storageRevision`，它是目标文件完整 UTF-8 字节的 SHA-256。

Agent mutation 提交 `expectedRevision`：只有内容变化才发生冲突，光标移动不会让预演失效。桌面完整保存提交 `expectedStorageRevision`：任何外部字节变化都会阻止旧 renderer 覆盖文件。所有候选写入基于锁内最新原始字节生成，因此 Agent append 会保留最新 UI metadata。

每个 mutation 在 note 级短时锁内执行。锁使用 `mkdir` 的原子性创建在 `userData/runtime/locks/<document-key>.lock`，锁记录随机 owner ID、PID 和创建时间。锁只覆盖一次存储操作，不由 CLI 或桌面进程长期持有。

`appendBlock` 写入顺序：

1. 获取锁；超时返回 `NOTE_BUSY`。
2. 读取当前字节并计算 revision。
3. 检查 idempotency 标记；同 key 同请求直接重放，同 key 不同请求拒绝写入。该检查先于 revision，以便客户端在“写入成功但响应丢失”后安全重试。
4. 未命中幂等记录时，若调用方给出的 `expectedRevision` 不匹配当前内容 revision，返回 `REVISION_CONFLICT`，不写任何文件。
5. 计算候选内容并验证可重新解析。
6. 创建旧内容 snapshot。
7. 将候选内容写入 recovery。
8. 原子替换目标文件。
9. 释放锁并返回新 revision、block ID 和 snapshot ID。

`saveNote` 复用步骤 1、5 至 9，但步骤 2 至 4 改为校验 `expectedStorageRevision`。storage revision 不匹配时，目标 note、普通 snapshot 和常规 recovery 均不变，只新增一份带冲突类型和原 storage revision 的候选 recovery，然后返回冲突；该例外是为了保全尚未持久化的桌面编辑。

进程异常留下的锁只有在同时满足“锁超过保守期限”和“记录的进程已不存在”时才能隔离为 stale lock；无法证明时 fail closed。`doctor` 只报告锁状态和安全处理说明，不在普通读取中静默删除，也不在首版提供自动修复 mutation。

### 桌面应用协作

Electron adapter 改用相同的存储核心。加载文档时同时取得内容 revision 与 storage revision；追加等结构化操作使用 `expectedRevision`，renderer 的完整正文保存使用 `expectedStorageRevision`。

- 文件无外部变化：正常保存并更新本地 revision。
- CLI 写入且桌面没有未保存编辑：主进程的文件 watcher 通知 renderer 重新加载。
- CLI 写入且桌面有未保存编辑：字节级 CAS 拒绝旧内容保存；`saveNote` 把本地候选版本保留为冲突 recovery，暂停该文档自动保存，并显示冲突状态。用户可加载外部版本，再将 recovery 作为新 block 插入。

watcher 可能丢事件，因此它不能替代 CAS。即使 watcher 完全失效，旧 renderer 内容也不能覆盖更新后的文件。

默认目录 mutation 使用明确状态门禁：阶段 3 一律关闭；阶段 4 的 clean/dirty 协作、CAS 和新格式兼容验收全部通过后才开启；运行时发现存储或格式协议不兼容时返回 `DESKTOP_COORDINATION_UNAVAILABLE`。任何状态都不得降级为绕过 `NoteStore` 直接写入。

### 幂等协议

`blocks append` 要求 dry-run 和实际写入都提供 `idempotencyKey`。CLI 不把原始 key 写入笔记，只在新 block delimiter 中保存 key hash 和规范化请求指纹：

```text
request=sha256:<key-hex>;payload=sha256:<request-hex>
```

请求指纹覆盖算法版本、note ID、language、正文 UTF-8 字节和所有影响序列化的规范化选项，不覆盖 `expectedRevision`。字段顺序和编码规则由 `noteContract.js` 版本化定义。

同一 note 内重复 key：

- 对应 block 仍存在时，返回该 block、当前 revision 和 `replayed: true`。
- key hash 相同但请求指纹不同时，返回 `IDEMPOTENCY_MISMATCH`，不复用旧结果也不写入。
- 同一 hash 对应多个 block 时，返回 `IDEMPOTENCY_CORRUPT` 并停止。

幂等标记与 block 在同一次原子写入中落盘，因此进程在“写 note 后、写 sidecar 前”退出也不会造成重复。响应和日志不得回显原始 idempotency key。

### CLI 命令面

首版命令：

```text
vibenote version
vibenote capabilities
vibenote doctor
vibenote notes list
vibenote notes read
vibenote blocks list
vibenote blocks read
vibenote blocks append
vibenote search
```

典型 Agent 路径：

```sh
vibenote capabilities --output json
vibenote search --query "关键词" --limit 10 --output json
vibenote blocks list --note internal:stream --limit 20 --output json
printf '%s' '调查结论' | vibenote blocks append \
  --note internal:stream \
  --content-stdin \
  --idempotency-key task-123 \
  --dry-run \
  --output json
```

dry-run 返回 `expectedRevision` 和候选 block metadata，其中候选 block ID 由 note ID 与幂等 key hash 确定，正式提交会复用。dry-run 可短暂获取并释放 lock，但结束后不得留下任何持久状态，不创建 snapshot、不写 recovery。正式提交默认要求 `--expected-revision`；只有显式 `--accept-current` 才允许基于锁内读到的最新内容 revision 追加。

正文优先通过 stdin 输入，避免进入 shell history 和进程列表。`--content` 只作为短文本便利入口；两个入口不能同时使用。CLI 不在响应中回显完整写入正文。

### 输出契约

交互终端默认 human 输出；非 TTY 默认 JSON。Agent 应始终显式指定 `--output json`。`NO_COLOR` 和 `--no-color` 必须生效。

成功 stdout 只包含一个 JSON 文档，诊断信息不得混入 stdout：

```json
{
  "ok": true,
  "schemaVersion": "v1alpha1",
  "command": "blocks.append",
  "data": {
    "dryRun": false,
    "noteId": "internal:stream",
    "blockId": "550e8400-e29b-41d4-a716-446655440000",
    "previousRevision": "sha256:...",
    "revision": "sha256:...",
    "snapshotId": "...",
    "replayed": false
  },
  "warnings": []
}
```

失败时 stderr 只包含同一 schema 的错误 JSON，stdout 为空，并使用非零退出码：

```json
{
  "ok": false,
  "schemaVersion": "v1alpha1",
  "command": "blocks.append",
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "The note changed after it was read",
    "retryable": true
  }
}
```

退出码：`0` 成功，`2` 参数错误，`3` 未找到，`4` revision/锁冲突，`5` 权限或作用域拒绝，`6` 数据或恢复保护失败，`1` 未分类运行错误。日志消息和错误文案使用英文。

### 有界读取与搜索

Agent 读取必须默认有界：

- `notes list` 默认 20，最大 100。
- `blocks list` 默认 20，最大 100，使用不透明 cursor。
- `search` 默认 20，最大 100；snippet 默认最多 240 个 Unicode 字符。
- append 输入上限为 256 KiB UTF-8；超限返回 `CONTENT_TOO_LARGE`。
- `notes read` 默认返回 metadata 和 block 摘要，不直接返回整篇正文；完整原始内容要求 `--raw`，超过 1 MiB 时拒绝并提示改用 blocks 分页。
- `blocks read` 按稳定 block ID 返回内容，单次默认最多 64 KiB、最大 256 KiB，并用 `truncated` 和 `nextOffset` 支持续读；旧 block 只能用 note + legacy index 只读寻址，并明确 `stable: false`。

cursor 编码内容 revision 和下一个 block 位置。内容 revision 变化后继续使用旧 cursor 返回 `CURSOR_STALE`，不静默跳项或重复；纯 UI metadata 变化不使 cursor 失效。

搜索首版只覆盖内部 `.txt`，使用 fixed-string、大小写不敏感语义；结果返回 note ID、block ID 或 legacy locator、snippet、匹配位置和 revision。不得返回绝对路径。

### 路径、权限与隐私

CLI 通过共享 `resolveUserDataPath()` 解析数据目录，顺序是测试专用 `--data-dir`、`VIBENOTE_USER_DATA_DIR`、当前发行产物声明的默认 `userData`。CLI、Electron 和测试不得各自拼接系统主目录。首版发行目标由构建配置生成到 capabilities；当前默认是 macOS arm64，其他产物未声明支持时由 `doctor` 返回不支持。

实现阶段的 mutation 分两道门：阶段 3 只允许显式 `--data-dir`，环境变量和默认目录均只读；阶段 4 完成桌面协作验收后，随兼容桌面版本交付的 CLI 才能对默认目录写入。这样不会让尚未迁移 CAS 的旧桌面版本与新 CLI 共同写真实数据。

默认命令只允许内部 notes。以下能力不在首版：

- 任意绝对路径读取。
- 已登记外部文件读取或写入。
- recovery、backup、AI key 或设置文件读取。
- 网络访问和远程发布。

默认 JSON 不返回用户主目录绝对路径、正文 hash 以外的敏感派生值、原始 idempotency key、API key、prompt 或完整异常栈。`doctor` 只报告路径来源和可读写状态；显式 `--verbose` 才可显示本机路径，并在帮助中提示不要公开粘贴。

### 数据修改边界

本方案没有自动删除、覆盖旧 block、批量迁移或静默修复：

- list、read、search、doctor 和 dry-run 不改变 note、snapshot、recovery 或格式。
- CLI append 只在目标 note 末尾增加一个新 block；提交后既有 block 的字节和顺序必须保持不变。
- 旧 note、旧 block 和旧 metadata 不因读取或启用 CLI 被自动改写；新格式仅用于 feature gate 开启后的新增对象。
- 桌面 `saveNote` 仍是完整文件替换，但这是现有编辑保存能力的受控迁移；写入前必须通过 storage CAS，并先生成旧内容 snapshot 和候选 recovery。
- snapshot、recovery 和短时 lock 会新增辅助文件或目录；首版不提供自动清理、restore、delete 或覆盖 recovery 的命令。
- 阶段 4 验收通过前，CLI 不对默认真实数据目录执行 mutation。

因此首版不是“零写入”方案，但 Agent 能执行的唯一数据 mutation 是可预演、可幂等、可恢复的末尾追加；没有计划中的破坏性自动迁移或删除操作。

### 能力发现

`capabilities --output json` 是 Agent 的首个命令，返回：

- CLI 与 schema 版本。
- 支持的命令、参数和 mutation 风险等级。
- 支持的 note/block 格式版本。
- limit 与最大输入大小。
- `dryRun`、`revisionCheck`、`idempotency`、`snapshot` 能力。
- 当前只允许 internal notes 的 scope。

能力清单由 `noteContract.js` 的命令定义生成，不能维护第二份手写列表。help、参数校验、limits、退出码和 capabilities 使用同一注册表，防止文档漂移。

## 自闭环验证范围

首版验证完全使用临时 `userData`、合成笔记和独立子进程，不读取真实用户笔记。统一入口为：

```sh
npm run verify:cli
```

## 验收标准

| 能力 | 完成条件 | 权威证据 |
| --- | --- | --- |
| 独立运行 | 桌面应用未启动时可完成发现、搜索、读取、dry-run 和 append | `scripts/cli-runtime.mjs` 子进程结果 |
| 读取无副作用 | 所有只读命令前后 notes 目录总 hash 相同 | runtime hash 清单 |
| 结构化契约 | JSON 成功/失败均匹配固定 schema，stdout/stderr 不混流 | schema assertions 与退出码矩阵 |
| 稳定新 block | CLI 和桌面新建 block 均有合法唯一 UUID | parser/runtime 与编辑器测试 |
| 旧格式兼容 | 旧笔记可读且不被只读命令迁移 | fixture 前后字节 hash |
| 预演可靠 | dry-run 不写 note、snapshot 或 recovery，并返回可提交 revision | 三类目录前后 hash 与响应 |
| 幂等追加 | 同一 key 重试只存在一个目标 block | block count、block ID 与 `replayed` |
| 并发保护 | 两个旧 revision 写入不能都成功 | 双子进程测试结果与最终 parse |
| 数据保护 | 每次实际追加可定位旧内容 snapshot，新内容有 recovery | manifest、snapshot/recovery hash |
| 桌面协作 | 外部写入不会被旧 renderer 内容覆盖 | Electron e2e clean/dirty 两条用例 |
| 隐私边界 | CLI 默认不返回绝对路径、正文回显或 secret | 合成 canary 扫描与 public-safety gate |
| 回归安全 | 现有编辑、AI、数据安全和 Git backup 验证继续通过 | 现有 npm verification 命令输出 |

## 风险与边界

- note 级锁保证本机进程协调，不保证网络文件系统或第三方同步软件的分布式一致性。
- 新 delimiter 对当前旧 parser 不兼容；必须先发布“能读新旧格式但仍只写旧格式”的兼容阶段，再单独启用新格式写入。启用后不承诺更旧应用版本可以读取新 block。
- UUID namespace、请求指纹或 revision 规范一旦发布就是持久协议；只能版本化演进，不能原地改算法。
- CLI 不是 Git backup 的恢复入口；snapshot 是本次写入证据，Git backup 仍是异步派生保护层。

## 非自闭环 Blocker

| Blocker | 阻塞内容 | 可继续工作 | 解锁条件 |
| --- | --- | --- | --- |
| 公共安装方式 | 是否把 CLI 安装到 PATH、随 DMG 分发或单独发布 | 核心、CLI、runtime、应用协作均可本地完成 | 确定公开分发体验并在干净 macOS 用户环境验收 |
| 未签名应用 | 面向陌生用户的系统信任与安装体验 | 源码运行和本机验证 | Developer ID 签名与 notarization 决策 |
| 第三方同步目录 | iCloud/Dropbox 等并发语义 | 默认 userData 本地存储 | 选定目标同步系统并提供可复现实验环境 |
| Agent 客户端兼容 | Codex/Claude Code/Cursor 的提示和工具调用体验 | CLI JSON 合同与合成 Agent harness | 在目标客户端执行独立验收并由用户确认体验 |

这些 blocker 不阻塞首版 CLI 的本地实现和自动化闭环。

## 待确认点

当前没有阻塞第一阶段实现的待确认项；首版默认决策已在目标、命令边界和协议章节中定义，不在此维护第二份清单。
