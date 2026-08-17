# Agent CLI 使用指南

Agent CLI alpha 提供适合机器读取的笔记能力，同时避免向 agent 开放不受限制的文件访问。它可以发现命令、列出和读取内部笔记、搜索 block，并安全地追加一个 block。

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

Alpha 阶段不开放外部文件、replace、delete、restore、任意路径、HTTP 或 MCP。测试写入命令时，应使用隔离或已备份的数据目录。

## 验证 CLI

```sh
npm run verify:cli
npm run verify:cli-coordination
npm run verify:agent-cli-install
```

这些检查只使用合成临时数据，不需要访问真实 note stream。
