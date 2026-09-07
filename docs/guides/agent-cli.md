# Agent CLI

The Agent CLI alpha exposes machine-readable note capabilities without giving agents unrestricted file access. It can discover commands, list and read internal notes, search blocks, and safely append or update one block.

## Install

Move `Vibenote.app` to `/Applications` or `~/Applications`. Open Settings, select Agent CLI, then choose Install Agent CLI.

Vibenote installs a managed launcher at `~/.local/bin/vibenote` and uses the runtime bundled with the app. It does not require system Node.js, edit shell configuration, or overwrite an unowned command. If `~/.local/bin` is missing from the login shell's `PATH`, Settings reports the prerequisite; update `PATH` and open a new terminal before retrying.

## Discover commands

Start with the built-in version and capability output:

```sh
vibenote version
vibenote capabilities
```

Command output is structured for agents. Use the capability response as the command contract instead of guessing subcommands or options.

## Run from source

Developers can run the CLI against an explicit isolated data directory:

```sh
node cli/vibenote.mjs capabilities --data-dir /path/to/isolated-user-data --output json
node cli/vibenote.mjs search --data-dir /path/to/isolated-user-data --query "keyword" --limit 10 --output json
```

## Mutation safeguards

`blocks append` requires an explicit `--data-dir`, an idempotency key, and either a dry-run revision or `--accept-current`. Writes use optimistic revision checks, snapshots, recovery files, and atomic replacement.

The alpha does not expose external files, note-wide replacement, delete, restore, arbitrary paths, HTTP, or MCP. Use an isolated or backed-up data directory while testing mutation commands.

## Update an existing block

`blocks update` replaces the complete body of one block, preserving its stable ID, position, language, auto-detection setting, creation time, and other delimiter fields. It never appends a new block. Empty content clears the body without deleting the block.

Read the latest block first and use the returned note-level `revision`. Ensure the response is not truncated (the maximum read size is 262144 bytes). Update requires a stable `--block` ID; legacy indexes are read-only. A real update always requires `--expected-revision`; `--accept-current` and language changes are not supported.

```sh
vibenote blocks read --note internal:stream --block <block-id> --max-bytes 262144 --output json

vibenote blocks update --data-dir /path/to/user-data \
  --note internal:stream --block <block-id> --content-stdin \
  --idempotency-key edit-example-1 --expected-revision <revision> \
  --dry-run --output json < updated-block.md

# Apply the same payload with the revision returned by the dry run.
vibenote blocks update --data-dir /path/to/user-data \
  --note internal:stream --block <block-id> --content-stdin \
  --idempotency-key edit-example-1 --expected-revision <revision> \
  --output json < updated-block.md
```

A dry run without `--expected-revision` can propose an update against the current note; a supplied revision is still checked. Dry runs do not save snapshots, recovery files, or receipts. Content is limited to 256 KiB and cannot contain a line starting with `---block:`.

Successful writes share the desktop note lock, create a pre-update snapshot and recovery candidate, and replace the note atomically. Only the selected block changes. Clean desktop editors reload the update; stale desktop saves are rejected and their unsaved text is preserved in recovery.

Update idempotency keys are scoped to the note and update command. Hashed receipts are retained in the block's `updates` delimiter field, so retries survive CLI restarts and later updates. Reusing a key with different content or a different block fails with `IDEMPOTENCY_MISMATCH`. Replaying a successful update reports `replayed: true` with the current revision and does not overwrite later edits; it does not assert that the current body still equals the original payload. Receipts last as long as the block and its delimiter metadata are retained.

On `REVISION_CONFLICT` (exit 4), read the latest content and reconcile edits before proposing a new update. Do not replace the expected revision blindly. Missing blocks return exit 3; invalid arguments return exit 2.

## Verify the CLI

```sh
npm run verify:cli
npm run verify:cli-coordination
npm run verify:agent-cli-install
```

The checks use synthetic temporary data and do not need access to a real note stream.
