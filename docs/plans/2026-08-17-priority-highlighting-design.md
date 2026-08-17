# Priority highlighting

## Goal

Make task urgency easier to scan in long notes while keeping priority markers visually quieter than selections, search results, and active-line feedback.

## Recognition

- Recognize only standalone uppercase `P0`, `P1`, `P2`, and `P3` markers.
- Apply only to Markdown and plain-text blocks.
- Do not match lowercase markers, unsupported levels, or partial tokens such as `P01`, `XP0`, and `P0Task`.
- Exclude inline code, fenced code, Markdown links, images, autolinks, and code-language blocks.

## Appearance

Use text color and a semibold weight without backgrounds, borders, underlines, radius, or extra spacing. P0 uses muted red, P1 muted orange, P2 muted blue, and P3 neutral gray. Dark mode uses lighter variants with the same semantic ordering. The visible marker text remains the primary indicator, so meaning does not depend on color alone.

## Data boundary

Priority highlighting is a CodeMirror decoration only. It does not modify stored note content, create task metadata, or change priority semantics outside the editor.

## Verification

End-to-end coverage confirms exact uppercase matches, all four distinct colors, transparent backgrounds, strict token boundaries, Markdown exclusion zones, code-block exclusion, plain-text support, and unchanged persisted content.
