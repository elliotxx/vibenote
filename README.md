<div align="center">
  <img src="./build/icon-preview.png" alt="Vibenote icon" width="96" height="96">

  <h1>Vibenote</h1>

  <p><strong>Immersive, effortless, AI-native plain text notes.</strong></p>

  <p>
    <a href="https://github.com/elliotxx/vibenote"><img alt="Repository" src="https://img.shields.io/badge/repo-elliotxx%2Fvibenote-24292f"></a>
    <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20arm64-000000">
    <img alt="Version" src="https://img.shields.io/github/v/release/elliotxx/vibenote?label=version">
    <img alt="Electron" src="https://img.shields.io/badge/Electron-41-47848f">
    <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42b883">
  </p>

  <p>
    English
    |
    <a href="./README.zh-CN.md">简体中文</a>
  </p>
</div>

## Overview

Vibenote is a local plain text note app for macOS. It keeps everything in one continuous note stream and uses blocks to separate ideas, snippets, logs, and drafts. The goal is waterfall-like capture: open the app, write immediately, and avoid thinking about folders, files, syntax, or formatting first.

The first release focuses on a minimal capture loop: one window, one buffer, plain text, autosave, block boundaries, lightweight language detection, and formatting for common technical notes such as Markdown, JSON, JavaScript/TypeScript, Python, and SQL.

## Why Vibenote

- **Immersive capture**: no sidebar tree, tabs, or buffer switching; the only surface is your note stream.
- **Effortless input**: shortcuts make it fast to add, split, delete, select, and navigate blocks while writing.
- **Plain text first**: content is stored as a local `stream.txt` file that is readable, portable, and easy to back up.
- **Blocks as boundaries**: each note segment can carry its own language mode and auto-detection state.
- **AI Native without destructive cleanup**: AI assistance can work around block boundaries without owning global reorganization or rewriting your source notes.

## Features

- One persistent note stream.
- Block-level editing, creation, deletion, splitting, navigation, and selection.
- Block-level language selection and auto-detection.
- Current-block formatting.
- Local image storage for pasted images, referenced from the text stream.
- Autosave plus synchronous save on quit.
- Optional one-way Git snapshot backup for internal notes and referenced images.
- macOS global show/hide shortcut.
- Isolated app data; Vibenote does not read, migrate, or modify Heynote data.

## First Release Scope

Vibenote currently targets macOS arm64 only. To keep the experience minimal, the first release intentionally does not include multiple buffers, tabs, a sidebar tree, full-text search, a command palette, block folding, cloud sync, or Heynote data migration.

## Quick Start

The fastest path is to let an AI coding agent install the latest release for you. Copy this prompt into Codex, Claude Code, or another local agent that can run shell commands on your Mac:

```text
Install the latest Vibenote release from GitHub on this Mac.

Requirements:
- Use https://github.com/elliotxx/vibenote/releases/latest.
- Download the latest macOS arm64 DMG asset named like Vibenote-*-arm64.dmg and the matching SHA256SUMS file into a temporary folder.
- Verify the download with shasum -a 256 -c SHA256SUMS.
- Mount the DMG, copy Vibenote.app into the Applications folder, unmount the DMG, and launch the app.
- Do not touch any Heynote data.
- Do not clone or build from source unless the release download fails.
- If macOS blocks the unsigned app, tell me the exact Finder right-click Open or Privacy & Security steps.
```

Manual install:

