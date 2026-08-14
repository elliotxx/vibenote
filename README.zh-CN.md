<div align="center">
  <img src="./build/icon-preview.png" alt="Vibenote 图标" width="96" height="96">

  <h1>Vibenote</h1>

  <p><strong>沉浸式、顺手、AI Native 的纯文本笔记。</strong></p>

  <p>
    <a href="https://github.com/elliotxx/vibenote"><img alt="Repository" src="https://img.shields.io/badge/repo-elliotxx%2Fvibenote-24292f"></a>
    <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20arm64-000000">
    <img alt="Version" src="https://img.shields.io/github/v/release/elliotxx/vibenote?label=version">
    <img alt="Electron" src="https://img.shields.io/badge/Electron-41-47848f">
    <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42b883">
  </p>

  <p>
    <a href="./README.md">English</a>
    |
    简体中文
  </p>
</div>

## 概览

Vibenote 是一个面向 macOS 的本地纯文本笔记应用。它把所有内容放在一个持续增长的 note stream 里，用 block 区分不同笔记内容，让你像瀑布流一样无脑记录，不需要先决定目录、文件、语法或格式。

首发版本聚焦极简记录体验：单窗口、单 buffer、纯文本、自动保存、按 block 切分内容，并保留对 Markdown、JSON、JavaScript/TypeScript、Python、SQL 等常见内容的轻量语言识别和格式化能力。

## 为什么是 Vibenote

- **沉浸式记录**：没有目录树、tab 和多 buffer 切换，打开就是唯一的 note stream。
- **顺手输入**：通过快捷键快速新增、拆分、删除和跳转 block，适合边想边写。
- **纯文本优先**：内容保存为本地 `stream.txt`，可读、可备份、可长期保存。
- **Block 作为边界**：每段笔记都是独立 block，可以拥有自己的语言模式和自动识别状态。
- **AI Native，但不破坏内容**：AI 能围绕 block 边界做辅助，但不承担全局整理和重写，避免对原始记录造成破坏性修改。

## 当前功能

- 一个持久化 note stream。
- Block 级编辑、新增、删除、拆分、跳转和选择。
- Block 级语言选择与自动识别。
- 当前 block 格式化。
- 粘贴图片后保存到本地应用数据目录，并在正文中引用。
- 自动保存和退出前同步保存。
- 可选的内部笔记与引用图片单向 Git 快照备份。
- macOS 全局显示/隐藏快捷键。
- 本地应用数据隔离，不读取、迁移或修改 Heynote 数据。

## 首发范围

Vibenote 当前只支持 macOS arm64。为了保持简单，首发版本不包含多 buffer、tab、侧边栏目录树、全文搜索、命令面板、block folding、云同步或 Heynote 数据迁移。

## 快速开始

最快的方式是让本地 AI coding agent 帮你安装最新 release。把下面这段 prompt 复制到 Codex、Claude Code 或其他能在本机执行 shell 命令的 agent 里：

```text
请在这台 Mac 上从 GitHub 安装最新版本的 Vibenote。

要求：
- 使用 https://github.com/elliotxx/vibenote/releases/latest。
- 将最新的 macOS arm64 DMG 资产（文件名类似 Vibenote-*-arm64.dmg）和对应的 SHA256SUMS 下载到临时目录。
- 使用 shasum -a 256 -c SHA256SUMS 校验下载文件。
- 挂载 DMG，将 Vibenote.app 复制到 Applications 文件夹，卸载 DMG，并启动应用。
- 不要读取、迁移或修改任何 Heynote 数据。
- 除非 release 下载失败，否则不要 clone 源码或本地构建。
- 如果 macOS 拦截未签名应用，请告诉我准确的 Finder 右键打开或“隐私与安全”放行步骤。
```

手动安装：

