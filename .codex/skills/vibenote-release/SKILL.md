---
name: vibenote-release
description: Run the Vibenote macOS tag-driven release workflow. Use when the user asks to prepare, verify, tag, package, publish, or explain a Vibenote release, DMG distribution, SHA256SUMS, GitHub Actions release, GitHub Release, or tester install instructions for github.com/elliotxx/vibenote.
---

# Vibenote Release

## Scope

Use this skill only from the Vibenote repository root.

The current release mode is **tag-driven macOS release distribution**:

- macOS arm64 only.
- Unsigned and not notarized.
- DMG is the primary tester artifact.
- `SHA256SUMS` must accompany shared builds.
- A pushed `v<version>` tag creates a formal GitHub Release through GitHub Actions.
- Do not describe this build as signed, notarized, or Gatekeeper-clean.

If the user asks for a signed release, notarized release, auto-update release, Homebrew Cask, or broad distribution, stop and explain that Developer ID signing, hardened runtime, notarization, and stapling are required first.

## Useful Resources

- Run `scripts/release_facts.sh` from this skill folder to collect current branch, version, tag, artifact, checksum, and GitHub CLI state. The script infers the repository root from the project-level skill path unless a repo path argument is provided.
- Read `references/release-notes-template.md` when drafting GitHub Release notes or tester-facing copy.
- Read `.github/workflows/release.yml` before changing the automated release flow.

Resolve resource paths relative to this skill folder.

## Release Workflow

1. **Preflight the repository**
   - Start from the Vibenote repository root.
   - Run `git status --short --branch`.
   - Require `main` to be clean and synced to `origin/main` before tagging or publishing.
   - Do not force push, amend pushed commits, or change global git config.
   - If there are uncommitted changes, decide whether they belong to the release. For code/doc edits, use the user's git rules and `gitacp` before releasing.

2. **Confirm version and tag**
   - Read `package.json` version.
   - Expected tag is `v<version>`, for example `v0.1.0`.
   - If the tag already exists locally or remotely, do not recreate or move it. Ask whether this is a re-upload, patch release, or new version.

3. **Verify release artifacts locally before tagging**
   - Run:
     ```sh
     npm run release:mac
     ```
   - Expected artifacts:
     - `dist/Vibenote-<version>-arm64.dmg`
     - `dist/SHA256SUMS`

   - Run:
     ```sh
     cd dist && shasum -a 256 -c SHA256SUMS
     ```
   - Run the full local verification suite unless the user explicitly asks for a faster dry run:
     ```sh
     npm run verify:runtime
     npm run verify:stability
     npm run verify:edges
     npm run verify:install
     ```
   - Stop on any failure. Do not tag a failed build.

5. **Manual dogfood gate**
   - Verify the DMG installs into the macOS Applications folder.
   - Launch the app.
   - Enter test content, quit, relaunch, and confirm persistence.
   - Confirm data remains under:
     ```sh
     $HOME/Library/Application Support/Vibenote/notes/stream.txt
     ```
   - Confirm the app does not read, migrate, or modify Heynote data.

6. **Publish by pushing the version tag**
   - Create and push the tag only after local build and validation pass:
     ```sh
     git tag v<version>
     git push origin v<version>
     ```
   - If the user asks for an annotated tag, use:
     ```sh
     git tag -a v<version> -m "Vibenote v<version>"
     ```

7. **Watch the GitHub Actions release run**
   - The tag push triggers `.github/workflows/release.yml`.
   - The workflow validates the tag against `package.json`, runs `npm ci`, builds the DMG, verifies `SHA256SUMS`, and creates a formal GitHub Release.
   - Do not manually upload assets unless the workflow fails and the user explicitly chooses manual recovery.

## Stop Conditions

Stop before tagging or publishing if any of these are true:

- Working tree has uncommitted release-relevant changes.
- Local `main` is not synced with `origin/main`.
- Version and tag do not match.
- Tag already exists and the user has not chosen a re-release/new-version path.
- `npm run release:mac` fails locally or in GitHub Actions.
- Any required verification fails.
- `SHA256SUMS` is missing or does not validate.
- Manual dogfood finds launch, edit, save, quit, relaunch, or persistence issues.

## Final Response Requirements

Report:

- Version and tag.
- Commit hash used for the build.
- Artifact paths.
- SHA256 value for the DMG, or the `SHA256SUMS` path.
- Verification commands run and result.
- Whether the tag was pushed.
- Whether the GitHub Actions release workflow passed.
- Whether the GitHub Release was created.
- Explicitly state that this is an unsigned, not-notarized macOS build.
