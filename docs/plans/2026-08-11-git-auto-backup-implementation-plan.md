# Git 自动备份实施计划

## 背景与范围

本计划实现 [Git 自动备份设计](../design/2026-08-11-git-auto-backup.md)。功能参考 Logseq OG 的自动 commit 体验，但不迁移 Vibenote 的活动存储：`userData/notes` 继续作为唯一事实来源，应用把经过校验的只写快照导出到用户选择的专用 Git 仓库。

实施范围：

- Git 设置和状态持久化。
- 仓库选择、校验与空目录初始化。
- 内部文档和关联图片的单向快照导出。
- 周期 commit、退出前本地 commit 和可选 push。
- 设置页交互、持久状态和失败提示。
- 本地 runtime verifier、E2E 和打包回归验证。

不包括活动存储迁移、反向导入、恢复 UI、pull、merge、rebase、冲突解决、分支管理、remote 管理、凭据管理、外部文件备份和 Git 历史浏览器。

## 阶段计划

### 阶段 1：单向快照导出器

目标：先闭环“事实来源 -> 可恢复仓库快照 -> 独立 hash 验证”，不依赖 Git 或 UI。

改动：

- 新增 `electron/gitBackupExport.js`，实现源文件扫描、图片引用解析、稳定文档 key、内容 hash 文件名、临时 staging、manifest 和 hash 校验；模块通过参数接收路径和版本，不直接依赖 Electron，便于 Node runtime 验证。
- 只读取 `FileLibrary.basePath` 指向的内部笔记；明确排除外部文档、AI 配置、recovery 和 backups。
- 把文档旁 assets 与 `userData/images` 中实际被引用的图片复制到 `vibenote-backup/assets/`。
- HTTP(S) 引用原样保留；缺失图片或允许目录之外的本地图片返回 `export-incomplete`，不发布残缺快照。
- 只在导出副本中把图片绝对路径重写为仓库相对路径，不修改活动笔记。
- 写入 `.vibenote-backup.json` 所有权标记和版本化 `manifest.json`。
- 切换正式快照前比较上一次 manifest；检测外部修改时返回 `mirror-conflict`。
- 在仓库根目录使用不属于托管 pathspec 的 staging 和回退目录，确保切换不跨文件系统；异常遗留在下次启动时校验处理。

验证：

- 新增 `scripts/git-backup-export-runtime.mjs`，使用隔离临时 userData 和目标目录。
- 构造 stream、归档文档、beside-file 图片、app-data 图片、外部文档和应用配置。
- 覆盖包含空格、尖括号和同名不同内容图片的 Markdown 引用，证明解析和目标命名无碰撞。
- 比较导出前后源目录树和 SHA-256，证明源数据零修改。
- 把导出结果复制到另一个绝对路径，解析每个相对图片引用并复核二进制 hash。
- 修改正式快照后再次导出，证明返回 `mirror-conflict` 且外部修改未被覆盖。
- 构造缺失图片和允许目录之外的绝对图片路径，证明不产生新快照或 commit。
- 在 staging 写入、hash 校验和目录切换处分别注入故障，验证旧正式快照仍可读取。

完成证据：

- runtime 输出逐场景 `ok - ...`。
- manifest 中每个源文档、导出文档和图片均有匹配 hash。
- 源目录在所有成功和失败场景中的总 hash 保持一致。

### 阶段 2：Git 命令与配置模块

依赖：阶段 1 已能稳定生成托管快照。

改动：

- 新增 `electron/gitBackup.js`，实现 `GitRunner`、原子配置读写、状态读写和 `GitBackupManager`。
- 所有 Git 命令使用参数数组，设置 `GIT_TERMINAL_PROMPT=0`、单命令超时和 URL 凭据脱敏。
- 实现仓库发现、空目录初始化、进行中操作检测、冲突检测和限定 pathspec 的 add/commit。
- 自动提交加入 `Vibenote-Auto-Backup: true` trailer。
- 实现 upstream、remote tracking ref 和首次 push 的安全判断；混入其他提交或无法建立基线时返回 `push-manual-required`。
- 状态记录 `pushPending`、稳定错误码、脱敏错误摘要和最近成功时间。

验证：

- 新增 `scripts/git-backup-module-runtime.mjs`。
- 使用临时普通仓库与本地 bare remote 验证 init、commit、无变化跳过、无 remote、push、push 失败、冲突和超时。
- 预先 stage 非托管文件，证明自动 commit 仅包含所有权标记和 `vibenote-backup/`，无关文件仍保持 staged。
- 构造已有仓库无 upstream、多个 remote 和混入人工提交的场景，证明自动 push 暂停。
- 验证错误信息不包含带密码 URL、token 或测试环境敏感值。

