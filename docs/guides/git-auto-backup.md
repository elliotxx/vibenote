# Git snapshot backup

Git backup is a second copy of your internal notes, not their working location. Vibenote continues to read and write its own application data; the selected Git repository receives verified snapshots in one direction only.

## Set up backup

1. Open Settings and find Git backup.
2. Select a dedicated Git repository. Vibenote can initialize an empty directory; a non-empty directory must already be a Git repository.
3. Configure the repository's Git author identity if needed.
4. Enable Git backup and check the status shown in Settings.

A dedicated repository is recommended. You can reuse an existing repository, but Vibenote's automatic commits will be added to its current branch and may be pushed with that branch.

## Where data is stored

Normal edits are written directly to the active note files:

```text
$HOME/Library/Application Support/Vibenote/notes/
```

The Git repository contains only the ownership marker and exported snapshot:

```text
<selected-repository>/
├── .vibenote-backup.json
└── vibenote-backup/
    ├── manifest.json
    ├── notes/
    └── assets/
```

The complete flow is:

```text
Editor/autosave
  -> active note files
  -> verified staging snapshot
  -> vibenote-backup/
  -> local Git commit
  -> safe push, when an eligible remote exists
```

Vibenote never reads the repository snapshot back into the editor. Moving, deleting, or disabling the repository does not change the active note location.

## When backup runs

- Selecting a repository prepares an initial verified snapshot.
- Enabling backup runs a backup immediately.
- While the app is open, Vibenote checks for changes every five minutes and skips the commit when nothing changed.
- On quit, Vibenote flushes pending note saves and attempts a local backup commit within a short deadline. It does not perform a network push during quit.
- On the next launch, a safe pending push can be retried.

## Reuse an existing repository

Vibenote stages and commits only `.vibenote-backup.json` and `vibenote-backup/`. Unrelated tracked and staged files are not included in its automatic commit.

This path restriction does not isolate branch history. An automatic commit is still a normal commit on the current branch, and pushing that branch sends every commit that is ahead of the remote. Vibenote therefore pushes only when it can prove that the pending range contains Vibenote backup commits. If that cannot be established, it keeps the local commit and requests manual attention.

Vibenote does not create or switch branches, configure remotes or credentials, or run pull, fetch, merge, rebase, reset, checkout, or clean. Do not manually edit the managed snapshot. If its hashes no longer match the manifest, backup pauses with `mirror-conflict` instead of overwriting or importing the changes.

## Remote behavior

- No remote: the backup succeeds as a local commit.
- One eligible remote with a safe upstream baseline: Vibenote pushes automatically.
- Multiple remotes, no safe baseline, unrelated unpushed commits, conflicts, or missing credentials: the local snapshot is preserved and Settings reports the action required.

Vibenote never stores Git credentials. Authentication is handled by your existing Git setup.

## What is excluded

The snapshot includes internal text notes and Vibenote-managed images referenced by them. It excludes external documents, API keys, app settings, recovery files, local backup history, external-file registrations, and runtime state.

## Recover files manually

Vibenote does not provide automatic import or restore. To recover content:

1. Work from a copy or clone of the backup repository.
2. Inspect `vibenote-backup/manifest.json` and verify the listed hashes if integrity matters.
3. Copy the required files from `vibenote-backup/notes/` or `vibenote-backup/assets/` to a separate safe location.
4. Review the recovered content before replacing any active Vibenote data.

For implementation details and the complete safety model, see the [Git auto-backup design](../design/2026-08-11-git-auto-backup.md).
