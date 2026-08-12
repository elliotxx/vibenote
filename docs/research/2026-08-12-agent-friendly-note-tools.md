# Agent 友好型笔记工具调研

## 结论摘要

截至 2026-08-12，社区中最值得 Vibenote 学习的不是“内置了多少 AI 功能”，而是笔记产品是否把数据和动作变成 Agent 可稳定调用、可限制、可预演、可恢复的契约。

Vibenote 已经拥有三个很好的基础：本地纯文本、明确的 block 边界、原子保存与恢复/快照机制；它缺少的是面向外部 Agent 的产品表面：稳定对象 ID、无界面 CLI/API、结构化结果、安全的增量写入、并发保护、权限与审计。当前 Electron preload IPC 只服务内置渲染器，不是可供 Codex、Claude Code、Cursor 等通用 Agent 发现和调用的公共契约。[Vibenote README](../../README.md)、[note format](../../src/common/noteFormat.ts)、[preload bridge](../../electron/preload.cjs)

建议的产品定位是：**本地优先、block 原生、默认只读、写入可预演且可撤销的 Agent scratchpad**。不必追随 Obsidian/Logseq 的完整知识图谱，也不应先做 RAG 或全局自动整理。第一优先级应是共享核心上的官方 CLI，第二优先级是安全的增量写入和 MCP 适配，第三优先级才是后台自动化、事件订阅和语义检索。

## 研究范围与方法

- 研究时间：2026-08-12。
- 竞品范围：Obsidian、Logseq、SiYuan、AFFiNE、AppFlowy；为补齐成熟 REST API/CLI 与原生 MCP 两类样本，增加 Joplin 与 Anytype。
- 证据范围：官方产品文档、官方 GitHub 仓库、官方 API/插件文档。没有把第三方插件的能力算作产品原生能力。
- 价格与市场规模：本报告不研究。部分能力可能属于测试版、nightly、订阅服务或特定部署方式，实施决策前应再次核验。
- “未找到官方能力”只表示本次一手资料检索未发现，不能证明产品绝对不存在该能力。

## “Agent 友好”的定义

Agent 友好不是“能调用大模型”，而是满足以下七层契约：

1. **可发现**：Agent 能通过 CLI help、OpenAPI、MCP tools/list 或机器可读能力清单知道能做什么。
2. **可寻址**：笔记、block、附件具有稳定 ID 或规范 URI；不能只依赖可能重名的标题和易漂移的行号。
3. **可读取**：支持搜索、分页、字段裁剪和结构化输出；能只取必要上下文，避免把整个笔记库送入模型。
4. **可增量写入**：优先提供 append、insert-after、replace-if-unchanged、toggle-task 等窄动作，而不是默认全文覆盖。
5. **可控制**：有只读/写入权限、作用域、token 或本机授权，内容数据与工具指令边界清晰。
6. **可预演与恢复**：写入支持 dry-run/pretend、乐观并发检查、原子提交、undo/快照和幂等键。
7. **可观察**：返回变更对象、revision、备份 ID 和警告；有不泄露正文/密钥的本地审计记录。

MCP 只是第 1 层和调用传输的一种实现。一个有稳定 CLI、JSON 输出、鉴权 REST API 和恢复机制的工具，可能比只有薄 MCP 包装但缺少安全语义的工具更 Agent 友好。

## Vibenote 当前基线

### 已具备

- 本地文件是数据源，内部笔记使用 `.txt`；格式由一行 JSON metadata 与 `---block:<language>;auto=<0|1>;created=<timestamp>` block delimiter 组成，天然适合局部上下文。[note format](../../src/common/noteFormat.ts)、[block parser](../../src/editor/blocks.ts)
- 文件保存使用原子写入，覆盖前建立恢复数据与快照；外部文件必须先登记，避免任意绝对路径访问。[main process](../../electron/main.js)
- 已有 buffer 列表/读写/新建/删除、library search、恢复、图片与 Git backup 的内部 IPC；搜索由主进程实现。[preload bridge](../../electron/preload.cjs)、[main process](../../electron/main.js)
- 可选 Git backup 是单向、限定 pathspec 的派生快照，并带 manifest/hash 校验，可成为 Agent 写入后的恢复证据。[Git backup design](../design/2026-08-11-git-auto-backup.md)
- 内置 AI 被限制在当前选区或 block；改写采用建议卡和来源文本校验，体现了“先建议、后确认”的产品原则。[AI native design](../design/2026-07-02-ai-native-assistance.md)