完成证据：

- `git show --name-only` 只包含两个托管 pathspec。
- 本地与 bare remote 的目标 commit SHA 和 blobs 相同。
- 每个失败场景都保留工作树、已创建 commit 和原始 staged 状态。

### 阶段 3：主进程调度与退出协调

依赖：阶段 1 导出器和阶段 2 Git 管理器。

改动：

- 应用启动时读取 Git 设置，但不改变 `FileLibrary.basePath`。
- 已配置仓库不可访问时返回 `repository-unavailable`，不创建替代目录且不影响源笔记保存。
- 内部文本或内部图片保存成功后调用 `markDirty()`；外部文档保存不触发备份。
- 开启后立即运行；每 5 分钟通过源 manifest 复核是否有实际变化。
- 实现 single-flight 队列：同时最多一个导出或 Git 任务，新变化折叠为一次 pending run。
- 启动时清理或恢复经过 manifest 验证的遗留 staging，并重试待 push commit。
- 在首次退出事件中设置退出 guard，向 renderer 发送带 request ID 的同步刷新请求。
- renderer 确认同步保存后执行导出和仅本地 commit；总计 5 秒超时后终止子进程并继续退出。
- `will-quit` 清理 timer、监听器和仍在运行的 Git 子进程。

验证：

- runtime 使用短测试周期，生产常量仍固定为 5 分钟。
- 连续快速保存多次，断言任务最大并发数为 1，最终 manifest 和 commit 包含最后一次成功保存内容。
- 外部文件保存不改变备份 commit count。
- 模拟永不返回的 Git 命令，证明保存 IPC 不受影响且退出不会无限等待。
- 在 renderer 尚有 350ms debounce 内容时退出，证明同步刷新后的内容同时存在于源文件和本地 commit。

完成证据：

- runtime 时间线记录保存、dirty、export、commit、push 和退出事件。
- 保存 IPC 成功与 Git 结果相互独立。
- 退出总等待不超过 5 秒加固定进程清理容差。

### 阶段 4：IPC、设置页与浏览器 mock

依赖：阶段 2 配置契约和阶段 3 状态事件。

改动：

- 在 `electron/preload.cjs` 暴露 `gitBackup` 窄接口和退出刷新确认通道。
- 在 `src/vite-env.d.ts` 定义设置、状态、错误码和事件类型。
- 在 `src/stores/workspace.ts` 加载配置、订阅状态并代理目录选择与开关动作。
- 在 `src/devMock.ts` 增加与生产接口同形的 Git 设置和状态 mock。
- 在 `src/components/EditorPane.vue` 处理退出刷新请求，调用现有同步保存后确认 request ID。
- 在 `src/App.vue` 新增“Git 自动备份”设置分组；明确“专用仓库”和“单向备份”。
- 在 `src/style.css` 增加路径截断、状态色和窄窗口布局；正常成功不发 toast。

验证：

- 新增 `tests/e2e/git-backup-settings.spec.ts`。
- 首次开关触发目录选择；取消或校验失败后开关恢复关闭。
- 页面只有开关、目录和状态，不出现周期、分支、remote、身份或凭据字段。
- 覆盖 disabled、committed-local、pushed、push-failed、push-manual-required、mirror-conflict、export-incomplete、repository-unavailable 和 conflict。
- 在正常窗口与最小窗口验证长路径、按钮和状态不遮挡、不溢出。
- 模拟退出刷新事件，断言 EditorPane 回传相同 request ID 且同步保存只执行一次。

完成证据：

- 目标 E2E 全部通过，浏览器控制台无错误。
- 正常窗口和最小窗口截图中的文案与状态可读。

### 阶段 5：打包端到端验证与文档

依赖：前四阶段。

改动：

- 新增 `scripts/git-backup-runtime.mjs`，通过隔离 `VIBENOTE_USER_DATA_DIR` 启动打包应用。
- 在 `package.json` 增加 `verify:git-backup`。
- 更新中英文 README，说明事实来源、仓库格式、remote 前置条件和人工恢复方式。
- 新增 `docs/reports/2026-08-11-git-auto-backup-acceptance.md`，只记录实际执行结果，不预填通过状态。

验证命令：

```sh
npm run test:e2e -- tests/e2e/git-backup-settings.spec.ts
npm run test:e2e
npm run build
npm run build:mac
npm run verify:git-backup
npm run verify:data-safety
npm run verify:stability
npm run verify:package
git diff --check
```

