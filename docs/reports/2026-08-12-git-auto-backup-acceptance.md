# Git Auto Backup Acceptance Report

## Result

The local implementation and automated acceptance gates passed. Active notes remain in the application data directory as the only source of truth. Git receives a one-way, verified export and never becomes an active storage or import source.

Real hosted-remote authentication and final subjective visual approval remain external confirmations. They do not block the isolated local and bare-remote acceptance described here.

## Verified behavior

| Area | Evidence | Result |
| --- | --- | --- |
| Export integrity | Synthetic internal notes, beside-file images, app-data images, manifest hashes, relocation, missing images, unsafe image paths, mirror conflict, and interrupted switching | Passed |
| Source isolation | Source tree hashes remain unchanged by successful and failed export; external documents and recovery data are excluded | Passed |
| Git safety | Argument-array commands, managed pathspec commit, automatic trailer, unrelated staged content preservation, identity failure, no-remote local commit, safe bare-remote push, offline retry, ambiguous remote, and manual commits | Passed |
| Scheduling and quit | Five-minute production interval, single-flight pending run, renderer synchronous flush, local-only quit commit, child cancellation, and fixed total quit budget | Passed |
| Renderer contract | Narrow preload API, typed settings/status, development mock parity, persisted state, safe error text, and unchanged note-save behavior after Git failures | Passed |
| Settings UI | Repository choice, enable switch, persistent state, normal-width layout, and 420-pixel narrow layout | Passed |
| Packaged app | Production preload/IPC, initial snapshot commit, isolated bare-remote push, autosave, quit snapshot, local-only quit commit, and manifest privacy | Passed |

## Commands executed

The following completed successfully on the candidate worktree:

```sh
npm run verify:git-backup-export
npm run verify:git-backup-module
npm run test:e2e
npm run build
npm run build:mac
npm run verify:package
npm run verify:runtime
npm run verify:git-backup
npm run verify:data-safety
npm run verify:stability
npm run verify:ai-runtime
npm run verify:edges
npm run test:public-safety
npm run verify:public-safety
git diff --check
```

The E2E suite completed with 75 passing tests. Visual comparisons cover the settings page before and after the change at normal and narrow widths using synthetic, redacted state.

## Recovery boundary

The repository contains `.vibenote-backup.json` and `vibenote-backup/`. The manifest records hashes for exported documents and assets. Recovery is intentionally manual: verify the manifest, then copy required exported files to a separate safe location. The application provides no reverse import, restore screen, or history browser.

## External confirmation

- Confirm authentication and push behavior against at least one real hosted remote without sharing credentials or private repository details.
- Review the attached normal-width and narrow-width comparisons for final subjective visual acceptance.