### 关键缺口

- block 没有独立稳定 ID；`created` 时间戳不是明确身份契约，标题、偏移和正文 hash 都会随编辑漂移。
- 没有公开 CLI、REST/OpenAPI、MCP 或 URL scheme，外部 Agent 无法发现能力。
- preload IPC 是 renderer 信任边界内的私有接口，缺少外部调用需要的版本、鉴权、作用域、幂等与审计语义。
- 读写返回值主要是布尔值或原始内容，没有统一的 JSON envelope、revision、变更摘要、backup ID。
- 没有 dry-run、compare-and-swap/expected revision、批量事务或 Agent 活动记录。
- Git backup 只覆盖内部派生快照，不等于通用 undo API；外部文件也明确不进入该备份范围。

## 能力矩阵

图例：`强` 表示官方提供且适合自动化；`中` 表示可用但有运行方式或能力限制；`弱` 表示主要依赖文件访问、内部能力或未发现正式契约；`—` 表示本次未找到一手证据。

| 产品 | 数据可移植性 | 稳定对象模型 | 机器可读搜索/读 | 安全增量写 | 官方 CLI/API | 官方 MCP | 预演/恢复/审计 | 判断 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Vibenote | 强：本地文本 | 弱：block 无正式 ID | 弱：仅内部 IPC | 中：内部 block 操作与保存保护 | — | — | 中：恢复、快照、Git backup | 数据基础好，缺外部契约 |
| Obsidian | 强：vault 是普通文件夹 | 中：路径、heading/block ref | 强：CLI 搜索/读、JSON 输出 | 强：create/append/task 等 CLI | 强：官方 CLI；插件 Vault API | — | 中：diff/Sync history；普通写入未见统一 dry-run | 2026 年 CLI 成为标杆 |
| Logseq DB | 中：DB graph 可导入导出 | 强：node/page/block | 强：CLI、HTTP、MCP | 强但 MCP 仍有 TODO | 强：独立 CLI、插件 API、脚本 | 强：内置可选 MCP | 强：pretend、batch、app undo | 安全写入语义最值得借鉴 |
| SiYuan | 中：`.sy` JSON，支持标准 Markdown 导出 | 强：block ID | 强：全文/语义/资产/SQL | 强：block/document CRUD | 强：无 GUI CLI、JSON、HTTP API | 中：主仓库已有 MCP 模块，公开细节不足 | 强：多数变更命令 `--dry-run`，repo/history | 完整但系统较重 |
| Anytype | 中：对象模型优先 | 强：space/type/object/property | 强：官方 API 与 MCP | 强：对象/列表/属性管理 | 强：版本化 API | 强：官方 MCP | 中：API key；恢复/预演证据不足 | 原生 MCP 与 API key 配置优秀 |
| AFFiNE | 中：支持导入导出，自有协作模型 | 中：workspace/document/block | 中：官方 MCP 可搜索和读取 | 弱：官方 issue 显示 MCP 尚不能创建/更新文档 | 中：服务端接口存在，未发现面向桌面用户的稳定 CLI | 中：官方 MCP 当前偏只读 | 弱：未找到 MCP 写入恢复语义 | “先只读 MCP”是可取发布策略 |
| Joplin | 强：Markdown 导入导出 | 强：note/notebook/tag ID | 强：REST 搜索、分页、字段裁剪 | 强：REST CRUD、CLI | 强：REST Data API 与 Terminal | — | 中：trash、revisions、events；无统一 dry-run | 证明不依赖 MCP 也可 Agent 友好 |
| AppFlowy | 中：Markdown import/export | 强：page/database/block 内部模型 | 中：产品内 AI Search | 弱：未发现正式用户自动化接口 | — | — | 中：产品内 undo/本地数据；外部审计不明 | AI-native 不等于 Agent-ready |