1. Download the latest `Vibenote-*-arm64.dmg` and `SHA256SUMS` from [Vibenote Releases](https://github.com/elliotxx/vibenote/releases/latest).
2. Verify the checksum:
   ```sh
   shasum -a 256 -c SHA256SUMS
   ```
3. Open the DMG and drag `Vibenote.app` into the Applications folder.
4. Launch Vibenote.
5. If macOS blocks the first launch, open the Applications folder in Finder, right-click `Vibenote.app`, choose `Open`, then confirm the dialog.
6. If right-click `Open` is still blocked, go to System Settings, Privacy & Security, and allow Vibenote from the security warning shown there.

Only share the DMG with people who trust the build source. This release is unsigned and not notarized.

## Keyboard Shortcuts

| Action | macOS shortcut |
| --- | --- |
| Show or hide app | `Cmd+Shift+Space` |
| Add block after current block | `Cmd+Enter` |
| Add block before current block | `Option+Enter` |
| Add block at end of note stream | `Cmd+Shift+Enter` |
| Add block at start of note stream | `Shift+Option+Enter` |
| Split block at cursor | `Cmd+Option+Enter` |
| Delete current block | `Cmd+Shift+D` or `Ctrl+Shift+D` |
| Select current block, then select all | `Cmd+A` |
| Move to previous block | `Cmd+Up` |
| Move to next block | `Cmd+Down` |
| Add cursor above | `Cmd+Option+Up` |
| Add cursor below | `Cmd+Option+Down` |
| Focus language selector | `Cmd+L` |
| Format current block | `Shift+Option+F` |

## Data Location

Vibenote uses its own Electron `userData` directory:

```sh
$HOME/Library/Application Support/Vibenote/notes/stream.txt
$HOME/Library/Application Support/Vibenote/notes/.images/
```

### Optional Git snapshot backup

Open Settings, choose a dedicated Git repository, then enable Git backup. Vibenote exports a verified snapshot every five minutes and creates commits only for `.vibenote-backup.json` and `vibenote-backup/`. The active `userData/notes` directory remains the single source of truth; the repository is a derived, one-way backup and is never read back into the app.

An empty selected directory can be initialized automatically. For an existing repository, configure the Git author identity yourself. With no remote, commits stay local. Vibenote pushes only when one unambiguous remote and a safe upstream baseline are available; otherwise it preserves the local commit and asks for manual attention. It never manages branches, remotes, or credentials and never runs history-changing or synchronization commands such as pull, merge, rebase, reset, checkout, or clean.

The exported `vibenote-backup/manifest.json` records document and asset hashes. For manual recovery, inspect and verify that manifest, then copy the required exported text or images to a separate safe location. Vibenote intentionally has no automatic import or restore UI.

Uninstall the app:

```sh
rm -rf "/Applications/Vibenote.app"
```

Only remove app data after confirming the note stream is no longer needed:

```sh
rm -rf "$HOME/Library/Application Support/Vibenote"
```

## Developer Notes

Run the app for development:

```sh
npm install
npm run dev
```

If Electron binary download is blocked, you can still inspect the renderer:

```sh
npx vite --host 127.0.0.1 --port 3344 --strictPort
```

The browser renderer uses a localStorage mock when the Electron preload bridge is unavailable, so it does not write real app data.

### Agent CLI alpha

Vibenote includes an Agent-oriented CLI alpha. It can discover capabilities, list and read internal notes, search blocks, and safely append one block with dry-run, optimistic revision checks, idempotency, snapshot, recovery, and atomic replacement.

After moving `Vibenote.app` to `/Applications` or `~/Applications`, open **Settings > Agent CLI** and choose **Install Agent CLI**. Vibenote installs a managed launcher at `~/.local/bin/vibenote` using the app's bundled runtime, so system Node.js is not required. It never edits shell configuration and never overwrites or removes an unowned command. If `~/.local/bin` is not already in the login shell's `PATH`, Settings reports that prerequisite explicitly.

```sh
vibenote version
vibenote capabilities
```

Developers can also run it from a source checkout:

```sh
node cli/vibenote.mjs capabilities --data-dir /path/to/isolated-user-data --output json
node cli/vibenote.mjs search --data-dir /path/to/isolated-user-data --query "keyword" --limit 10 --output json
```

Mutation remains deliberately gated: `blocks append` requires an explicit `--data-dir`, an idempotency key, and either a dry-run revision or `--accept-current`. The CLI does not expose external files, replace, delete, restore, arbitrary paths, HTTP, or MCP. Use an isolated or backed-up data directory while the CLI remains alpha.

Verify the complete CLI contract with synthetic temporary data:

```sh
npm run verify:cli
npm run verify:agent-cli-install
```

Build the macOS release artifacts:

```sh
npm run release:mac
```

Expected artifacts:

- `dist/Vibenote-<version>-arm64.dmg`
- `dist/SHA256SUMS`

The current release mode is **tag-driven macOS release distribution**. The app is unsigned and not notarized, so users must understand the macOS first-launch warning. Broad distribution still requires Developer ID signing and Apple notarization.

Before sharing a build, verify checksums:

```sh
cd dist
shasum -a 256 -c SHA256SUMS
```

### Release

Vibenote releases are tag-driven. Push a version tag that matches `package.json`:

```sh
git tag v<version>
git push origin v<version>
```

GitHub Actions builds the macOS arm64 DMG, verifies `SHA256SUMS`, and creates a formal GitHub Release with the DMG and checksum file. The release is still unsigned and not notarized.

### Tech Stack

- Electron 41
- Vue 3
- Pinia
- CodeMirror 6
- Prettier
- ripgrep via `@vscode/ripgrep`
- electron-builder

### Verification

```sh
npm run build
npm run verify:package
npm run verify:runtime
npm run verify:cli
npm run verify:cli-coordination
npm run verify:git-backup-export
npm run verify:git-backup-module
npm run verify:git-backup
npm run verify:stability
npm run verify:edges
npm run verify:install
```

The verification suite checks package structure, DMG contents, runtime input, quit-time save behavior, block deletion, invalid-format protection, and launching the installed app from `/Applications`.

See [RELEASE.md](./RELEASE.md) for the first-release checklist.

## Feedback

Please open a [GitHub Issue](https://github.com/elliotxx/vibenote/issues) for bugs, install problems, data-save issues, or product feedback.

Include:

- macOS version and chip type.
- Vibenote version.
- What you expected to happen.
- What actually happened.
- Steps to reproduce the issue.

For data-related issues, back up `$HOME/Library/Application Support/Vibenote` before trying repairs or reinstalling.

## Contributing

Contributions are welcome around the minimal capture experience. First-release priorities:

- Data-save reliability.
- Block editing ergonomics.
- macOS packaging and tag-driven release automation.
- Developer ID signing and notarization before public distribution.
- Shortcut consistency.
- Non-destructive AI-native assistance.

Please use Conventional Commits.

## License

No license has been declared yet. Add a `LICENSE` file before public distribution.
