// Clickable task checkboxes in the reader: flip "- [ ]" <-> "- [x]" in the source.
import { scanFences } from '@/lib/markdown/repairs'

/** A task list item: optional indentation and blockquote/callout prefixes, a bullet
 *  (-, *, +) or number (1. / 1)), then the box. */
const TASK = /^([ \t]*(?:>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\](?=[ \t]|\r|$))/

/** `md` with the task on 0-based `line` set to `checked` ("- [ ]" ↔ "- [x]", also "*", "+",
 *  numbered "1." items and indented/nested items). Null when that line is not a task item
 *  (or is inside a fenced code block), so callers can ignore stale clicks. Keeps the line
 *  ending style and everything else on the line unchanged. */
export function toggleTaskAt(md: string, line: number, checked: boolean): string | null {
  if (!Number.isInteger(line) || line < 0) return null
  const lines = md.split('\n')
  const text = lines[line]
  if (text === undefined || !TASK.test(text)) return null
  if (scanFences(lines).inside[line]) return null
  const next = text.replace(TASK, `$1${checked ? 'x' : ' '}$3`)
  if (next === text) return md
  return [...lines.slice(0, line), next, ...lines.slice(line + 1)].join('\n')
}

/** 0-based lines of every task item in `md` (outside code fences), in order. */
export function taskLines(md: string): number[] {
  const lines = md.split('\n')
  const fenced = scanFences(lines).inside
  return lines.flatMap((text, i) => (!fenced[i] && TASK.test(text) ? [i] : []))
}
