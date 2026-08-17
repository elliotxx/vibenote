# Agent CLI

The Agent CLI alpha exposes machine-readable note capabilities without giving agents unrestricted file access. It can discover commands, list and read internal notes, search blocks, and safely append one block.

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

The alpha does not expose external files, replace, delete, restore, arbitrary paths, HTTP, or MCP. Use an isolated or backed-up data directory while testing mutation commands.

## Verify the CLI

```sh
npm run verify:cli
npm run verify:cli-coordination
npm run verify:agent-cli-install
```

The checks use synthetic temporary data and do not need access to a real note stream.
