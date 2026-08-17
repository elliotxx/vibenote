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

## Documentation

- [Using Vibenote](docs/guides/using-vibenote.md): blocks, shortcuts, data location, and uninstalling.
- [Git snapshot backup](docs/guides/git-auto-backup.md): setup, storage behavior, repository safety, and recovery.
- [Agent CLI](docs/guides/agent-cli.md): installation, command discovery, and mutation safeguards.
- [Contributing](CONTRIBUTING.md): local development, verification, and public repository safety.
- [Release checklist](RELEASE.md): packaging, acceptance gates, and tag-driven publishing.

## Feedback

Please open a [GitHub Issue](https://github.com/elliotxx/vibenote/issues) for bugs, install problems, data-save issues, or product feedback.

Include:

- macOS version and chip type.
- Vibenote version.
- What you expected to happen.
- What actually happened.
- Steps to reproduce the issue.

For data-related issues, follow the backup guidance in [Using Vibenote](docs/guides/using-vibenote.md) before trying repairs or reinstalling.

## Contributing

Contributions are welcome around the minimal capture experience. See [CONTRIBUTING.md](CONTRIBUTING.md) before making changes or submitting a pull request.

## License

No license has been declared yet. Add a `LICENSE` file before public distribution.