## 定位图

横轴表示 Agent 接口成熟度（从只能访问底层文件，到官方 CLI/API/MCP）；纵轴表示笔记对象模型深度（从轻量文本，到强结构化 graph/database）。这两个维度直接决定 Vibenote 应该补接口，还是扩大数据模型。

```text
结构化对象深度
高  |                         Logseq DB   SiYuan   Anytype
    |                    AFFiNE
    |              AppFlowy                         Joplin
低  |  Vibenote                 Obsidian
    +----------------------------------------------------> Agent 接口成熟度
       文件/内部接口                         官方 CLI/API/MCP
```

Vibenote 的机会不在向上追赶完整知识图谱，而在保持左下角的轻量模型，同时快速向右移动：用稳定 block ID、CLI、dry-run 和 MCP，让简单数据拥有成熟契约。

## UX 与产品文案观察

1. Obsidian 把 CLI 描述为“终端中的完整控制面”，示例直接覆盖搜索、读取、追加和 diff；能力发现依靠命令帮助和可运行示例，而不是一篇抽象集成指南。[Obsidian CLI](https://obsidian.md/help/cli)
2. Obsidian Headless 明确区分“控制桌面应用”和“不给 Agent 整台电脑权限的后台访问”，把安全边界本身写成产品价值。[Obsidian Headless](https://obsidian.md/help/headless)
3. Logseq 在 MCP 文档中同时展示支持项、`pretend` 和未支持项；公开限制比宣称“Agent 可以操作一切”更有助于建立信任。[Logseq DB version / MCP](https://github.com/logseq/docs/blob/master/db-version.md)
4. SiYuan 的 CLI 使用统一 JSON 输出和 `--dry-run`，说明机器可读结果与预演应成为每个命令的一致体验，而不是少数高级选项。[SiYuan CLI](https://github.com/siyuan-note/siyuan/blob/master/README.md)
5. AFFiNE 当前偏只读的 MCP 表明，连接成功、搜索成功和安全写入是三个独立里程碑；UI 不应把“已连接”误写成“Agent 已可安全编辑”。[AFFiNE MCP write feature request](https://github.com/toeverything/AFFiNE/issues/15112)
6. Vibenote 现有“AI 默认只作用于当前 block 或选区”的文案可以延续到外部 Agent：界面应始终显示本次授权范围、目标 block、预演状态和恢复入口。[AI native design](../design/2026-07-02-ai-native-assistance.md)

## 竞品卡

### Obsidian：普通文件之上补齐官方 CLI

**事实。** Vault 本质是文件夹；插件 Vault API 提供文件枚举与读写，并明确区分 `read()` 与只适合展示的 `cachedRead()`，以降低基于陈旧缓存覆盖文件的风险。[Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault)

2026 年官方 CLI 提供 vault/file 定位、read、create、append、search、tasks、tags、diff、Sync history、插件命令执行以及 JSON/CSV/TSV 等输出。CLI 需要 Obsidian 桌面应用运行，但可在第一次调用时拉起应用；开发命令还明确面向 agentic coding tools，支持 reload plugin、截屏和 `eval`。[Obsidian CLI](https://obsidian.md/help/cli)

Obsidian Headless 是独立于桌面应用的开放测试客户端。官方直接把“让 Agent 访问 vault 而不获得整台电脑权限”和定时自动化列为场景，但当前主要覆盖 Sync/Publish，而不是完整编辑 API。[Obsidian Headless](https://obsidian.md/help/headless)

**值得复制。** 让人类和 Agent 共用同一命令语义；按 vault/path 精确寻址；命令自描述；查询输出可结构化；桌面 CLI 与 headless 场景清晰分层。

**不宜照搬。** `eval` 几乎等于任意应用内代码执行，不适合作为 Vibenote 的默认 Agent 写入通道；Vibenote 应坚持窄工具与能力授权。

**价格。** 不研究。

### Logseq DB：把“预演、批量、可撤销”做进 MCP

**事实。** Logseq DB 文档描述了可选 MCP Server，可从桌面当前 graph 或 CLI 本地 graph 启动，通过带 Bearer token 的 Streamable HTTP 连接。创建和编辑支持批量，所有写操作有 `pretend` 选项，针对当前 graph 的变更可以使用应用 undo/redo；同时文档明确列出当前 MCP 尚不支持的编辑范围。[Logseq DB version / MCP](https://github.com/logseq/docs/blob/master/db-version.md) 当前 master 的 MCP server 源码注册了 list/get/search/upsertNodes 等工具，upsert 输入含 dry-run；这属于前沿源码证据，不等于所有稳定发行版均已交付。[Logseq MCP source](https://github.com/logseq/logseq/blob/master/src/electron/electron/mcp_server.cljs)

同一份官方文档说明 Logseq CLI 可脱离桌面应用运行，并可用于 CI/CD；DB graph 脚本也可读写数据。插件 API 仍是官方扩展入口。[Logseq CLI source documentation](https://github.com/logseq/logseq/blob/master/docs/cli/logseq-cli.md)、[Logseq repository](https://github.com/logseq/logseq)、[Logseq DB changes](https://github.com/logseq/docs/blob/master/db-version-changes.md)

**值得复制。** 每个 mutation 都有 pretend；batch 是一等能力；写入复用应用校验；当前 graph 写入进入同一个 undo 栈；文档公开 TODO，不制造“全能力 Agent”错觉。

**不宜照搬。** Vibenote 不需要先引入 DB graph、属性系统或知识图谱；其优势恰恰是更小的纯文本模型。

**价格。** 不研究。

### SiYuan：无 GUI CLI 与 workspace 级工具面

**事实。** SiYuan 主仓库 README 已列出内置 CLI：无需运行服务器即可访问 workspace，覆盖 notebook/document/daily note CRUD、block/attribute/outline、全文/语义/资产搜索、SQL、引用、导入导出、history/sync 等；支持 JSON 输出，多数修改命令支持 `--dry-run`。[SiYuan CLI](https://github.com/siyuan-note/siyuan/blob/master/README.md)

SiYuan 的数据位于 workspace `data` 下，文档以 JSON `.sy` 文件保存，附件单独存放；产品提供 block-level reference、custom attributes、API 与插件市场。官方 `docs/API.md` 描述了带 token 的本机 HTTP API；当前 master 还包含 Agent/MCP 路由与实现，但本次没有找到同等完整的稳定版 MCP 用户文档，因此不据此评价具体工具能力。[SiYuan API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)、[Agent API source](https://github.com/siyuan-note/siyuan/blob/master/kernel/api/agent.go)、[router source](https://github.com/siyuan-note/siyuan/blob/master/kernel/api/router.go)、[SiYuan repository guide](https://github.com/siyuan-note/siyuan/blob/master/AGENTS.md)

**值得复制。** 单一核心同时服务 CLI 和应用；无需 GUI；统一 JSON 输出；写命令默认可预演；搜索与导出覆盖附件和结构化对象。

**不宜照搬。** 不要把 Vibenote 演进成四百余 HTTP endpoint 的重型内核；先覆盖高频、低风险的十余个动作。

**价格。** 不研究。

### Anytype：官方版本化 API 直接生成 MCP 工具

**事实。** Anytype 官方 MCP 仓库将官方 OpenAPI 规格映射为 MCP 工具，覆盖全局/space 搜索、space/member、object/list、property/tag、type/template。用户从桌面端创建 API key，MCP 配置显式携带版本头和 Bearer key，默认连接本机 API。[Anytype MCP](https://github.com/anyproto/anytype-mcp)、[Anytype API](https://developers.anytype.io/)、[authentication](https://developers.anytype.io/docs/guides/get-started/authentication/)

**值得复制。** 先有版本化核心 API，再生成 MCP，而不是把业务逻辑写死在 MCP server；应用内生成 key 和可复制配置片段，降低接入成本。

**不宜照搬。** Vibenote 首版不需要复杂 type/template/list 模型；也不应让一个全权限 key 默认覆盖所有外部文件。

**价格。** 不研究。

### AFFiNE：先交付只读 MCP

**事实。** AFFiNE 官方仓库的功能请求记录表明，当前 MCP 暴露文档搜索和读取，创建/更新仍是待办；该 issue 仍处于未分流状态。因此 AFFiNE 可作为“先发布只读入口，再讨论写权限”的参考，而不是写入能力标杆。[AFFiNE MCP write feature request](https://github.com/toeverything/AFFiNE/issues/15112)

AFFiNE 是开源、隐私优先的协作知识库，近期仍持续发布；但本次未找到面向终端用户的官方 CLI、稳定公共插件 API 或 MCP mutation 安全说明。[AFFiNE repository](https://github.com/toeverything/AFFiNE)、[AFFiNE releases](https://github.com/toeverything/AFFiNE/releases)

**值得复制。** 在权限、冲突与恢复还没设计清楚时，官方 MCP 保持只读是合理的发布边界。

**不宜照搬。** 不要让只读 MCP 永久停留在“能检索但不能回写”的演示层；Vibenote 的 append-only block 是更容易安全开放的写入机会。

**价格。** 不研究。

### Joplin：成熟 REST API 仍是优秀 Agent 契约

**事实。** Joplin Data API 通过本机 clipper service 暴露 token 鉴权 REST API，支持 note/notebook/tag 等对象、JSON、字段裁剪、分页、搜索、CRUD、trash/revisions 和带 cursor 的变更 events。PUT 只更新传入字段，降低无意清空其他字段的风险。[Joplin Data API](https://joplinapp.org/help/api/references/rest_api/)

Joplin Terminal 支持 shell mode，可创建、查找、编辑、移动和同步笔记，并用 note/notebook ID 精确引用对象。[Joplin Terminal](https://joplinapp.org/help/apps/terminal/)

**值得复制。** 搜索分页、fields 裁剪、变更 cursor、增量属性更新、软删除；这些都直接减少 Agent token、误操作和轮询成本。

**不宜照搬。** token 放在 query parameter 是较老的接口风格；Vibenote 应使用 header/stdio，并避免密钥进入日志和 shell history。

**价格。** 不研究。

### AppFlowy：强 AI 产品能力，弱外部 Agent 契约

**事实。** AppFlowy 官方仓库强调本地控制、开源和可扩展；产品 changelog 记录了 workspace AI search、AI overview、custom prompts、local Ollama 与离线 vault workspace。文档也说明内部 Delta 模型可与 Markdown 互相导入导出。[AppFlowy repository](https://github.com/AppFlowy-IO/AppFlowy)、[AppFlowy changelog](https://github.com/AppFlowy-IO/AppFlowy/blob/main/CHANGELOG.md)、[Delta import/export](https://docs.appflowy.io/docs/essential-documentation/contribute-to-appflowy/architecture/backend/delta)

本次未找到官方用户级 CLI、MCP 或稳定自动化 API，因此这些 AI 能力不能自动推导出“外部 Agent 友好”。

**值得复制。** 本地 AI、可选模型与数据控制的叙事；Markdown 作为交换格式。

**不宜照搬。** 不要优先扩展 AI provider、聊天和 RAG，而继续缺少可被任意 Agent 复用的读写契约。

**价格。** 不研究。

## 机会窗口

### 1. 用 block 原生寻址赢得“手术式修改”

Obsidian 主要以文件/path/heading 为边界，Joplin 以整篇 note 为主，Logseq/SiYuan/Anytype 则需要较重对象模型。Vibenote 已经把日常输入分成 block，只需补稳定 `blockId` 和 revision，就能自然提供 `append_block`、`replace_block_if_unchanged`、`extract_tasks_to_new_block` 等低风险动作。

### 2. 把 scratchpad 而非知识库做成 Agent 的默认收件箱

Vibenote 的低认知负担适合接收会议记录、终端摘要、代码调查结论和稍后处理事项。首个 mutation 不应是“重写整个库”，而应是**向 stream 追加一个来源明确的新 block**。这条路径既有即时价值，也最容易做到幂等和可撤销。

### 3. 将现有数据安全能力升格为外部写入协议

原子保存、recovery、snapshot、Git backup 已经存在。竞争优势不是再做一套存储，而是让每次 Agent mutation 返回 `previousRevision`、`newRevision`、`snapshotId`、`changedBlockIds`，并能从 Activity UI 一键恢复。

### 4. 以安全默认值区分“能连”与“可信赖”

社区已出现两条明确路线：AFFiNE 先只读，Logseq/SiYuan 对 mutation 提供 pretend/dry-run。Vibenote 可以组合二者：首次连接只读；append 权限单独授权；replace/delete 需要更高 scope；批量修改默认 dry-run；无 revision 匹配则拒绝写入。

### 5. 一个核心，多种薄适配器

CLI、MCP、应用 IPC 不应各写一套保存逻辑。应先抽出可测试的 `note-core`/`agent-service`，由 CLI 和 IPC 共用；MCP 只是带 JSON Schema 的薄映射。这样也能避免 MCP 启动失败让应用本身不可用。

## 建议路线图

### 30 天：建立只读契约，并开放唯一的低风险写动作

目标：Codex/Claude Code 在不理解内部文件格式、不读取整台机器的情况下，可以安全发现并读取 Vibenote，并向 stream 追加一个 block。

1. **冻结 Agent Contract v1。** 定义 note/block/resource、错误码、revision、能力版本、敏感字段规则；明确 block 内容永远是数据，不得被工具层当作指令执行。
2. **加入稳定 ID。** 为新 block 生成 ULID/UUID；升级 parser 以兼容旧 delimiter 和未知可选字段。旧 block 在首次受控写入时惰性补 ID，不做启动时全库重写。
3. **抽取共享 core。** 将 parse/list/read/search/append/atomic-save/snapshot 从 Electron UI 路径抽成无 GUI Node 模块，所有写入继续复用现有 FileLibrary/BackupManager 语义。
4. **发布官方 CLI alpha。** 最小命令集：`version`、`doctor`、`capabilities --json`、`notes list`、`notes read`、`search`、`blocks list`、`blocks append`。所有查询支持 `--json`，搜索支持 limit/cursor/fields。
5. **append 默认安全。** `blocks append` 必须支持 `--dry-run`、`--idempotency-key`、来源 metadata、目标 note 精确 ID；实际写入前建 snapshot，返回 block ID 与 revision。
6. **官方 Agent 指南/skill。** 提供可复制的最小指令：先 capability discovery，再 search/read，写入先 dry-run；禁止直接编辑内部 delimiter、metadata、recovery 和 backup。
7. **测试。** 增加旧格式兼容、并发写拒绝、重复 idempotency key、崩溃恢复、路径逃逸、超大输出截断、敏感信息不进 stdout/stderr 的自动化测试。

建议 CLI 返回统一 envelope：

```json
{
  "ok": true,
  "apiVersion": "v1alpha1",
  "operation": "blocks.append",
  "dryRun": false,
  "noteId": "internal:stream",
  "blockId": "01K...",
  "previousRevision": "sha256:...",
  "revision": "sha256:...",
  "snapshotId": "...",
  "warnings": []
}
```

### 90 天：安全 mutation 与官方 MCP

目标：Agent 可以完成可控的局部任务，用户可以知道它做了什么并撤回。

1. **增加窄写工具。** `insert_after`、`replace_if_unchanged`、`toggle_task`、`move_block`、`delete_block_to_trash`；不提供无保护的全文 overwrite。
2. **乐观并发。** mutation 必须提交 `expectedRevision` 或 `expectedBlockHash`；不匹配返回 conflict 和最新 metadata，不自动重试覆盖。
3. **批量事务。** 一组操作先 validate/preview，再一次原子提交；返回逐项结果。批量默认 dry-run，显式 `--apply` 才执行。
4. **本地授权。** 在应用内创建连接，scope 至少拆为 `read`、`search`、`append`、`edit`、`delete`、`external-files`；默认不给外部文件权限。支持撤销和过期。
5. **Activity 与审计。** 本地 JSONL 只记 actor/client、tool、对象 ID、前后 hash、snapshot ID、时间和结果，不记录完整正文、prompt、API key。应用提供最近活动与 restore 入口。
6. **官方 MCP alpha。** 基于共享 core 暴露 stdio MCP，工具与 CLI 一一映射；每个 mutation 都包含 dry-run、revision 和 idempotency 字段。stdio 优先，避免默认开放 localhost 端口。
7. **资源 URI。** 使用 `vibenote://notes/{noteId}/blocks/{blockId}`，MCP resource 与 CLI 输出保持同一标识。
8. **内容安全。** tool description 明确笔记正文是不可信内容；默认不把读取到的笔记指令提升为系统/开发者指令；对外链、附件和跨工具转发单独授权。

### 180 天：自动化平台化，但保持产品克制

目标：支持长期运行和跨工具工作流，同时不把 Vibenote 变成重型知识库。

1. **headless daemon（可选）。** 提供无需主窗口的本地服务；默认 Unix domain socket 或 stdio，若启用 Streamable HTTP 则仅绑定 loopback、强制 Bearer token、显示运行状态。
2. **增量 events。** 提供带 cursor 的 `events`/watch，支持 created/updated/deleted、actor、revision；允许 Agent 做增量索引而不是反复扫描全文。
3. **提案模式。** 高风险任务生成 patch proposal/建议卡，不直接写正文；用户可逐 block 接受、拒绝、恢复。这可以复用现有 AI 建议卡与 stale source 校验。
4. **官方 client/skills。** 发布 TypeScript SDK、MCP 配置生成器、Codex/Claude Code skills 和 conformance suite；保证 CLI/MCP/API 版本兼容。
5. **附件与导出。** 在明确的资源 scope 下提供附件 metadata、按需读取和安全导出；绝不默认向 Agent 暴露任意本机路径。
6. **检索增强按需加入。** 先做结构化/全文检索与字段裁剪；只有真实任务证明必要时再提供本地 embedding，且必须可关闭、可重建、可解释来源。
7. **治理指标。** 关注成功 mutation 率、conflict 率、dry-run 后取消率、restore 率、平均读取字节数、权限拒绝率；不以“模型调用次数”作为 Agent 友好指标。

## 推荐首发工具面

| 工具 | 默认权限 | 是否可写 | 安全要求 |
| --- | --- | --- | --- |
| `capabilities` | 无 | 否 | 返回版本、limits、支持格式 |
| `notes_list` | read | 否 | fields/limit/cursor |
| `notes_read` | read | 否 | 精确 ID；可按 block/范围读取 |
| `search` | search | 否 | limit、snippet、字段裁剪 |
| `blocks_list` | read | 否 | 稳定 ID、顺序、hash |
| `blocks_append` | append | 是 | dry-run、幂等、snapshot |
| `blocks_replace` | edit | 是 | expected hash、patch preview、snapshot |
| `tasks_toggle` | edit | 是 | 只改任务 marker、expected hash |
| `blocks_delete` | delete | 是 | 默认进 trash、显式确认/高权限 |
| `activity_list` | read | 否 | 不返回正文和 secret |
| `restore` | edit | 是 | 精确 snapshot、先 preview |

不建议首发：任意 shell、任意 JavaScript eval、任意绝对路径读取、SQL、全库 rewrite、自动移动/合并全部 block、未经确认的网络发布。

## 产品决策原则

- **先协议，后 MCP。** MCP 入口可以很快做出来，但稳定 ID、mutation 语义和恢复证据才是长期资产。
- **先 append，后 replace，最后 delete。** 按不可逆风险逐级开放。
- **先全文搜索，后 embedding。** 结构化结果、snippet 和字段裁剪通常比向量库更急迫。
- **先本机 stdio，后 HTTP。** 减少端口、CSRF、token 生命周期和后台进程复杂度。
- **用户的原文始终是事实源。** Agent 生成内容必须标注来源；临时 proposal、审计与运行状态不混入正文。
- **公开仓库按公开证据设计。** 测试、截图、日志、fixtures 只使用合成内容；任何真实笔记都不得进入仓库或构建产物。

## 证据缺口与后续验证

1. Logseq DB 文档标注的是 2026-04-28 状态，CLI 安装仍指向 nightly；master 源码虽已有 MCP 工具和 dry-run，但仍需在目标 macOS 上验证当前稳定版/nightly 的工具列表、token 生命周期、pretend 与 undo 行为。
2. SiYuan CLI、HTTP API 与 MCP/agent 模块包含当前 master 证据；需要核对这些能力是否已进入稳定发行版，以及 token scope、MCP tools 与 `--dry-run` 实际覆盖哪些 mutation。
3. AFFiNE “MCP 只读”来自官方仓库中仍开放的用户 feature request，而非正式 API reference；应安装当前稳定版并查看 MCP tools/list 后再做最终竞品结论。
4. AppFlowy 本次未找到官方 CLI/MCP/用户自动化 API；需向官方路线图或维护者确认，避免把检索缺口误判为产品缺口。
5. Obsidian CLI 的实际命令、JSON schema、错误码和并发写行为尚未做运行验证；Headless 当前主要是付费服务相关 Sync/Publish，不应误认为完整 headless note API。
6. Anytype MCP 的权限是否能细分到 space/object/action、mutation 是否有 revision/dry-run/undo，需要运行时验证。
7. Joplin API 的 query token 可能进入代理/日志；需要验证桌面端权限撤销、event 保留和 revision restore 的真实行为。
8. 本报告只做静态仓库审查，没有对 Vibenote 当前构建运行 Agent 原型；30 天方案进入实施前，应先做 CLI spike，验证 parser 复用、进程并发锁、旧 block ID 迁移和 public-safety tests。

## 一手资料索引

- Vibenote：[README](../../README.md)、[note format](../../src/common/noteFormat.ts)、[preload bridge](../../electron/preload.cjs)、[AI native design](../design/2026-07-02-ai-native-assistance.md)、[Git backup design](../design/2026-08-11-git-auto-backup.md)
- Obsidian：[CLI](https://obsidian.md/help/cli)、[Headless](https://obsidian.md/help/headless)、[Vault API](https://docs.obsidian.md/Plugins/Vault)、[URI](https://help.obsidian.md/Extending%2BObsidian/Obsidian%2BURI)
- Logseq：[repository / plugin API](https://github.com/logseq/logseq)、[DB version / MCP / CLI](https://github.com/logseq/docs/blob/master/db-version.md)、[CLI source documentation](https://github.com/logseq/logseq/blob/master/docs/cli/logseq-cli.md)、[MCP source](https://github.com/logseq/logseq/blob/master/src/electron/electron/mcp_server.cljs)、[DB changes](https://github.com/logseq/docs/blob/master/db-version-changes.md)
- SiYuan：[repository / CLI](https://github.com/siyuan-note/siyuan)、[README](https://github.com/siyuan-note/siyuan/blob/master/README.md)、[HTTP API](https://github.com/siyuan-note/siyuan/blob/master/docs/API.md)、[Agent API source](https://github.com/siyuan-note/siyuan/blob/master/kernel/api/agent.go)、[router source](https://github.com/siyuan-note/siyuan/blob/master/kernel/api/router.go)、[repository guide](https://github.com/siyuan-note/siyuan/blob/master/AGENTS.md)
- Anytype：[MCP](https://github.com/anyproto/anytype-mcp)、[API](https://developers.anytype.io/)、[authentication](https://developers.anytype.io/docs/guides/get-started/authentication/)
- AFFiNE：[repository](https://github.com/toeverything/AFFiNE)、[releases](https://github.com/toeverything/AFFiNE/releases)、[MCP write request](https://github.com/toeverything/AFFiNE/issues/15112)
- Joplin：[Data API](https://joplinapp.org/help/api/references/rest_api/)、[Terminal](https://joplinapp.org/help/apps/terminal/)
- AppFlowy：[repository](https://github.com/AppFlowy-IO/AppFlowy)、[changelog](https://github.com/AppFlowy-IO/AppFlowy/blob/main/CHANGELOG.md)、[Delta import/export](https://docs.appflowy.io/docs/essential-documentation/contribute-to-appflowy/architecture/backend/delta)
