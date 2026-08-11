# Git 自动备份

## 背景与目标

Vibenote 当前把内部笔记保存在 Electron `userData/notes`，并通过 recovery、覆盖前快照和原子写入保护本地数据。这些机制能够处理保存失败和误编辑，但不能抵御应用数据目录整体丢失，也不能把历史保存到用户自己的 Git 远端。

本功能主要参考 Logseq OG 的低操作成本：开启后立即执行一次备份，之后周期性 commit，并在退出前尽力完成本地 commit。Vibenote 不照搬 Logseq 的 Graph 存储模型，而是保留现有内部笔记目录作为唯一事实来源，把可恢复快照单向导出到用户选择的专用 Git 仓库。

相关实施步骤见 [Git 自动备份实施计划](../plans/2026-08-11-git-auto-backup-implementation-plan.md)。

目标：

- 设置页只提供一个开关和一个本地 Git 仓库目录。
- 开启后自动生成可恢复的仓库快照，并周期性 commit。
- 仓库存在可安全确定的 remote 时自动 push；没有 remote 时本地 commit 仍视为成功。
- Git、导出或网络失败不能影响笔记保存、recovery 和现有快照。
- 正常状态低干扰，失败状态持续可见并提供可执行提示。

本功能定位为“Git 自动备份”，不是多设备同步。首版不执行 pull、fetch、merge、rebase、reset、checkout、clean 或冲突自动解决，也不从备份仓库反向导入内容。

## 现状与问题

### 已确认现状

- 内部笔记根目录固定为 Electron `userData/notes`，主进程通过 `FileLibrary` 读写。
- 内部文件与用户任意位置打开的外部文件具有不同文档身份；外部文件登记在 `external-documents.json`。
- 图片可以位于文档旁的 `*.assets/`，也可以位于 `userData/images`，正文当前保存绝对路径。
- 保存链路已经包含 recovery、覆盖前快照和原子替换；Git 不应进入这条同步成功判定链路。
- 主进程尚无 Git 设置、周期任务或退出前异步任务协调机制。

### Logseq 参考结论

Logseq OG 在 `Settings -> Version control` 提供自动 commit、关闭窗口时 commit 和 commit 周期。开启后立即运行，之后按周期对 Graph 执行 add 和 commit。这个体验的价值是用户不需要参与日常 Git 操作；局限是配置项偏多、远端 push 体验割裂，错误主要依靠通知。

新版 Logseq DB 将数据库自动备份与 Git 能力分开，进一步说明 Git 应是额外版本保护层，不能替代应用自身保存与恢复。

参考资料：

