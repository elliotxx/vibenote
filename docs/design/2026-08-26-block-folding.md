# Block Folding

Implementation plan: [Block Folding Implementation Plan](../plans/2026-08-26-block-folding-implementation-plan.md)

## Background and goal

Long note streams need a way to reduce reading density without turning Vibenote into an outline or card-based knowledge tool. Folding must preserve the continuous writing surface, plain-text source, block-relative line numbers, and current editor width.

## Interaction design

- Folding reuses the first line-number cell; it does not add a gutter column or move the content start position.
- An expanded block normally shows line number `1`. Hovering or focusing its first line-number control reveals a downward disclosure chevron in the same cell.
- A collapsed block always shows a right disclosure chevron in that cell and replaces its source with one compact summary row.
- The summary uses the first meaningful source line, followed by muted language and line-count metadata. It is deterministic and never AI-generated.
- Clicking the summary or disclosure control expands the block and restores its remembered cursor offset when available.
- The current-block toolbar and a keyboard command provide secondary, accessible entry points.

## Editor and storage model

CodeMirror keeps the source document unchanged. A state field maps folded block content anchors through edits. A block replacement widget renders the summary, while a line-number marker replaces only the first block-relative number.

Folding and Markdown preview are mutually exclusive presentation modes. Entering one mode clears the other for the same block. Ordinary edits that touch hidden source are rejected; internal annotated operations may unfold first and continue explicitly.

Persisted folds use `metadata.foldedRanges` as content ranges. Save writes the current resolved block boundaries. Load restores only ranges that still match an exact block content boundary; stale ranges fail open as expanded.

## Acceptance criteria

- No extra gutter column appears and the text start position is identical before and after folding.
- Expanded blocks display ordinary line numbers until their first-line control is hovered or focused.
- Collapsed blocks show a single summary row and a persistent right chevron in the existing line-number cell.
- Folding never changes source content, copy output, undo history, or content revision.
- Reload restores valid folded ranges and ignores invalid ranges safely.
- Markdown preview and folding never render simultaneously for one block.
- Search navigation to hidden content expands the matching block.
- Keyboard, pointer, light/dark theme, narrow viewport, and reduced-motion states remain usable.

## Risks and boundaries

- Version one supports flat block folding only; Markdown heading hierarchy and nested folding are out of scope.
- Global fold-all commands and AI summaries are out of scope.
- Fold restoration relies on exact content ranges because block IDs are optional.
- Synthetic notes may be used for automated and visual verification; real user notes and screenshots are prohibited.

## Self-review

The first review removed a separate fold gutter, card styling, nested hierarchy, and batch commands because they add organization weight without proving the core interaction. The second review tightened persistence to exact block boundaries, made preview/fold exclusivity explicit, and named source preservation, search reveal, cursor restoration, and unchanged horizontal layout as observable acceptance evidence.
