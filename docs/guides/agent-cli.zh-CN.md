# Agent CLI 使用指南

Agent CLI alpha 提供适合机器读取的笔记能力，同时避免向 agent 开放不受限制的文件访问。它可以发现命令、列出和读取内部笔记、搜索 block，并安全地追加或更新一个 block。

## 安装

先把 `Vibenote.app` 移到 `/Applications` 或 `~/Applications`，再打开“设置 > Agent CLI”，点击“安装 Agent CLI”。

Vibenote 会把受管启动器安装到 `~/.local/bin/vibenote`，并使用应用内置的运行时。它不依赖系统 Node.js，不修改 shell 配置，也不会覆盖不属于 Vibenote 的同名命令。如果登录 shell 的 `PATH` 不包含 `~/.local/bin`，设置页会显示此前置条件；更新 `PATH` 并打开新终端后再试。

## 发现命令

先查看版本和能力清单：

```sh
vibenote version
vibenote capabilities
```

CLI 输出面向 agent 采用结构化格式。应把 capability 响应作为命令契约，不要猜测子命令或参数。

## 从源码运行

开发者可以让 CLI 显式访问一个隔离的数据目录：

```sh
node cli/vibenote.mjs capabilities --data-dir /path/to/isolated-user-data --output json
node cli/vibenote.mjs search --data-dir /path/to/isolated-user-data --query "keyword" --limit 10 --output json
```

## 写入保护

`blocks append` 必须提供明确的 `--data-dir`、幂等键，以及 dry-run 得到的 revision 或 `--accept-current`。写入过程包含乐观 revision 检查、快照、recovery 和原子替换。

Alpha 阶段不开放外部文件、整篇替换、delete、restore、任意路径、HTTP 或 MCP。测试写入命令时，应使用隔离或已备份的数据目录。

## 更新已有 block

`blocks update` 原地替换一个 block 的完整正文，保留稳定 ID、位置、语言、自动识别设置、创建时间及其他分隔符字段，不会新增 block。空内容会清空正文，但不会删除 block。

先读取最新 block，使用返回的笔记级 `revision`，并确认内容没有截断（最大读取 262144 字节）。更新只接受稳定 `--block` ID，不接受 legacy index。实际写入必须提供 `--expected-revision`，不支持 `--accept-current` 或修改语言。

```sh
vibenote blocks read --note internal:stream --block <block-id> --max-bytes 262144 --output json

vibenote blocks update --data-dir /path/to/user-data \
  --note internal:stream --block <block-id> --content-stdin \
  --idempotency-key edit-example-1 --expected-revision <revision> \
  --dry-run --output json < updated-block.md

# 使用相同正文及 dry-run 返回的 revision 执行更新。
vibenote blocks update --data-dir /path/to/user-data \
  --note internal:stream --block <block-id> --content-stdin \
  --idempotency-key edit-example-1 --expected-revision <revision> \
  --output json < updated-block.md
```

Dry-run 可以省略 `--expected-revision`，基于当前笔记生成提案；如果提供 revision，仍会校验。Dry-run 不写入快照、恢复文件或幂等记录。正文最大 256 KiB，不允许包含以 `---block:` 开头的行。

更新复用桌面端的笔记锁、更新前快照、恢复候选和原子写入，仅修改目标 block。桌面编辑器无未保存改动时会重新加载；旧版本的桌面保存会被拒绝，未保存文本留在恢复区。

更新幂等键的范围是同一笔记中的 update 命令。哈希记录保存在 block 的 `updates` 分隔符字段，支持进程重启及多次后续更新后的重试。相同键更换正文或目标 block 会返回 `IDEMPOTENCY_MISMATCH`；已成功请求重放返回 `replayed: true` 和当前 revision，不覆盖后续编辑，也不表示当前正文仍与原请求相同。记录随 block 及其分隔符元数据保留。

遇到 `REVISION_CONFLICT`（退出码 4），重新读取最新内容并合并编辑后再提出更新，不要仅替换 revision 强行重试。目标不存在返回退出码 3，参数无效返回退出码 2。

## 验证 CLI

```sh
npm run verify:cli
npm run verify:cli-coordination
npm run verify:agent-cli-install
```

这些检查只使用合成临时数据，不需要访问真实 note stream。
