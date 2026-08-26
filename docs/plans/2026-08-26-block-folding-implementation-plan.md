# Block Folding Implementation Plan

Design: [Block Folding](../design/2026-08-26-block-folding.md)

## Scope

Implement flat, persistent Block folding using the existing line-number gutter, CodeMirror state/decorations, note metadata, Vue editor surface, CSS tokens, Lucide-style disclosure geometry, and synthetic Playwright fixtures.

## Stage 1: presentation state and source safety

1. Add mapped folded-block state and exact-range restoration.
2. Add a deterministic summary builder and collapsed block replacement widget.
3. Protect hidden source from ordinary edits.
4. Make Markdown preview and folding mutually exclusive.

Verification: focused E2E proves source bytes are unchanged, folded content is not editable, duplicate historical timestamps are independent, and preview/fold transitions leave only one presentation.

## Stage 2: low-disturbance interaction

1. Provide a marker inside the existing line-number gutter rather than a new gutter.
2. Show number `1` normally, reveal the downward chevron on hover/focus, and keep the right chevron visible when folded.
3. Add summary-row, toolbar, and keyboard toggles.
4. Restore the block cursor and keep the block top visually anchored.

Verification: Playwright compares gutter count and content-left coordinates before and after folding, then exercises pointer and keyboard toggles.

## Stage 3: persistence and workflow integration

1. Synchronize resolved folds into `metadata.foldedRanges` before save and snapshots.
2. Restore only exact ranges on mount and external reload.
3. Expand a folded block before selecting a search match.
4. Ensure deletion, split, language changes, formatting, Block navigation, and copy use source semantics.

Verification: reload persistence, stale-range fallback, search reveal, block deletion, and source clipboard cases pass with synthetic notes.

## Stage 4: acceptance closure

Run the focused folding suite, related Markdown preview suite, full E2E suite where practical, production build, `git diff --check`, and `npm run verify:public-safety`. Capture a runtime screenshot only from an isolated synthetic buffer. Treat automated layout assertions as implementation proof and keep final visual taste acceptance separate for user review.

## Rollback

Removing the folding extensions and UI entry points restores the existing editor. Persisted `foldedRanges` are already classified as UI metadata and are safely ignored by older code; no source migration or destructive rollback is required.

## Self-review

The first review ordered work by dependency: state safety before visual controls, then persistence and integration. The second review replaced vague validation with exact observable checks, kept real user data out of evidence, and separated automated correctness from human visual approval.
