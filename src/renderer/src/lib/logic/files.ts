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

/** Whitespace and invisible format characters: a name made only of these shows as blank. */
const INVISIBLE_OR_SPACE = /[\s\p{Cf}]/gu
/** Bidi embeddings, overrides and isolates, which can make "txt.exe" display as "exe.txt". */
const BIDI_CONTROLS = /[\u202A-\u202E\u2066-\u2069]/

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** Why `name` can't be used as a file or folder name on `platform`, or null when it's fine.
 *  Rejects empty/whitespace-only names, "." and "..", path separators, characters Windows
 *  forbids (< > : " | ? * and control chars) on every platform (files travel between OSes),
 *  Windows reserved device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9, with or without an
 *  extension), names ending in a dot or space, and names longer than 255 characters (or
 *  255 UTF-8 bytes, the Linux limit). Messages are short, friendly sentences
 *  ("A name can't contain /"). Names made only of invisible characters count as empty,
 *  and bidi override/isolate characters (which can disguise an extension) are refused. */
export function validateFileName(name: string, platform: Platform): string | null {
  if (!name.replace(INVISIBLE_OR_SPACE, '')) return 'Enter a name'
  if (BIDI_CONTROLS.test(name)) return "A name can't contain hidden text-direction characters"
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

// Spans below are capped in length so a line full of unclosed openers ("[", "<", "**")
// stays linear instead of rescanning to the end for each one. Real spans are far shorter.

/** Emphasis-like spans, outermost first. A delimiter never touches another copy of its
 *  own character, so "*args and **kwargs" or "a***" stay literal, as CommonMark shows them. */
const EMPHASIS_SPANS: readonly RegExp[] = [
  /(?<!\*)\*\*\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*\*\*(?!\*)/g,
  /(?<!\*)\*\*(?=[^\s*])(.{1,500}?)(?<=[^\s*])\*\*(?!\*)/g,
  /(?<!_)__(?=[^\s_])(.{1,500}?)(?<=[^\s_])__(?!_)/g,
  /(?<!~)~~(?=[^\s~])(.{1,500}?)(?<=[^\s~])~~(?!~)/g,
  /(?<!=)==(?=[^\s=])(.{1,500}?)(?<=[^\s=])==(?!=)/g,
  /(?<!\*)\*(?=[^\s*])([^*]{1,500}?)(?<=[^\s*])\*(?!\*)/g
]

/** Link text never spans another "[", and a destination may hold one level of
 *  parentheses (Wikipedia URLs), so each opener's scan stops at the next one. */
const LINK_TAIL = String.raw`(?:\((?:[^()]|\([^()]*\))*\)|\[[^[\]]{0,500}\])`
const IMAGE = new RegExp(String.raw`!\[([^[\]]{0,500})\]` + LINK_TAIL, 'g')
const LINK = new RegExp(String.raw`\[([^[\]]{0,500})\]` + LINK_TAIL, 'g')

/** Block markers, links, images, HTML tags and code spans removed. */
function stripStructure(line: string): string {
  return line
    .replace(/^ {0,3}(?:>[ \t]?)+/, '')
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
    .replace(/^ {0,3}#{1,6}[ \t]+/, '')
    .replace(/[ \t]+#+[ \t]*$/, '')
    .replace(IMAGE, '$1')
    .replace(/\[\^[^[\]]{1,500}\]/g, '')
    .replace(LINK, '$1')
    .replace(/<((?:https?|mailto):[^<>\s]{1,2000})>/gi, '$1')
    .replace(/<\/?[a-z][^<>]{0,500}>/gi, '')
    .replace(/(`+)(.{1,500}?)\1/g, '$2')
}

/** Inline Markdown and block markers removed, leaving the words a reader sees. */
function stripMarkdown(line: string): string {
  const protectedLine = line.replace(ESCAPED_PUNCTUATION, (_, c: string) => String.fromCharCode(PROTECT_BASE + c.charCodeAt(0)))
  const unemphasized = EMPHASIS_SPANS.reduce((text, span) => text.replace(span, '$1'), stripStructure(protectedLine))
  return unemphasized
    .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])(.{1,500}?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu, '$1$2')
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

/** `text` without closed HTML comments (an unclosed "<!--" stays as text). An indexOf
 *  walk rather than a lazy regex, which rescans to the end for every unclosed opener. */
function stripComments(text: string): string {
  let out = ''
  let from = 0
  for (;;) {
    const open = text.indexOf('<!--', from)
    const close = open < 0 ? -1 : text.indexOf('-->', open + 4)
    if (close < 0) return out + text.slice(from)
    out += text.slice(from, open)
    from = close + 3
  }
}

/** The untruncated title: first heading, else front-matter `title`, else first text line. */
function rawTitle(md: string): string | null {
  const text = md.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const { body, title } = splitFrontMatter(stripComments(text))
  const lines = body.split('\n')
  return firstHeading(lines) ?? title ?? firstTextLine(lines)
}

// Intl.Segmenter is in Electron and Node, but not in the renderer's ES2021 type library.
interface GraphemeSegmenter {
  segment(text: string): Iterable<{ segment: string }>
}
type SegmenterConstructor = new (locale: undefined, options: { granularity: 'grapheme' }) => GraphemeSegmenter
const Segmenter = (Intl as unknown as { Segmenter?: SegmenterConstructor }).Segmenter
const graphemeSegmenter = Segmenter ? new Segmenter(undefined, { granularity: 'grapheme' }) : null

/** The first `limit` user-perceived characters of `text`, so emoji sequences (a ZWJ family),
 *  flags and accents stay whole. Stops early: titles can come from very long lines. */
function firstGraphemes(text: string, limit: number): string[] {
  const out: string[] = []
  const pieces: Iterable<string | { segment: string }> = graphemeSegmenter ? graphemeSegmenter.segment(text) : text
  for (const piece of pieces) {
    if (out.length >= limit) break
    out.push(typeof piece === 'string' ? piece : piece.segment)
  }
  return out
}

/** Index of the last whitespace character before `end`, or -1. */
function lastSpaceBefore(chars: readonly string[], end: number): number {
  for (let k = end - 1; k >= 0; k--) {
    if (/^\s/.test(chars[k])) return k
  }
  return -1
}

/** `text` cut to at most `max` characters (graphemes) on a word boundary. With
 *  `ellipsis`, a cut title ends in "…" (counted in `max`). */
function cutOnWord(text: string, max: number, ellipsis: boolean): string {
  if (text.length <= max) return text
  const chars = firstGraphemes(text, max + 1)
  if (chars.length <= max) return text
  const room = Math.max(0, ellipsis ? max - 1 : max)
  const atBoundary = /^\s/.test(chars[room])
  const lastSpace = lastSpaceBefore(chars, room)
  // Cut at the last space unless that would throw away more than half the room.
  const keep = atBoundary || lastSpace < room / 2 ? room : lastSpace
  const cut = chars.slice(0, keep).join('')
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
/** Invisible format characters (soft hyphen, zero-width space, direction marks and
 *  overrides, word joiners, BOM) that ride along in pasted AI titles. ZWJ/ZWNJ are
 *  handled separately: inside emoji and some scripts they matter. */
const INVISIBLE_IN_NAME = /[\u00AD\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g

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
 *  trailing dots/spaces go, invisible characters are dropped, and Windows device names
 *  get a " (1)" suffix. */
export function suggestFileName(md: string): string {
  const title = rawTitle(md)
  if (!title) return 'Untitled.md'
  const visible = title.replace(INVISIBLE_IN_NAME, '').replace(STRAY_JOINER, '')
  const cleaned = visible.replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
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

/** For each backtick run, the index of the next run of the same length (or -1): the run
 *  that would close a code span it opens. One backwards pass, so long lines stay linear. */
function nextSameLength(runs: readonly RegExpMatchArray[]): number[] {
  const latest = new Map<number, number>()
  const next = new Array<number>(runs.length)
  for (let r = runs.length - 1; r >= 0; r--) {
    next[r] = latest.get(runs[r][0].length) ?? -1
    latest.set(runs[r][0].length, r)
  }
  return next
}

/** Apply `fn` to the parts of `line` outside inline code spans. A backtick run opens a
 *  span that the next run of the same length closes; a run with no partner is text. */
function outsideInlineCode(line: string, fn: (text: string) => string): string {
  const runs = [...line.matchAll(/`+/g)]
  if (runs.length < 2) return fn(line)
  const next = nextSameLength(runs)
  let out = ''
  let last = 0
  for (let r = 0; r < runs.length; r++) {
    const close = next[r]
    if (close < 0) continue
    const start = runs[r].index ?? 0
    const end = (runs[close].index ?? 0) + runs[close][0].length
    out += fn(line.slice(last, start)) + line.slice(start, end)
    last = end
    // Runs inside the span are code, not openers.
    r = close
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
 *  above a fenced block. Never changes text inside fenced code blocks (a "Copy" line in
 *  code may be real code, such as a batch command) or inside inline code spans. The
 *  result ends with one newline, or is "" when nothing is left. */
export function normalizePastedMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n')
  // A local accumulator, grown and trimmed in place: copying it per line or per fence
  // would make big pastes quadratic.
  const out: string[] = []
  let fence: Fence | null = null
  for (const line of lines) {
    if (fence) {
      if (isFenceClose(line, fence)) fence = null
      out.push(line)
      continue
    }
    const open = fenceOpen(line)
    if (open) {
      out.length = keepBeforeResidue(out, open.lang)
      out.push(line)
      fence = open
      continue
    }
    out.push(outsideInlineCode(line, cleanProse))
  }
  const kept = trimBlankEnds(out)
  return kept.length ? `${kept.join('\n')}\n` : ''
}
