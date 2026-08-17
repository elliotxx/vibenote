# Responsible-person mention highlighting

## Goal

Make responsible-person markers such as `@example-owner` and `@example_owner` easy to scan without turning plain-text notes into a user directory or task-assignment system.

## Interaction and appearance

Mentions use low-saturation blue-violet text with a medium font weight. They have no background, border, underline, radius, or extra spacing, so repeated owners remain scannable without becoming button-like labels or competing with the active line, selections, and search results.

Highlighting is a CodeMirror decoration only. The stored note content remains unchanged, and mentions have no click action or resolved user identity.

## Recognition rules

- Apply only to Markdown and plain-text blocks.
- Support Unicode letters and digits plus `_` and internal `-`, with a maximum name length of 32 characters.
- Require a safe boundary before `@` so email addresses and URL paths are not treated as mentions.
- Exclude escaped mentions, fenced code, inline code, Markdown links, and Markdown images.
- Do not highlight JavaScript, TypeScript, Python, SQL, or other code-language blocks.

## Verification

An end-to-end test must confirm that valid Chinese, Latin, hyphenated, underscored, and plain-text mentions receive the mention decoration while email, URL, code, link, image, escaped, and code-language examples do not. The test must also confirm that the underlying note content is unchanged.
