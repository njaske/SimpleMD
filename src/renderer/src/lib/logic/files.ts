// Pure helpers about files and names: validation, agent files, titles, default names,
// and cleaning up Markdown pasted from chat apps.
import type { Platform } from '@shared/types'

const MD_EXT = /\.(md|markdown|mdown|mkd|mdx|markdn)$/i

/** True for a Markdown file name (by extension, case-insensitive). */
export function isMarkdownName(name: string): boolean {
  return MD_EXT.test(name)
}

/** `name` with ".md" appended unless it already has a Markdown extension. */
export function ensureMdExtension(name: string): string {
  return isMarkdownName(name) ? name : `${name}.md`
}

const MAX_NAME_LENGTH = 255
/** Characters Windows forbids in names; refused everywhere because files travel. */
const FORBIDDEN_CHARS = /[<>:"|?*]/
const CONTROL_CHARS = /[\x00-\x1f\x7f]/
/** Device names Windows reserves, with or without an extension ("con.md", "COM1.txt"). */
const RESERVED_STEM = /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])$/i

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Why `name` can't be used as a file or folder name on `platform`, or null when it's fine.
 *  Rejects empty/whitespace-only names, "." and "..", path separators, characters Windows
 *  forbids (< > : " | ? * and control chars) on every platform (files travel between OSes),
 *  Windows reserved device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9, with or without an
 *  extension), names ending in a dot or space, and names longer than 255 characters (or
 *  255 UTF-8 bytes, the Linux limit). Messages are short, friendly sentences
 *  ("A name can't contain /"). */
export function validateFileName(name: string, platform: Platform): string | null {
  if (!name.trim()) return 'Enter a name'
  if (name === '.' || name === '..') return 'A name can\'t be just "." or ".."'
  if (name.includes('/')) return "A name can't contain /"
  if (name.includes('\\')) return "A name can't contain \\"
  const forbidden = FORBIDDEN_CHARS.exec(name)
  if (forbidden) return `A name can't contain ${forbidden[0]}`
  if (CONTROL_CHARS.test(name)) return "A name can't contain control characters"
  if (name.endsWith('.')) return "A name can't end with a dot"
  if (/\s$/.test(name)) return "A name can't end with a space"
  const stem = name.split('.')[0].trimEnd()
  if (RESERVED_STEM.test(stem)) {
    return platform === 'win32'
      ? `"${stem}" is reserved by Windows. Try another name`
      : `"${stem}" can't be used because Windows reserves it. Try another name`
  }
  if ([...name].length > MAX_NAME_LENGTH || byteLength(name) > MAX_NAME_LENGTH) {
    return 'That name is too long. Try a shorter one'
  }
  return null
}

const AGENT_FILE_NAMES = /^(agents?|agents\.override|claude|claude\.local|gemini|conventions|copilot-instructions)\.md$/i
/** Cursor rules (*.mdc), Copilot path rules (*.instructions.md) and dot-file rule sets. */
const AGENT_FILE_PATTERNS = /(\.mdc|\.instructions\.md)$|^\.(cursorrules|windsurfrules|clinerules)$/i

/** True for files coding agents read as instructions: AGENTS.md, AGENT.md, CLAUDE.md,
 *  GEMINI.md, copilot-instructions.md, .cursorrules-style "*.mdc" rules, CONVENTIONS.md
 *  (case-insensitive on the base name). Also CLAUDE.local.md, AGENTS.override.md,
 *  Copilot "*.instructions.md" and .cursorrules / .windsurfrules / .clinerules. A full
 *  path is accepted; only its base name counts. */
export function isAgentInstructionFile(fileName: string): boolean {
  const base = fileName.split(/[\\/]/).pop() ?? ''
  return AGENT_FILE_NAMES.test(base) || AGENT_FILE_PATTERNS.test(base)
}

/** Paths present in `after` but not in `before` (in `after` order). */
export function addedPaths(before: Iterable<string>, after: Iterable<string>): string[] {
  const seen = new Set(before)
  return [...after].filter((p) => !seen.has(p))
}

// ---------------------------------------------------------------------------------------
// Titles

