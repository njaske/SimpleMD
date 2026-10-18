// CONTRACT STUB (lane R implements). Clickable task checkboxes in the reader.

/** `md` with the task on 0-based `line` set to `checked` ("- [ ]" ↔ "- [x]", also "*", "+",
 *  numbered "1." items and indented/nested items). Null when that line is not a task item
 *  (or is inside a fenced code block), so callers can ignore stale clicks. Keeps the line
 *  ending style and everything else on the line unchanged. */
export function toggleTaskAt(md: string, line: number, checked: boolean): string | null {
  const lines = md.split('\n')
  const text = lines[line]
  if (text === undefined) return null
  const next = text.replace(/^(\s*(?:[-*+]|\d+[.)])\s+\[)[ xX](\])/, `$1${checked ? 'x' : ' '}$2`)
  if (next === text && !/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/.test(text)) return null
  lines[line] = next
  return lines.join('\n')
}
