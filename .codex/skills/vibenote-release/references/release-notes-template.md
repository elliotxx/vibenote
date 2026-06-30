# Vibenote Release Notes Template

Use this template for GitHub Release notes or tester-facing messages.

```md
## Vibenote v<version>

This is an unsigned macOS Apple Silicon release.

### Install

1. Download `Vibenote-<version>-arm64.dmg`.
2. Open the DMG and drag `Vibenote.app` to `Applications`.
3. On first launch, macOS may block the app because it is unsigned.
4. Open the Applications folder in Finder, right-click `Vibenote.app`, choose `Open`, then confirm the warning.
5. If it is still blocked, open System Settings, Privacy & Security, and allow Vibenote from the security warning.

Only install this build if you trust the source.

### Verify

Download `SHA256SUMS`, then run:

```sh
cd <download-folder>
shasum -a 256 -c SHA256SUMS
```

### Scope

- macOS arm64 only.
- One persistent note stream.
- Block-based plain text capture.
- Autosave and quit-time save.
- Local app data under `$HOME/Library/Application Support/Vibenote`.
- No Heynote data migration or access.

### Known Limits

- Unsigned and not notarized.
- macOS Gatekeeper warning on first launch.
- No auto-update channel.
- No auto-update channel.
```