完成证据：

- 所有命令退出码为 0。
- 打包 runtime 覆盖源数据隔离、快照、commit、无 remote、bare remote push、失败隔离、镜像冲突和退出提交。
- runtime 构造人工未推送提交，证明自动 push 暂停且不改写分支历史。
- 打包应用完成一次真实目录选择、开关启用和状态展示。

## 交付内容

- `electron/gitBackupExport.js`：单向快照、图片重写、manifest、冲突与恢复。
- `electron/gitBackup.js`：Git 命令、设置、状态、调度和 push 安全检查。
- `electron/main.js`：生命周期、保存事件、IPC 和退出 guard 接入。
- `electron/preload.cjs`：Git 设置与退出刷新窄接口。
- `src/vite-env.d.ts`：类型契约。
- `src/stores/workspace.ts`：设置与状态模型。
- `src/devMock.ts`：浏览器 mock。
- `src/components/EditorPane.vue`：退出前同步刷新确认。
- `src/App.vue`、`src/style.css`：设置页 UI。
- `tests/e2e/git-backup-settings.spec.ts`：交互验收。
- `scripts/git-backup-export-runtime.mjs`：导出器闭环。
- `scripts/git-backup-module-runtime.mjs`：Git 模块闭环。
- `scripts/git-backup-runtime.mjs`：打包应用端到端闭环。
- README、验收报告和 package scripts。

## 验证方式

| 层级 | 验证对象 | 权威证据 |
| --- | --- | --- |
| 导出 | 数据隔离、图片、manifest、可移植、外部修改、不完整输入 | SHA-256 清单和临时目录文件读取 |
| Git | pathspec、trailer、remote 选择、超时 | module runtime 和临时 Git 对象 |
| 调度 | 立即运行、周期、single-flight、退出 | runtime 时间线、并发计数和 Git log |
| UI | 开关、目录、状态、窄窗口 | Playwright 断言和截图 |
| 打包 | Electron、系统 Git、preload IPC | `verify:git-backup` 输出 |
| 回归 | 保存、recovery、图片、AI、外部文件 | 全量 E2E、data-safety、stability、package 输出 |

所有自闭环验证只使用隔离 userData、临时目录和本地 bare remote，不触碰用户真实笔记、真实仓库或远端。

## 完成标准

- 用户只需选择专用仓库并打开一个开关。
- `userData/notes` 始终是唯一活动数据位置，启用和失败均不改变其内容。
- 仓库快照能够依据 manifest 独立校验并人工恢复。
- 导出、commit 和 push 位于保存链路之外，任意失败不导致保存失败。
- 自动 commit 不包含托管 pathspec 之外的 staged 或 unstaged 文件。
- 没有 remote 时本地历史正常；有可靠基线时自动 push；不可靠时明确暂停。
- 退出任务有固定上限，不会造成应用无法关闭。
- 设计文档中的每项验收标准都有自动化证据或明确的外部确认方。

## Blocker 汇总

| Blocker | 影响 | 可继续工作 | 解锁条件 |
| --- | --- | --- | --- |
| 真实远端认证差异 | 不能声明覆盖所有 Git 服务、SSH、代理和凭据助手 | 所有本地实现、bare remote 和错误处理 | 用户在至少一个真实远端确认 push，并提供远端 commit 或 `git ls-remote` 证据 |
| UI 最终主观接受 | 自动化不能判断视觉是否足够低干扰 | 布局、交互、状态和窄窗口自动化 | 用户在打包应用正常与最小窗口确认 |

这些 blocker 不阻塞阶段 1 至阶段 5 的本地实现和自动化闭环，只阻塞对应的外部兼容与主观验收声明。

## 回退策略

- 设置或 Git 模块异常：关闭 `enabled`，停止 timer 和子进程；活动笔记仍从原 `userData/notes` 读写。
- 首次导出失败：不启用新仓库配置，不修改源数据或已有仓库快照。
- 更换仓库失败：继续使用旧配置；新目标中的 staging 按 manifest 校验后恢复或清理。
- 镜像冲突：保留外部修改，不覆盖、不 commit，等待用户处理仓库。
- commit 失败：保留已验证快照和 Git 工作树，下个周期重试，不执行 reset 或 clean。
- push 失败：保留本地 commit，记录 `pushPending`，下次启动或周期重试。
- 发布后回退代码：旧版本继续使用原 `userData/notes`，仓库只是派生备份，不需要数据反迁移。
- 任何回退都不得删除源笔记、修改全局 Git 配置、强制 push 或改写用户分支历史。