- [Logseq OG Git 实现](https://github.com/logseq/og/blob/master/src/electron/electron/git.cljs)
- [Logseq OG 设置实现](https://github.com/logseq/og/blob/master/src/main/frontend/components/settings.cljs)
- [Logseq 产品拆分说明](https://logseq.io/page/b2ad9ce1-9cb7-4436-8083-54cb4516d324/df4dc09d-0a12-4c87-904e-22a9bf4c350a)
- [Logseq DB 自动备份与 Git 变化](https://discuss.logseq.com/t/logseq-db-changelog/30013?page=2)

### 根本问题

Logseq 的 Graph 本身就是用户可见文件夹，可以直接作为 Git 工作树。Vibenote 的内部笔记位于应用数据目录。如果为了 Git 功能把主存储迁移到用户仓库，会扩大为存储迁移项目，并引入仓库路径失效、编辑中的保存屏障、图片路径转换和版本回退等风险。

因此本设计采用单向导出：`userData/notes` 始终是唯一事实来源，Git 仓库中的内容是由应用管理、可校验、不可反向编辑的备份快照。仓库丢失或不可用不会改变 Vibenote 的正常读写位置。

## 方案设计

### 用户界面

设置页在“编辑器”和“AI”之间新增“Git 自动备份”分组：

```text
Git 自动备份                               [开关]

定期将内部笔记备份到专用 Git 仓库；
配置远端后也会自动尝试推送。

仓库
~/Documents/vibenote-backup                [选择…]

● 已提交并推送 · 今天 14:32
```

交互规则：

1. 首次打开开关且尚未配置目录时，立即打开原生目录选择器。
2. 用户取消选择或目录校验失败时，开关保持关闭，笔记位置和内容不变。
3. 空目录由应用执行 `git init`；非空且不是 Git 仓库的目录拒绝启用。
4. 选择 Git 工作树内的子目录时，规范化并显示仓库根目录。
5. 已配置后可以“更改…”仓库；新仓库首次导出成功前继续使用旧配置。
6. 关闭开关只停止导出、commit 和 push，不删除仓库内容，也不改变内部笔记位置。
7. 首版不提供周期、分支、remote、commit message、Git 身份或凭据设置。

设置文案必须要求使用专用仓库。应用可以限制自动 commit 的文件范围，但 Git push 推送的是当前分支的完整提交历史，不能宣传为只推送某个目录。

正常成功不弹 toast。设置页持续显示最近一次有效状态和时间：

| 状态 | 文案 |
| --- | --- |
| disabled | 未启用 Git 自动备份 |
| ready | 等待笔记变化 |
| no-changes | 暂无新改动 · 上次成功时间 |
| committed-local | 已提交到本地 · 未配置远端 |
| pushed | 已提交并推送 · 时间 |
| push-failed | 推送失败，本地提交已保留 |
| push-manual-required | 检测到其他本地提交，请手动确认推送 |
| mirror-conflict | 备份目录被外部修改，已暂停覆盖 |
| export-incomplete | 存在无法安全复制的本地图片，未提交残缺备份 |
| repository-unavailable | 备份仓库当前不可访问 |
| conflict | Git 仓库存在冲突，自动备份已暂停 |
| git-unavailable | 未找到 Git 命令 |
| identity-missing | Git 用户名或邮箱未配置 |

### 配置与状态

主进程在 `userData/git-backup-settings.json` 原子保存非敏感配置：

```json
{
  "version": 1,
  "enabled": false,
  "repositoryPath": null,
  "repositoryInitializedByApp": false
}
```

运行状态保存在 `userData/git-backup-state.json`：

```json
{
  "version": 1,
  "lastAttemptAt": null,
  "lastExportAt": null,
  "lastCommitAt": null,
  "lastPushAt": null,
  "lastCommitHash": null,
  "lastResult": "disabled",
  "lastErrorCode": null,
  "lastErrorMessage": null,
  "pushPending": false
}
```

状态文件只保存脱敏错误摘要，不保存 remote 凭据、环境变量或完整命令输出。

### 仓库快照格式

应用只管理两个 pathspec：

```text
<repository>/
  .git/
  .vibenote-backup.json
  vibenote-backup/
    manifest.json
    notes/
      stream.txt
      *.txt
    assets/
      <stable-document-key>/
        <content-hash-prefix>-<safe-file-name>
```

`.vibenote-backup.json` 声明格式版本和托管目录，用于区分应用管理的备份与普通同名文件夹。`manifest.json` 至少记录：

- 快照生成时间、Vibenote 版本和格式版本。
- 每个内部文档的相对路径、源文件 SHA-256 和导出文件 SHA-256。
- 每个复制图片的相对路径、大小和 SHA-256。
- 正文图片引用从源绝对路径到仓库相对路径的映射。

稳定文档 key 只基于内部文档相对路径计算，不能包含 `userData` 或仓库绝对路径。图片目标文件名包含内容 hash 前缀，避免同一文档引用不同目录下同名文件时发生覆盖。导出正文中的图片使用相对路径，例如 `../assets/<document-key>/<file>`，因此仓库 clone 或整体移动后仍可读取。

外部文档、AI 设置、API key、recovery、backups、外部文件登记和应用运行状态不进入仓库。

首次使用已有 Git 仓库时，如果 `vibenote-backup/` 已存在但缺少兼容的所有权标记，必须拒绝覆盖。已配置仓库在启动时不存在或不可写时，进入 `repository-unavailable`；应用不得静默重建路径，内部笔记仍照常可用。

### 单向导出流程

每次需要创建快照时按以下顺序执行：

1. 读取 `userData/notes` 中的内部文档清单和内容；原子写入保证读取到旧版本或新版本，不会读取半个文件。
2. 解析内部文档引用的本地图片，只允许复制已确认位于文档 assets 或 `userData/images` 下的文件。HTTP(S) 图片保留原引用；其他本地绝对路径不复制，并以 `export-incomplete` 中止本次提交。
3. 在仓库根目录创建 `.vibenote-backup.staging-<id>` 构建完整临时快照，重写临时副本中的图片链接。staging 与正式目录位于同一文件系统，且不属于 Git 托管 pathspec。
4. 计算并复核文档与图片 hash；任何缺失或不一致都中止本次导出。
5. 检查当前仓库快照是否仍与上一次 manifest 一致。若被外部修改，进入 `mirror-conflict`，不覆盖用户改动。
6. 将现有快照重命名为同仓库临时回退目录，再把已验证 staging 快照切换为正式目录；失败时恢复旧快照。
7. 写入所有权标记和最终 manifest，成功后才允许进入 Git 阶段。

导出过程只读取事实来源，不改写 `userData/notes`、源图片或 renderer 当前内容。仓库快照禁止反向加载为活动文档，避免形成双向同步语义。

成功切换后可以清理本次 staging 和回退目录；它们是可重建的派生产物，不属于用户笔记。异常退出遗留目录在下次启动时先按 manifest 校验：能够证明正式快照完整时才清理遗留目录，否则恢复旧快照并保留诊断状态，不能直接覆盖正式快照。

### 自动运行策略

- 成功启用或更换仓库后立即导出、commit，并在安全时 push。
- 主进程每 5 分钟检查一次；没有源文件变化且没有待 push commit 时不执行 Git commit。
- 内部文档或内部图片保存成功后标记 dirty；即使遗漏事件，周期任务仍通过源 manifest 检测实际变化。
- 同一时间最多运行一个任务；运行期间的新变化合并为下一次 pending run。
- 应用退出时请求 renderer 同步刷新当前编辑内容，再最多等待 5 秒完成导出和仅本地 commit；退出阶段不执行网络 push。
- 应用启动后，如果上次 push 失败或本地分支仍领先远端，异步重试安全 push。

Git 任务始终位于保存链路之外。文件保存成功后，即使导出或 Git 失败，保存 IPC 仍返回成功。

### Git 命令契约

主进程新增 `GitBackupManager`，内部 Git 命令统一使用 `spawn('git', args)`，不执行 shell 字符串。环境设置 `GIT_TERMINAL_PROMPT=0`，每条命令都有超时；日志必须使用英文并脱敏 URL 中的凭据。

成功导出后按以下顺序处理：

1. `git rev-parse --show-toplevel` 验证仓库根目录。
2. 检测 merge、rebase、cherry-pick 状态和未解决冲突；存在时停止。
3. `git status --porcelain -- .vibenote-backup.json vibenote-backup` 判断托管内容是否变化。
4. `git add -A -- .vibenote-backup.json vibenote-backup`。
5. `git diff --cached --quiet -- .vibenote-backup.json vibenote-backup`；无变化则结束。
6. 使用 `git commit --only` 和相同 pathspec 创建提交，避免包含用户预先 staged 的其他文件。
7. 通过安全检查后尝试 push。

提交信息固定为：

```text
chore(vibenote): auto backup 2026-08-11 14:32:10

Vibenote-Auto-Backup: true
```

push 安全规则：

1. 优先使用当前分支 upstream；否则只在唯一候选 remote 存在同名 tracking ref 时使用该基线。
2. 基线到 `HEAD` 的所有待推提交都必须带有 `Vibenote-Auto-Backup: true` trailer。
3. remote 尚无当前分支时，仅应用自己初始化的仓库允许首次自动 push；已有仓库要求用户先手动建立 upstream。
4. 没有 remote 时本地 commit 成功，状态为 `committed-local`。
5. 存在多个 remote、无法确定基线或发现其他本地提交时，不 push，状态为 `push-manual-required`。

禁止自动修改 remote、upstream、branch 和全局或仓库级 Git 配置。禁止调用会导入远端内容或改写工作树历史的命令。

### IPC 与退出协调

preload 只暴露窄接口：

```ts
gitBackup: {
  getSettings(): Promise<GitBackupSettings>
  chooseRepository(): Promise<GitBackupSettings>
  setEnabled(enabled: boolean): Promise<GitBackupSettings>
  getStatus(): Promise<GitBackupStatus>
  onStatusChanged(callback: (status: GitBackupStatus) => void): () => void
}
```

仓库选择、导出、Git 命令、调度和状态持久化全部位于主进程。renderer 只展示设置与状态。

退出前由主进程发送带 request ID 的刷新请求；EditorPane 执行现有同步保存并回传完成事件。主进程收到确认后创建本地快照和 commit，或在总计 5 秒后放弃等待并继续退出。该超时只影响本次 Git 备份，不改变同步保存结果。

### 数据流

```text
编辑器内容
   ↓
recovery + 覆盖前快照
   ↓
原子保存到 userData/notes
   ↓
标记 dirty
   ↓
生成并校验仓库快照
   ↓
周期 commit
   ↓
安全条件满足时 push
```

任何导出或 Git 失败都不能反向影响前面的保存、recovery 和本地快照。

## 自闭环验证范围

以下范围可使用临时 userData、临时仓库和本地 bare remote 完成，不依赖真实 Git 服务：

- 空目录初始化；非空非仓库目录拒绝启用。
- 内部笔记和关联图片完整导出，源目录内容与 hash 不变。
- 仓库复制到不同绝对路径后，导出正文中的图片相对路径仍有效。
- 外部文档、AI 设置、recovery 和 backups 不进入快照。
- 开启后立即 commit；无变化时不增加 commit。
- 无 remote 时本地 commit 成功；本地 bare remote 可以正确 push。
- 仓库中其他 staged 文件不进入自动 commit。
- 其他本地提交、多个 remote 或不可靠基线会暂停自动 push。
- 镜像被外部修改时不覆盖，状态进入 `mirror-conflict`。
- 仓库路径离线时不自动重建；不安全或缺失的本地图片不会形成残缺 commit。
- Git identity 缺失、冲突、push 失败和命令超时不影响笔记保存。
- 退出前完成同步保存和本地 commit；超时不会无限阻塞退出。
- 应用重启后恢复配置、最近状态并重试待 push 提交。

## 验收标准

| 验收项 | 通过条件 | 权威证据 |
| --- | --- | --- |
| 设置交互 | 只有开关、仓库目录和状态；取消目录选择后保持关闭 | Playwright 控件、文案和状态断言 |
| 数据隔离 | 启用、禁用和 Git 失败前后 `userData/notes` 路径与内容不变 | 源目录树与 SHA-256 清单 |
| 快照完整 | 每个内部文档和关联图片均在 manifest 中且 hash 匹配 | runtime manifest 校验报告 |
| 仓库可移植 | 仓库换到不同绝对路径后相对图片引用仍能解析 | 第二临时目录的文件存在性与 hash |
| 自动提交 | 启用后产生固定格式 commit；无变化时 commit 数不增加 | `git log --format=%s` 与 commit count |
| 提交隔离 | 预先 staged 的非托管文件不在自动 commit 中 | `git show --name-only` 与 `git diff --cached` |
| 无 remote | 本地 commit 成功且 UI 显示未配置远端 | Git log 与 Playwright 状态断言 |
| 有 remote | bare remote 目标分支包含同一 commit 与 blobs | 本地和远端 `rev-parse`、blob SHA |
| 防误覆盖 | 修改已导出文件后，下一次任务不覆盖且显示冲突 | 修改前后文件 hash 与状态事件 |
| 不完整导出 | 本地图片超出允许目录或缺失时不产生新 commit | commit count、错误码与旧快照 hash |
| 仓库离线 | 已配置路径不可访问时源笔记仍可保存，且不创建替代目录 | 保存 IPC、路径存在性与状态事件 |
| push 失败 | 本地 commit 保留、源文件保存成功、状态可重试 | Git log、源文件内容与状态事件 |
| 退出行为 | 当前编辑内容先保存并进入本地 commit，总等待不超过约定上限 | 退出时间线、源文件和重启后 Git log |
| 回归 | 编辑、图片、recovery、AI 设置和外部文件行为不回退 | 全量 E2E、build、data-safety、stability 输出 |

## 风险与边界

- 没有 remote 时只有本地版本历史，不能抵御整块磁盘损坏。
- 仓库是单向备份，不是第二个可编辑 Vault；外部修改不会导入 Vibenote。
- 首版不提供应用内恢复 UI，但仓库快照必须能通过 manifest 独立校验和人工恢复。
- Git push 作用于整个分支；专用仓库、提交 trailer 和远端基线检查共同构成防误推边界。
- Git identity、SSH key、HTTPS credential helper、代理和远端权限由系统 Git 环境负责，Vibenote 不保存凭据。
- 退出前 commit 是有限等待的最佳努力，不保证最后一次网络 push 已完成。

## 非自闭环 Blocker

### 真实远端认证兼容性

本地 bare remote 可以闭环验证 push 逻辑，但不能证明所有 GitHub、GitLab、code-host、自建 SSH 或企业代理环境都可用。该项不阻塞本地实现和自动化验证；对外声明真实远端兼容前，需要用户选择一个真实远端完成 push，并提供远端 commit 页面或 `git ls-remote` 结果。

### 最终视觉接受度

自动化可以验证布局、操作和状态，但“是否足够低干扰”需要真实打包应用中的用户判断。该项不阻塞功能实现；最终 UI 验收由用户在正常窗口和最小窗口各确认一次。

## 待确认点

没有阻塞首个自闭环里程碑的待确认项。默认采用以下决策：

- 现有 `userData/notes` 保持唯一事实来源，仓库为单向备份。
- 固定 5 分钟周期，不暴露设置。
- 开启后立即运行，退出时只等待本地 commit。
- 自动 push，但绝不自动 pull。
- 空目录自动 `git init`；非空非仓库目录拒绝启用。
- 首版不提供应用内恢复入口。
