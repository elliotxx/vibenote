# Markdown Block Session Preview Implementation Plan

Design: [Markdown Block Session Preview](../design/2026-08-25-markdown-block-session-preview.md)

## Phase 1: switch, identity, and protection

1. Add Markdown rendering dependencies.
2. Store session-only content anchors in CodeMirror state and map them through edits.
3. Add the Markdown-only Eye/EyeOff toolbar action and block replacement widget, including empty blocks.
4. Reject complete ordinary transactions that touch rendered content while allowing annotated internal edits.
5. Suppress overlapping source decorations and automatic language detection.
6. Prove source/preview round trips, unchanged buffers, reload reset, read-only behavior, duplicate `created` values, and cleanup after language changes or deletion.

Phase 1 must pass before media or interactive behavior is added because later edits rely on stable block identity.

## Phase 2: tasks, media, and clipboard exception

1. Render with raw HTML and automatic linkification disabled; enable tables.
2. Generate indexed task inputs and write checkbox changes back to Markdown source.
3. Share image URL normalization with the existing image widget.
4. Route only HTTP(S) preview links to the external-shell bridge on a single click.
5. Preserve Markdown source for editor copy/cut and return visible text only for a selection wholly inside one preview.
6. Prove task updates, source copy, visible-text copy, links, tables, and images with synthetic fixtures.

## Phase 3: exit, documentation, and regression

1. Preserve the current block's logical cursor or selection while toggling preview; align previews with a visible block start or the viewport edge when the start is off-screen; on double-click, transfer focus only when the clicked preview is not the selected block.
2. Style the preview exclusively with existing design tokens.
3. Update the Markdown conventions and design documentation.
4. Run the focused preview suite, the complete end-to-end suite, the production build, and repository public-safety checks.

## Self-review

The first review made cursor preservation an observable interaction requirement rather than an implementation detail. The second review split same-block preservation from cross-block focus transfer. The third review added deterministic regressions for a visible block start with zero blank offset and an off-screen start anchored to the viewport edge.