const FRONT_MATTER = /^(?:---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)|\+\+\+[ \t]*\n([\s\S]*?)\n\+\+\+)[ \t]*(?:\n|$)/
const FRONT_TITLE = /^title[ \t]*[:=][ \t]*(.+?)[ \t]*$/im
const FENCE_OPEN = /^\s*(?:>\s*)*(`{3,}|~{3,})(.*)$/
const ATX_HEADING = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const HTML_HEADING = /^\s*<h[1-6][^>]*>(.*?)<\/h[1-6]>/i
const SETEXT_UNDERLINE = /^ {0,3}(?:=+|-+)[ \t]*$/
const NOT_PARAGRAPH = /^\s*(?:[-*+>#|]|\d{1,9}[.)]\s|<|`{3}|~{3})/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const TABLE_DIVIDER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
const LINK_DEFINITION = /^ {0,3}\[[^\]]+\]:\s/

const ENTITIES = new Map(Object.entries({
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' '
}))

/** Front matter split off the top (YAML `---` or TOML `+++`), with its `title`, if any. */
function splitFrontMatter(text: string): { body: string; title: string | null } {
  const m = FRONT_MATTER.exec(text)
  if (!m) return { body: text, title: null }
  const title = FRONT_TITLE.exec(m[1] ?? m[2] ?? '')?.[1].replace(/^(["'])(.*)\1$/, '$2').trim()
  return { body: text.slice(m[0].length), title: title || null }
}

const ESCAPED_PUNCTUATION = /\\([\\`*_{}[\]()#+\-.!|~<>])/g
/** Escaped characters ride through the stripping as private-use stand-ins (U+E000 + code). */
const PROTECT_BASE = 0xe000
const PROTECTED = /[\uE000-\uE07F]/g

/** Inline Markdown and block markers removed, leaving the words a reader sees. */
function stripMarkdown(line: string): string {
  return line
    .replace(ESCAPED_PUNCTUATION, (_, c: string) => String.fromCharCode(PROTECT_BASE + c.charCodeAt(0)))
    .replace(/^ {0,3}(?:>[ \t]?)+/, '')
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
    .replace(/^ {0,3}#{1,6}[ \t]+/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .replace(/!\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(/\[\^[^\]]+\]/g, '')
    .replace(/\[([^\]]*)\](?:\([^)]*\)|\[[^\]]*\])/g, '$1')
    .replace(/<((?:https?|mailto):[^>\s]+)>/gi, '$1')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/(`+)(.+?)\1/g, '$2')
    .replace(/(\*\*|__|~~|==)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/\*(?=\S)(.+?)(?<=\S)\*/g, '$1')
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/^[*_~]+(?=\S)|(?<=\S)[*_~]+$/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (e) => ENTITIES.get(e) ?? e)
    .replace(PROTECTED, (c) => String.fromCharCode(c.charCodeAt(0) - PROTECT_BASE))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Text of the first heading (ATX, setext or HTML) outside code blocks. */
function firstHeading(lines: readonly string[]): string | null {
  let fence: Fence | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (fence) {
      if (isFenceClose(line, fence)) fence = null
      continue
    }
    fence = fenceOpen(line)
    if (fence) continue
    const atx = ATX_HEADING.exec(line)
    const html = atx ? null : HTML_HEADING.exec(line)
    const setext = !atx && !html && line.trim() && !NOT_PARAGRAPH.test(line) &&
      i + 1 < lines.length && SETEXT_UNDERLINE.test(lines[i + 1])
    const raw = atx ? atx[1] ?? '' : html ? html[1] : setext ? line : null
    const text = raw === null ? '' : stripMarkdown(raw)
    if (text) return text
  }
  return null
}

/** True for lines that carry no readable words (rules, fences, table dividers, link defs). */
function isSyntaxOnly(line: string): boolean {
  return THEMATIC_BREAK.test(line) || TABLE_DIVIDER.test(line) || LINK_DEFINITION.test(line) ||
    SETEXT_UNDERLINE.test(line)
}

/** The first line with readable words, preferring prose over code. */
function firstTextLine(lines: readonly string[]): string | null {
  let fence: Fence | null = null
  let firstCode: string | null = null
  for (const line of lines) {
    if (fence) {
      if (isFenceClose(line, fence)) fence = null
      else if (!firstCode && line.trim()) firstCode = line.replace(/\s+/g, ' ').trim()
      continue
    }
    fence = fenceOpen(line)
    if (fence) continue
    if (isSyntaxOnly(line)) continue
    const text = stripMarkdown(line.replace(/\|/g, ' '))
    if (text) return text
  }
  return firstCode
}

/** The untruncated title: first heading, else front-matter `title`, else first text line. */
function rawTitle(md: string): string | null {
  const text = md.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').replace(/<!--[\s\S]*?-->/g, '')
  const { body, title } = splitFrontMatter(text)
  const lines = body.split('\n')
  return firstHeading(lines) ?? title ?? firstTextLine(lines)
}

/** `text` cut to at most `max` characters (code points) on a word boundary. With
 *  `ellipsis`, a cut title ends in "…" (counted in `max`). */
function cutOnWord(text: string, max: number, ellipsis: boolean): string {
  const chars = [...text]
  if (chars.length <= max) return text
  const room = Math.max(0, ellipsis ? max - 1 : max)
  const head = chars.slice(0, room).join('')
  const atBoundary = /\s/.test(chars[room] ?? ' ')
  const lastSpace = head.search(/\s\S*$/)
  const cut = atBoundary || lastSpace < room / 2 ? head : head.slice(0, lastSpace)
  const tidy = cut.replace(/[\s,;:.\-–—(/]+$/u, '') || cut
  return ellipsis ? `${tidy}…` : tidy
}

const DEFAULT_TITLE_LENGTH = 48

/** A readable title for a document: its first heading, else its first non-empty line,
 *  with Markdown syntax (#, *, _, `, [](), >, list markers, front matter) stripped,
 *  whitespace collapsed and cut to `maxLength` characters on a word boundary with "…".
 *  Null for an empty document. A front-matter `title:` is used when there is no heading,
 *  and code blocks only supply the title when the document has nothing else. */
export function titleFromMarkdown(md: string, maxLength = DEFAULT_TITLE_LENGTH): string | null {
  const title = rawTitle(md)
  if (!title) return null
  const max = Number.isFinite(maxLength) ? Math.max(1, Math.floor(maxLength)) : DEFAULT_TITLE_LENGTH
  return cutOnWord(title, max, true)
}

const MAX_SUGGESTED_STEM = 60
const UNSAFE_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f\x7f]+/g

/** "CON" → "CON (1)", "nul.md" → "nul (1).md": Windows reserves the part before the first dot. */
function avoidDeviceName(name: string): string {
  const dot = name.indexOf('.')
  const stem = (dot < 0 ? name : name.slice(0, dot)).trimEnd()
  if (!RESERVED_STEM.test(stem)) return name
  return `${stem} (1)${dot < 0 ? '' : name.slice(dot)}`
}

/** A safe default file name for a document (title → valid name + ".md"),
 *  "Untitled.md" when there is no usable title. The result passes `validateFileName` on
 *  every platform: unsafe characters become spaces, leading dots (hidden files) and
 *  trailing dots/spaces go, and Windows device names get a " (1)" suffix. */
export function suggestFileName(md: string): string {
  const title = rawTitle(md)
  if (!title) return 'Untitled.md'
  const cleaned = title.replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
  const short = cutOnWord(cleaned, MAX_SUGGESTED_STEM, false).replace(/^[.\s]+|[.\s]+$/g, '')
  if (!short) return 'Untitled.md'
  const name = ensureMdExtension(avoidDeviceName(short))
  return validateFileName(name, 'win32') === null ? name : 'Untitled.md'
}

// ---------------------------------------------------------------------------------------
// Pasted Markdown

const ZERO_WIDTH = /[\u200B\u2060\uFEFF]/g
/** ZWJ/ZWNJ next to ASCII or whitespace is copy residue; between emoji or letters of
 *  scripts like Persian or Devanagari it shapes the text, so it stays. */
const STRAY_JOINER = /(?<![^\s\x00-\x7f])[\u200C\u200D]|[\u200C\u200D](?![^\s\x00-\x7f])/g
const NO_BREAK_SPACE = /[\u00A0\u202F]/g
const COPY_RESIDUE = /^(?:copy code|copy|copied!?|copy to clipboard)$/i
/** Other code-header buttons that sit next to "Copy" in chat UIs. */
const HEADER_RESIDUE = /^(?:edit|run|download)$/i

interface Fence {
  marker: string
  /** Language from the info string, lower-cased ("" when none). */
  lang: string
}

function fenceOpen(line: string): Fence | null {
  const m = FENCE_OPEN.exec(line)
  if (!m || (m[1][0] === '`' && m[2].includes('`'))) return null
  return { marker: m[1], lang: (m[2].trim().split(/\s+/)[0] ?? '').toLowerCase() }
}

function isFenceClose(line: string, fence: Fence): boolean {
  const m = /^\s*(?:>\s*)*(`{3,}|~{3,})\s*$/.exec(line)
  return !!m && m[1][0] === fence.marker[0] && m[1].length >= fence.marker.length
}

function cleanProse(text: string): string {
  return text.replace(ZERO_WIDTH, '').replace(STRAY_JOINER, '').replace(NO_BREAK_SPACE, ' ')
}

/** Apply `fn` to the parts of `line` outside inline code spans. */
function outsideInlineCode(line: string, fn: (text: string) => string): string {
  const runs = [...line.matchAll(/`+/g)]
  let out = ''
  let last = 0
  for (let r = 0; r < runs.length; r++) {
    const open = runs[r]
    const start = open.index ?? 0
    if (start < last) continue
    const close = runs.slice(r + 1).find((c) => c[0].length === open[0].length)
    if (!close) continue
    const end = (close.index ?? 0) + close[0].length
    out += fn(line.slice(last, start)) + line.slice(start, end)
    last = end
  }
  return out + fn(line.slice(last))
}

