# Priority Line Emphasis

## Goal

Help readers scan priority across a note without turning the editor into a high-saturation status board.

## Interaction

- Add an editor setting named “优先级行强调”. It is disabled by default and persists locally.
- When enabled, valid P0–P3 markers emphasize their logical lines without modifying note content.
- If a line contains multiple markers, the highest urgency wins: P0, P1, P2, then P3.
- Existing marker colors remain visible regardless of the setting.

## Visual hierarchy

- P0 uses a clearly visible red wash.
- P1 uses an amber wash.
- P2 uses a muted blue wash.
- P3 uses a light neutral wash.
- Adjacent levels must remain distinguishable by rendered row color alone.
- The active-line background takes precedence over the priority wash.
- Priority washes take precedence over alternating block backgrounds.
- Dark mode uses higher-lightness colors and slightly stronger washes for equivalent perceived contrast.

## Content rules

Line emphasis reuses the priority-marker exclusions: lowercase and partial tokens, code, links, images, autolinks, and non-text code blocks do not affect line importance.