1. 从 [Vibenote Releases](https://github.com/elliotxx/vibenote/releases/latest) 下载最新的 `Vibenote-*-arm64.dmg` 和 `SHA256SUMS`。
2. 校验文件哈希：
   ```sh
   shasum -a 256 -c SHA256SUMS
   ```
3. 打开 DMG，将 `Vibenote.app` 拖到 Applications 文件夹。
4. 启动 Vibenote。
5. 首次启动如被 macOS 拦截，请在 Finder 中打开 Applications 文件夹，右键点击 `Vibenote.app`，选择“打开”，再确认弹窗。
6. 如果右键打开仍被拦截，请进入“系统设置 > 隐私与安全”，在安全提示处允许打开 Vibenote。

只安装你信任来源的 DMG。当前构建未签名、未公证。

## 快捷键

| 操作 | macOS 快捷键 |
| --- | --- |
| 显示或隐藏应用 | `Cmd+Shift+Space` |
| 在当前 block 后新增 block | `Cmd+Enter` |
| 在当前 block 前新增 block | `Option+Enter` |
| 在 note stream 末尾新增 block | `Cmd+Shift+Enter` |
| 在 note stream 开头新增 block | `Shift+Option+Enter` |
| 从光标处拆分 block | `Cmd+Option+Enter` |
| 删除当前 block | `Cmd+Shift+D` 或 `Ctrl+Shift+D` |
| 选择当前 block，再按一次全选 | `Cmd+A` |
| 跳到上一个 block | `Cmd+Up` |
| 跳到下一个 block | `Cmd+Down` |
| 在上方添加多光标 | `Cmd+Option+Up` |
| 在下方添加多光标 | `Cmd+Option+Down` |
| 聚焦语言选择器 | `Cmd+L` |
| 格式化当前 block | `Shift+Option+F` |

## 数据位置

Vibenote 使用独立的 Electron `userData` 目录：

```sh
$HOME/Library/Application Support/Vibenote/notes/stream.txt
$HOME/Library/Application Support/Vibenote/notes/.images/
```

### 可选 Git 快照备份

在设置中选择一个专用 Git 仓库，再开启 Git 自动备份。Vibenote 每 5 分钟导出一次经过校验的快照，并且只提交 `.vibenote-backup.json` 和 `vibenote-backup/`。活动数据仍以 `userData/notes` 为唯一事实来源；Git 仓库只是单向派生备份，应用不会从仓库反向读取或导入。

实际存储链路如下：

```text
编辑器 / 自动保存
  -> $HOME/Library/Application Support/Vibenote/notes/  （活动文件）
  -> 经过校验的临时快照
  -> <所选仓库>/vibenote-backup/                        （派生副本）
  -> 本地 Git commit
  -> remote 满足安全条件时自动 push
```

普通编辑会直接写入活动文件，而不是写入 Git 仓库。所选仓库只包含备份所有权标记和导出的快照：

```text
<所选仓库>/
├── .vibenote-backup.json
└── vibenote-backup/
    ├── manifest.json
    ├── notes/
    └── assets/
```

选择仓库时会先生成一份经过校验的初始快照；开启备份后会立即执行一次，之后每 5 分钟导出发生变化的笔记。退出应用时会先刷新待保存的笔记，并在较短时限内尝试创建本地备份提交，但退出阶段不会进行网络 push。没有 remote 时，备份会停留在本地 commit 状态。

所选空目录可以由应用初始化。已有仓库需要用户自行配置 Git 作者身份。没有 remote 时提交只保留在本地；只有单一明确 remote 和安全 upstream 基线同时成立时才会自动 push，否则保留本地提交并提示人工处理。Vibenote 不管理分支、remote 或凭据，也不会执行 pull、merge、rebase、reset、checkout、clean 等同步或历史改写命令。

复用已有仓库不会覆盖无关的已跟踪文件，因为提交范围只限于上述两个托管路径；但自动提交会进入该仓库的当前分支，符合安全条件的 remote 也可能收到这些提交，因此仍建议使用专用仓库。不要手动修改托管快照：检测到外部改动后会进入 `mirror-conflict` 并暂停覆盖，不会把修改反向导入应用。关闭备份不会删除已经导出的文件或 Git 历史。

导出的 `vibenote-backup/manifest.json` 记录文档和图片哈希。需要人工恢复时，应先检查并验证 manifest，再把所需文本或图片复制到另一个安全位置。Vibenote 暂不提供自动导入或恢复界面。

外部文档、API key、应用设置、recovery 文件和本地备份历史均不进入仓库。完整安全模型见 [Git 自动备份设计](docs/design/2026-08-11-git-auto-backup.md)。

### Agent CLI

将 `Vibenote.app` 移到系统或用户的“应用程序”目录后，进入“设置 > Agent CLI”，点击“安装 Agent CLI”。应用会把受管启动器安装到 `~/.local/bin/vibenote`，直接使用应用内置运行时，不依赖系统 Node.js。

```sh
vibenote version
vibenote capabilities
```

Vibenote 不会修改 shell 配置，也不会覆盖或删除非本应用管理的同名命令。如果登录 shell 的 `PATH` 尚未包含 `~/.local/bin`，设置页会明确提示；手动配置 PATH 并重开终端后即可使用。应用升级后，设置页会提供 CLI 更新操作。

卸载应用：

```sh
rm -rf "/Applications/Vibenote.app"
```

只有在确认不再需要笔记内容时，才删除应用数据：

```sh
rm -rf "$HOME/Library/Application Support/Vibenote"
```

## 开发者须知

开发运行：

```sh
npm install
npm run dev
```

如果 Electron 二进制下载受限，可以先只检查浏览器渲染层：

```sh
npx vite --host 127.0.0.1 --port 3344 --strictPort
```

浏览器渲染层在没有 Electron preload 时会使用 localStorage mock，不会写入真实应用数据。

构建 macOS 试用安装包：

```sh
npm run release:mac
```

构建产物：

- `dist/Vibenote-<version>-arm64.dmg`
- `dist/SHA256SUMS`

当前发布模式是**通过 tag 触发的 macOS release 分发**。应用未签名、未公证，用户需要理解 macOS 首次启动拦截提示。大范围分发前仍需要 Developer ID 签名和 Apple notarization。

分享前可以校验产物：

```sh
cd dist
shasum -a 256 -c SHA256SUMS
```

### 发布

Vibenote 通过 tag 触发发布。推送与 `package.json` 版本一致的版本 tag：

```sh
git tag v<version>
git push origin v<version>
```

GitHub Actions 会构建 macOS arm64 DMG，校验 `SHA256SUMS`，并创建正式 GitHub Release，上传 DMG 和 checksum 文件。当前构建仍然未签名、未公证。

### 技术栈

- Electron 41
- Vue 3
- Pinia
- CodeMirror 6
- Prettier
- ripgrep via `@vscode/ripgrep`
- electron-builder

### 验证

```sh
npm run build
npm run verify:package
npm run verify:runtime
npm run verify:stability
npm run verify:edges
npm run verify:install
```

验证脚本覆盖安装包结构、DMG 内容、运行时输入、退出保存、删除 block、格式化异常保护，以及从 `/Applications` 启动安装后的应用。

更多首发候选检查项见 [RELEASE.md](./RELEASE.md)。

## 反馈

如遇到 bug、安装问题、保存问题或产品建议，请提交 [GitHub Issue](https://github.com/elliotxx/vibenote/issues)。

请尽量附上：

- macOS 版本和芯片类型。
- Vibenote 版本。
- 你预期发生什么。
- 实际发生了什么。
- 可复现步骤。

如果问题和数据有关，请先备份 `$HOME/Library/Application Support/Vibenote`，再尝试修复或重装。

## 贡献

欢迎围绕极简记录体验提交改进。首发阶段优先关注：

- 数据保存可靠性。
- Block 编辑体验。
- macOS 打包和小范围试用分发。
- 公开分发前的 Developer ID 签名和公证。
- 快捷键一致性。
- AI Native 的非破坏式辅助能力。

提交信息请使用 Conventional Commits。

## 许可证

当前仓库尚未声明许可证。公开分发前请补充 `LICENSE` 文件。