/** How many lines of `out` to keep: the run of copy-button lines that ends it goes, but
 *  only when the run really contains a Copy label (a language label above it goes too). */
function keepBeforeResidue(out: readonly string[], lang: string): number {
  let k = out.length
  let sawCopy = false
  while (k > 0) {
    const line = out[k - 1].trim()
    const isCopy = COPY_RESIDUE.test(line)
    if (!isCopy && !HEADER_RESIDUE.test(line) && !(lang && line.toLowerCase() === lang)) break
    sawCopy = sawCopy || isCopy
    k--
  }
  return sawCopy ? k : out.length
}

function trimBlankEnds(lines: readonly string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && !lines[start].trim()) start++
  while (end > start && !lines[end - 1].trim()) end--
  return lines.slice(start, end)
}

/** Clean up Markdown copied out of a chat app before it becomes a document: normalize
 *  CRLF to LF, drop a leading/trailing blank run, remove zero-width characters and
 *  non-breaking spaces outside code, and strip copy-button residue lines that some chat
 *  UIs put inside copied code ("Copy code", "Copy", "Copied!") when they sit directly
 *  above a fenced block. Never changes text inside fenced code blocks otherwise.
 *  Residue as the very first line inside a fence is removed too; inline code spans are
 *  left alone. The result ends with one newline, or is "" when nothing is left. */
export function normalizePastedMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n')
  // A local accumulator, grown and trimmed in place: copying it per line or per fence
  // would make big pastes quadratic.
  const out: string[] = []
  let fence: Fence | null = null
  let atFenceTop = false
  for (const line of lines) {
    if (fence) {
      if (isFenceClose(line, fence)) fence = null
      else if (atFenceTop && COPY_RESIDUE.test(line.trim())) continue
      atFenceTop = false
      out.push(line)
      continue
    }
    const open = fenceOpen(line)
    if (open) {
      out.length = keepBeforeResidue(out, open.lang)
      out.push(line)
      fence = open
      atFenceTop = true
      continue
    }
    out.push(outsideInlineCode(line, cleanProse))
  }
  const kept = trimBlankEnds(out)
  return kept.length ? `${kept.join('\n')}\n` : ''
}
