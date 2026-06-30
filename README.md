<div align="center">
  <img src="./build/icon-preview.png" alt="Vibenote icon" width="96" height="96">

  <h1>Vibenote</h1>

  <p><strong>Immersive, effortless, AI-native plain text notes.</strong></p>

  <p>
    <a href="https://github.com/elliotxx/vibenote"><img alt="Repository" src="https://img.shields.io/badge/repo-elliotxx%2Fvibenote-24292f"></a>
    <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20arm64-000000">
    <img alt="Version" src="https://img.shields.io/badge/version-0.1.0-blue">
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
- macOS global show/hide shortcut.
- Isolated app data; Vibenote does not read, migrate, or modify Heynote data.

## First Release Scope

Vibenote `0.1.0` targets macOS arm64 only. To keep the experience minimal, this version intentionally does not include multiple buffers, tabs, a sidebar tree, full-text search, a command palette, block folding, cloud sync, or Heynote data migration.

## Quick Start

The fastest path is to let an AI coding agent install it for you from source. Copy this prompt into Codex, Claude Code, or another local agent that can run shell commands on your Mac:

```text
Install Vibenote from https://github.com/elliotxx/vibenote on this Mac.

Requirements:
- Do not touch any Heynote data.
- Clone or update the repo under $HOME/workspace/vibenote.
- Install dependencies with npm.
- Build the unsigned macOS arm64 package with npm run release:mac.
- Verify dist/SHA256SUMS.
- Mount dist/Vibenote-0.1.0-arm64.dmg, copy Vibenote.app into the Applications folder, unmount the DMG, and launch the app.
- If macOS blocks the unsigned app, tell me the exact Finder right-click Open or Privacy & Security steps.
```

Manual install:

1. Download or build `Vibenote-0.1.0-arm64.dmg`.
2. Verify the checksum with `SHA256SUMS` if it is provided.
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
~/Library/Application Support/Vibenote/notes/stream.txt
~/Library/Application Support/Vibenote/notes/.images/
```

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

Build the macOS release artifacts:

```sh
npm run release:mac
```

Expected artifacts:

- `dist/Vibenote-0.1.0-arm64.dmg`
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
git tag v0.1.0
git push origin v0.1.0
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
npm run verify:stability
npm run verify:edges
npm run verify:install
```

The verification suite checks package structure, DMG contents, runtime input, quit-time save behavior, block deletion, invalid-format protection, and launching the installed app from `/Applications`.

See [RELEASE.md](./RELEASE.md) for the first-release checklist.

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
