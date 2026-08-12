export function fixedStringMatches(text, query) {
  const haystack = text.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  if (!needle) return []
  const matches = []
  let from = 0
  while (from <= haystack.length) {
    const index = haystack.indexOf(needle, from)
    if (index === -1) break
    matches.push(index)
    from = index + Math.max(needle.length, 1)
  }
  return matches
}

export function snippetAround(text, index, length, maxCharacters) {
  const radius = Math.max(0, Math.floor((maxCharacters - length) / 2))
  const start = Math.max(0, index - radius)
  const end = Math.min(text.length, index + length + radius)
  return text.slice(start, end)
}
