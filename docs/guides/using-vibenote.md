# Using Vibenote

Vibenote opens directly into one continuous note stream. Write in the current block, create another block when the thought or language changes, and let autosave persist the stream locally.

Fold a long block from its first line number, the current-block toolbar, or `Command-Option-[`. The first line number turns into a disclosure control only while you interact with it; a folded block keeps the control visible and shows one compact source-derived summary row. Folding changes only the local view state, not the block source, and valid folds are restored when the note is reopened.

## Keyboard shortcuts

| Action | macOS shortcut |
| --- | --- |
| Show or hide app | `Cmd+Shift+Space` |
| Show or hide Settings | `Cmd+,` |
| Show or hide the keyboard shortcuts panel | `Cmd+/` |
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

## Data location

Vibenote stores its active internal notes in its own Electron `userData` directory:

```text
$HOME/Library/Application Support/Vibenote/notes/stream.txt
$HOME/Library/Application Support/Vibenote/notes/stream.assets/
$HOME/Library/Application Support/Vibenote/images/
```

`stream.assets/` is the default location for images saved beside the internal stream. If image storage is set to the application data directory, Vibenote uses `images/` instead. Older installations can also contain legacy images under `notes/.images/`.

These files are the source of truth. The optional [Git snapshot backup](git-auto-backup.md) exports a separate one-way copy and does not change where Vibenote edits notes.

Before troubleshooting, reinstalling, or manually changing app data, quit Vibenote and copy the entire application data directory to a safe location.

## Uninstall

Remove the application:

```sh
rm -rf "/Applications/Vibenote.app"
```

Removing the app does not remove its note data. Delete the application data only after confirming that the note stream and recovery files are no longer needed:

```sh
rm -rf "$HOME/Library/Application Support/Vibenote"
```
