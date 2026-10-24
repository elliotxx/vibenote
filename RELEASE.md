# Release Checklist

## Versioned macOS Release

Product name: Vibenote

Repository: `github.com/elliotxx/vibenote`

Tagline: 沉浸式、顺手、AI Native 的纯文本笔记。

English tagline: Immersive, effortless, AI-native plain text notes.

Release mode: tag-driven macOS release distribution.

`npm run release:mac` stays unsigned unless signing credentials are present in the environment. Do not describe a build as signed, notarized, or Gatekeeper-clean unless `dist/release-mode.json` says so. Unsigned testers must explicitly allow the first launch in macOS.

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

- `dist/Vibenote-<version>-arm64.dmg`
- `dist/SHA256SUMS`
- `dist/mac-<arch>/Vibenote.app`

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
- Packaged-app verification runs headlessly with every application window hidden.
- Runtime verification uses an isolated temporary user-data directory and never modifies the user's real note stream.
- Text pasted into the editor is saved.
- Runtime text input persists valid block structure.
- Rapid quit preserves long pasted content.
- Deleting a non-final block persists the deletion.
- Deleting the final block is refused.
- Formatting invalid JSON preserves the original content and block structure.
- The DMG-installed `/Applications/Vibenote.app` launches from `/Applications`.

The automated gates do not use AppleScript, global keyboard input, the system clipboard, or screenshots, so they can run without interrupting other desktop work.

### Optional Visible Dogfood

Run this only when a visible UI check is explicitly needed:

- Paste and edit Markdown, JSON, JavaScript or TypeScript, Python, and SQL snippets.
- Quit and relaunch several times.
- Restart macOS once if this is intended to become the daily note stream.
- Verify that content remains in `$HOME/Library/Application Support/Vibenote/notes/stream.txt`.
- Confirm the UI still feels simple enough: single editor, no sidebar, no tabs.

### Tester Install Instructions

Send testers these instructions with an unsigned DMG. Signed and notarized releases can stop after dragging the app to Applications.

1. Download `Vibenote-<version>-arm64.dmg`.
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
git tag v<version>
git push origin v<version>
```

The `.github/workflows/release.yml` workflow builds the macOS arm64 DMG, verifies `SHA256SUMS`, and creates a formal GitHub Release.

Without Apple credentials, the release contains:

- `Vibenote-<version>-arm64.dmg`
- `SHA256SUMS`

With Developer ID and notarization credentials, the same tag workflow also signs, notarizes, and uploads:

- `Vibenote-<version>-arm64.zip`
- `Vibenote-<version>-arm64.zip.blockmap`
- `latest-mac.yml`

### Signed Release

The signed path uses electron-builder for the DMG and zip. The custom `scripts/create-dmg.mjs` helper stays on the unsigned path and refuses to replace a Developer ID-signed app with an unsigned disk image.

Run it on a Mac:

```sh
export CSC_LINK="$HOME/path/to/developer-id.p12"
export CSC_KEY_PASSWORD="the-p12-password"
export APPLE_ID="your-apple-id"
export APPLE_APP_SPECIFIC_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="YOUR_TEAM_ID"
export VIBENOTE_UPDATE_FEED_URL="https://github.com/elliotxx/vibenote/releases/latest/download"
npm run release:mac:signed
```

`CSC_LINK` may be a `.p12` path or the base64 contents of that file. `CSC_NAME` can select a Developer ID Application identity already in the login keychain instead of `CSC_LINK`. Omit the `Developer ID Application:` prefix.

Notarization accepts one of:

- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`
- `APPLE_API_KEY` (path to the `.p8` key), `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER`
- `APPLE_KEYCHAIN_PROFILE`, with optional `APPLE_KEYCHAIN`

GitHub Actions reads those values from repository secrets. For a hosted runner, store the `.p8` contents in `APPLE_API_KEY_P8`; the workflow writes it to a temporary file and points `APPLE_API_KEY` at that file. Store the `.p12` in `CSC_LINK` as base64. Set `VIBENOTE_UPDATE_FEED_URL` to `disabled` to ship a signed build without auto-update. When that secret is empty and `CSC_LINK` or `CSC_NAME` is present, the workflow uses:

`https://github.com/elliotxx/vibenote/releases/latest/download`

That feed must serve `latest-mac.yml`, the zip, and the zip blockmap from the GitHub Release. The app embeds the feed only for signed builds. Unsigned builds do not check for updates. A packaged app can also set `VIBENOTE_UPDATE_FEED_URL`, or set `VIBENOTE_DISABLE_AUTO_UPDATE=1` to skip the check. Headless verification never checks.

`VIBENOTE_MAC_NOTARIZE=0` signs without notarization. Use that only to inspect a signature. The normal signed release fails closed when notarization credentials are missing.

Expected signed checks, on a Mac with the certificate:

```sh
npm run verify:package
cd dist && shasum -a 256 -c SHA256SUMS
codesign --verify --strict --verbose=2 dist/mac-arm64/Vibenote.app
xcrun stapler validate dist/mac-arm64/Vibenote.app
xcrun stapler validate dist/Vibenote-<version>-arm64.dmg
```

Auto-update downloads in the background and applies on quit. There is no update UI. Confirm it with two signed releases: install the older one, publish a newer tag, launch the older app, quit, and launch again.

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

- Unsigned builds are not notarized, and macOS Gatekeeper warns on first launch.
- Testers of an unsigned build must trust the source and explicitly allow launch.
- Signed distribution needs a Developer ID Application certificate, notarization credentials, and a Mac runner.
- The zip update archive is produced after the app is notarized and stapled. The DMG is notarized separately so the zip blockmap stays valid.
- The first release is intentionally macOS-only and arm64-only.
- Auto-update stays off when no feed URL is configured.

### Release Decision

Publish a version only when:

- The full verification suite passes.
- The headless packaged-app gates find no data-loss, launch, isolation, or visibility issues.
- `SHA256SUMS` has been generated.
- The tester warning and install instructions are included wherever the DMG is shared.
- The tag-driven GitHub Actions release workflow passes.

Do not call a build signed or notarized unless `dist/release-mode.json` records that result.
