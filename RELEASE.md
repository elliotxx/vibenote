# Release Checklist

## 0.1.0 macOS Release

Product name: Vibenote

Repository: `github.com/elliotxx/vibenote`

Tagline: 沉浸式、顺手、AI Native 的纯文本笔记。

English tagline: Immersive, effortless, AI-native plain text notes.

Release mode: tag-driven macOS release distribution.

The app is unsigned and not notarized, so testers must explicitly allow the first launch in macOS. Do not describe the build as signed, notarized, or Gatekeeper-clean.

### Scope

- macOS arm64 only.
- One persistent note stream.
- Block-based editing with language selection and auto-detection.
- New block, delete block, block formatting, image paste storage, settings, and automatic saving.
- No Heynote data migration or access.
- No tabs, sidebar tree, multiple buffers, command palette, or note search in the first release.

### Local Preflight

```sh
npm ci
npm run release:mac
```

Expected artifacts:

- `dist/Vibenote-0.1.0-arm64.dmg`
- `dist/SHA256SUMS`
- `dist/mac-arm64/Vibenote.app`

Verify checksums before tagging:

```sh
cd dist
shasum -a 256 -c SHA256SUMS
```

### Verification

Run the full suite before tagging:

```sh
npm run verify:package
npm run verify:runtime
npm run verify:stability
npm run verify:edges
npm run verify:install
```

Acceptance criteria:

- The DMG, bundled icon, version metadata, preload, renderer assets, and ripgrep runtime are present.
- The DMG mounts and contains `Vibenote.app` plus an `Applications` symlink.
- The packaged app launches as the frontmost app.
- Text pasted into the editor is saved.
- Runtime text input persists valid block structure.
- Rapid quit preserves long pasted content.
- Deleting a non-final block persists the deletion.
- Deleting the final block is refused.
- Formatting invalid JSON preserves the original content and block structure.
- The DMG-installed `/Applications/Vibenote.app` launches from `/Applications`.

### Manual Dogfood Gate

Use the installed app for normal note capture before tagging a release:

- Paste and edit Markdown, JSON, JavaScript or TypeScript, Python, and SQL snippets.
- Quit and relaunch several times.
- Restart macOS once if this is intended to become the daily note stream.
- Verify that content remains in `~/Library/Application Support/Vibenote/notes/stream.txt`.
- Confirm the UI still feels simple enough: single editor, no sidebar, no tabs.

### Tester Install Instructions

Send testers these instructions with the DMG:

1. Download `Vibenote-0.1.0-arm64.dmg`.
2. Optionally verify the SHA256 checksum from `SHA256SUMS`.
3. Open the DMG and drag `Vibenote.app` to `Applications`.
4. Open `/Applications` in Finder.
5. Right-click `Vibenote.app`, choose `Open`, then confirm the warning.
6. If macOS still blocks launch, open System Settings, Privacy & Security, then allow Vibenote from the security warning.
7. Start writing, quit, relaunch, and confirm notes persist.

Tester-facing warning:

```text
This Vibenote build is unsigned and not notarized. macOS may block the first launch because it cannot verify the developer. Only install it if you trust this build source.
```

### Publish

Releases are created by pushing a version tag that matches `package.json`:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The `.github/workflows/release.yml` workflow builds the macOS arm64 DMG, verifies `SHA256SUMS`, and creates a formal GitHub Release with:

- `Vibenote-0.1.0-arm64.dmg`
- `SHA256SUMS`

### Uninstall Instructions

Remove the app:

```sh
rm -rf "/Applications/Vibenote.app"
```

Remove app data only if the note stream content is no longer needed:

```sh
rm -rf "$HOME/Library/Application Support/Vibenote"
```

### Known Limits

- The build is unsigned and not notarized.
- macOS Gatekeeper will warn on first launch.
- Testers must trust the build source and explicitly allow launch.
- Public distribution still requires Developer ID signing, hardened runtime, Apple notarization, and stapling.
- The first release is intentionally macOS-only and arm64-only.
- There is no auto-update channel.

### Release Decision

Publish `0.1.0` only when:

- The full verification suite passes.
- One short dogfood pass finds no data-loss or launch issues.
- `SHA256SUMS` has been generated.
- The tester warning and install instructions are included wherever the DMG is shared.
- The tag-driven GitHub Actions release workflow passes.

Do not call this a signed or notarized release until Developer ID signing and notarization are complete.
