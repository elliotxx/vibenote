# Git 快照备份使用指南

Git 备份是内部笔记的第二份副本，不是笔记的工作目录。Vibenote 仍然读写自己的应用数据，所选 Git 仓库只接收经过校验的单向快照。

## 配置备份

1. 打开设置，找到 Git 自动备份。
2. 选择一个专用 Git 仓库。Vibenote 可以初始化空目录；非空目录必须已经是 Git 仓库。
3. 如有需要，为仓库配置 Git 作者身份。
4. 开启 Git 自动备份，并检查设置页显示的状态。

建议使用专用仓库。也可以复用已有仓库，但 Vibenote 的自动提交会进入其当前分支，并可能随该分支一同 push。

## 数据保存在哪里

普通编辑会直接写入活动笔记文件：

```text
$HOME/Library/Application Support/Vibenote/notes/
```

Git 仓库只包含备份所有权标记和导出的快照：

```text
<所选仓库>/
├── .vibenote-backup.json
└── vibenote-backup/
    ├── manifest.json
    ├── notes/
    └── assets/
```

完整链路如下：

```text
编辑器 / 自动保存
  -> 活动笔记文件
  -> 经过校验的临时快照
  -> vibenote-backup/
  -> 本地 Git commit
  -> 存在符合条件的 remote 时安全 push
```

Vibenote 不会把仓库快照反向读入编辑器。移动、删除或停用备份仓库都不会改变活动笔记的位置。

## 什么时候执行备份

- 选择仓库时会准备一份经过校验的初始快照。
- 开启备份后会立即执行一次。
- 应用运行期间每 5 分钟检查一次变化；内容没有变化时不会创建提交。
- 退出应用时会先刷新待保存的笔记，并在较短时限内尝试创建本地备份提交；退出阶段不会进行网络 push。
- 下次启动后可以重试仍然符合安全条件的待 push 提交。

## 复用已有仓库

Vibenote 只会暂存和提交 `.vibenote-backup.json` 与 `vibenote-backup/`。无关的已跟踪文件和用户预先暂存的文件不会进入自动提交。

路径限制并不能隔离分支历史。自动提交仍然是当前分支上的普通 commit，push 该分支时会发送所有领先于远端的提交。因此，只有在能够证明待推送范围全部是 Vibenote 备份提交时，应用才会自动 push；无法确认时会保留本地提交并提示人工处理。

Vibenote 不会创建或切换分支，不会配置 remote 或凭据，也不会执行 pull、fetch、merge、rebase、reset、checkout、clean。不要手动修改托管快照；如果其哈希与 manifest 不再一致，备份会进入 `mirror-conflict` 并暂停，不会覆盖或导入这些改动。

## Remote 行为

- 没有 remote：备份以本地 commit 成功结束。
- 存在单一符合条件的 remote 和安全 upstream 基线：自动 push。
- 存在多个 remote、缺少安全基线、包含其他未推送提交、仓库冲突或凭据不可用：保留本地快照，并在设置页提示需要处理的事项。

Vibenote 不保存 Git 凭据，认证由用户现有的 Git 配置负责。

## 哪些内容不会备份

快照包含内部文本笔记，以及这些笔记引用的 Vibenote 托管图片。外部文档、API key、应用设置、recovery 文件、本地备份历史、外部文件登记和运行状态不会进入仓库。

## 人工恢复文件

Vibenote 暂不提供自动导入或恢复功能。需要恢复内容时：

1. 使用备份仓库的副本或 clone 进行操作。
2. 检查 `vibenote-backup/manifest.json`；如果需要确认完整性，校验其中记录的哈希。
3. 把 `vibenote-backup/notes/` 或 `vibenote-backup/assets/` 中需要的文件复制到另一个安全位置。
4. 检查恢复结果后，再决定是否替换任何活动数据。

实现细节和完整安全模型见 [Git 自动备份设计](../design/2026-08-11-git-auto-backup.md)。
