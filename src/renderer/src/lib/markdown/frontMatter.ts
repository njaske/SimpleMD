import { escapeAttr, escapeHtml } from './escape'

// Leading YAML front matter (`---` … `---`), shown as a compact properties card
// instead of being rendered as an <hr> and a setext heading. A deliberately small,
// safe reader for the flat subset people actually write (scalars, quoted strings,
// flow and block lists, block scalars); no YAML library and nothing is evaluated.

export interface FrontMatterEntry {
  key: string
  value: string | string[]
}

export interface FrontMatter {
  entries: FrontMatterEntry[]
  /** Line index just after the closing fence (the lines [0, endLine) are front matter). */
  endLine: number
}

const MAX_LINES = 400
const MAX_ENTRIES = 60
const MAX_TEXT = 280
const MAX_TITLE = 1000

const OPEN = /^---[ \t]*$/
const CLOSE = /^(?:---|\.\.\.)[ \t]*$/
const KEY_LINE = /^([^\s#:-][^:]*?|-[^\s:][^:]*?)[ \t]*:(?:[ \t]+(.*))?$/
const LIST_ITEM = /^[ \t]*-(?:[ \t]+(.*))?$/

/** The front matter at the very start of `lines`, or null when there is none (or the
 *  block between the fences doesn't look like YAML, e.g. two horizontal rules). */
export function extractFrontMatter(lines: readonly string[]): FrontMatter | null {
  if (!lines.length || !OPEN.test(lines[0])) return null
  const limit = Math.min(lines.length, MAX_LINES)
  let close = -1
  for (let i = 1; i < limit; i++) {
    if (CLOSE.test(lines[i])) {
      close = i
      break
    }
  }
  if (close < 0) return null
  const body = lines.slice(1, close)
  if (!looksLikeYaml(body)) return null
  return { entries: parseEntries(body), endLine: close + 1 }
}

function isSkippable(line: string): boolean {
  return !line.trim() || /^[ \t]*#/.test(line)
}

function looksLikeYaml(body: readonly string[]): boolean {
  const meaningful = body.filter((line) => !isSkippable(line))
  if (!meaningful.length) return true
  if (!KEY_LINE.test(meaningful[0])) return false
  return meaningful.every((line) => KEY_LINE.test(line) || /^[ \t]+\S/.test(line) || LIST_ITEM.test(line))
}

function parseEntries(body: readonly string[]): FrontMatterEntry[] {
  const entries: FrontMatterEntry[] = []
  let i = 0
  while (i < body.length && entries.length < MAX_ENTRIES) {
    const m = isSkippable(body[i]) ? null : KEY_LINE.exec(body[i])
    i++
    if (!m) continue
    const nested: string[] = []
    while (i < body.length && (isSkippable(body[i]) || /^[ \t]/.test(body[i]) || /^-(?:\s|$)/.test(body[i]))) {
      if (!isSkippable(body[i])) nested.push(body[i])
      i++
    }
    entries.push({ key: unquote(m[1].trim()), value: parseValue((m[2] ?? '').trim(), nested) })
  }
  return entries
}

function parseValue(inline: string, nested: readonly string[]): string | string[] {
  if (/^[|>][+-]?$/.test(inline)) {
    const lines = nested.map((line) => line.trim())
    return inline.startsWith('|') ? lines.join('\n') : lines.join(' ')
  }
  if (inline) return parseInlineValue(inline)
  if (nested.length && nested.every((line) => LIST_ITEM.test(line))) {
    return nested.map((line) => unquote(stripComment((LIST_ITEM.exec(line)?.[1] ?? '').trim())))
  }
  // A nested map or anything fancier: show it flattened rather than guessing.
  return nested.map((line) => line.trim()).join(', ')
}

function parseInlineValue(value: string): string | string[] {
  if (value.startsWith('[') && value.endsWith(']')) {
    return splitFlow(value.slice(1, -1))
      .map((item) => unquote(item.trim()))
      .filter((item) => item !== '')
  }
  if (/^["']/.test(value)) return unquote(value)
  return stripComment(value)
}

/** Split a flow sequence on commas that are not inside quotes. */
function splitFlow(text: string): string[] {
  const out: string[] = []
  let quote = ''
  let current = ''
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = ''
      current += ch
    } else if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
    } else if (ch === ',') {
      out.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  out.push(current)
  return out
}

function stripComment(value: string): string {
  return value.replace(/[ \t]+#.*$/, '').trim()
}

function unquote(value: string): string {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(value)
  if (m) return m[1].replace(/\\(["\\])/g, '$1').replace(/\\n/g, '\n')
  const s = /^'((?:[^']|'')*)'$/.exec(value)
  if (s) return s[1].replace(/''/g, "'")
  return value
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

function renderValue(value: string | string[]): string {
  if (Array.isArray(value)) {
    if (!value.length) return '<dd class="smd-fm-value smd-fm-empty">None</dd>'
    const chips = value.map((item) => `<span class="smd-fm-chip">${escapeHtml(clip(item, 80))}</span>`)
    return `<dd class="smd-fm-value smd-fm-chips" title="${escapeAttr(clip(value.join(', '), MAX_TITLE))}">${chips.join('')}</dd>`
  }
  if (!value) return '<dd class="smd-fm-value smd-fm-empty">—</dd>'
  return `<dd class="smd-fm-value" title="${escapeAttr(clip(value, MAX_TITLE))}">${escapeHtml(clip(value, MAX_TEXT))}</dd>`
}

/** The properties card. Empty front matter renders nothing. */
export function renderFrontMatter(fm: FrontMatter, lineOffset: number): string {
  if (!fm.entries.length) return ''
  const rows = fm.entries.map(
    (e) => `<div class="smd-fm-row"><dt class="smd-fm-key">${escapeHtml(clip(e.key, 60))}</dt>${renderValue(e.value)}</div>`
  )
  return (
    `<div class="smd-frontmatter" data-line="${lineOffset}" data-line-end="${lineOffset + fm.endLine}" ` +
    `role="group" aria-label="Document properties"><dl class="smd-fm-list">${rows.join('')}</dl></div>\n`
  )
}
