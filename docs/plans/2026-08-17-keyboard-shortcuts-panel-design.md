# Keyboard shortcuts panel

## Goal

Make Vibenote shortcuts discoverable without interrupting writing or introducing shortcut customization and conflict management.

## Interaction

- Open the read-only panel from the keyboard icon in the status bar, the Help menu, or `Cmd+/`.
- Close it with `Cmd+/`, `Esc`, the close button, or the backdrop.
- Keep the shortcuts panel and Settings mutually exclusive.
- Focus search when the panel opens and restore editor focus when it closes.
- Preserve note content and the current editing session throughout the interaction.

## Content

Group commands into Application, Block, Editing, Search, and View sections. Each row contains a user-facing action and its macOS shortcut. Search filters by group, action, or displayed key combination. The first version is read-only and does not persist settings.

## Architecture

`ShortcutPanel.vue` renders and filters the catalog. `shortcuts.ts` is the renderer-facing source for labels and displayed key combinations. `App.vue` owns modal state, while `EditorPane.vue` forwards status-bar and keyboard commands. Electron exposes the same toggle through the Help menu and packaged-app input routing.

## Verification

End-to-end coverage confirms status-bar and keyboard entry, modal mutual exclusion, `Esc` closure, categorized search, narrow-window layout, focus restoration, and unchanged note content. Production build and packaged-app checks cover the Electron command path.
