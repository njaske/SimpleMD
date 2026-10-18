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

const utf8 = new TextEncoder()

function byteLength(text: string): number {
  return utf8.encode(text).length
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
/** One blockquote or list-item marker, matched again and again from where the last ended:
 *  a loop of sticky matches can't backtrack the way one regex with a repeated group can. */
const CONTAINER_MARKER = /[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+)/y
const QUOTE_MARKER = /[ \t]*>[ \t]?/y
const FENCE_AT = /^([ \t]*)(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE_AT = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/
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

/** Escaped punctuation ("\*") or a backtick run: the two ways text becomes literal. */
const LITERAL_TOKEN = /\\([\\`*_{}[\]()#+\-.!|~<>])|`+/g
const PRIVATE_USE_START = 0xe000

/** A private-use character `line` doesn't contain, to mark hidden text with. Only codes
 *  the line really uses are skipped, so text that holds such characters (Nerd Font icons)
 *  comes back unchanged. */
function unusedSentinel(line: string): string {
  const used = new Set<number>()
  for (let i = 0; i < line.length; i++) {
    const code = line.charCodeAt(i)
    if (code >= PRIVATE_USE_START) used.add(code)
  }
  let code = PRIVATE_USE_START
  while (used.has(code)) code++
  return String.fromCharCode(code)
}

/** Start of every backtick run in `line`, grouped by run length, ascending. */
function backtickRuns(line: string): Map<number, number[]> {
  const runs = new Map<number, number[]>()
  for (const m of line.matchAll(/`+/g)) {
    const starts = runs.get(m[0].length)
    if (starts) starts.push(m.index ?? 0)
    else runs.set(m[0].length, [m.index ?? 0])
  }
  return runs
}

/** The first of the ascending `starts` at or after `from`, or -1. */
function firstAtOrAfter(starts: readonly number[], from: number): number {
  let lo = 0
  let hi = starts.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (starts[mid] < from) lo = mid + 1
    else hi = mid
  }
  return lo < starts.length ? starts[lo] : -1
}

interface Hidden {
  text: string
  /** `stripped` with the hidden pieces put back. */
  restore: (stripped: string) => string
}

/** `line` with code spans and escaped characters swapped for placeholders, so stripping
 *  can't touch them ("`__init__`" keeps its underscores). A code span is a backtick run
 *  closed by the next run of the same length; inside it backslashes are literal. Runs are
 *  indexed up front so a line of unmatched runs stays linear. */
function hideLiterals(line: string): Hidden {
  const sentinel = unusedSentinel(line)
  const pieces: string[] = []
  const hide = (piece: string): string => `${sentinel}${pieces.push(piece) - 1}${sentinel}`
  const runs = backtickRuns(line)
  const token = new RegExp(LITERAL_TOKEN.source, 'g')
  let text = ''
  let last = 0
  for (let m = token.exec(line); m; m = token.exec(line)) {
    const after = token.lastIndex
    const isEscape = m[1] !== undefined
    const close = isEscape ? after : firstAtOrAfter(runs.get(m[0].length) ?? [], after)
    // A run nothing closes is plain text.
    if (close < 0) continue
    text += line.slice(last, m.index) + hide(isEscape ? m[1] : line.slice(after, close))
    last = isEscape ? after : close + m[0].length
    token.lastIndex = last
  }
  const placeholder = new RegExp(`${sentinel}(\\d+)${sentinel}`, 'g')
  return {
    text: text + line.slice(last),
    restore: (stripped) => stripped.replace(placeholder, (_, i: string) => pieces[Number(i)] ?? '')
  }
}

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

/** Quote markers (with a callout's "[!NOTE]"), list and task markers and an ATX heading's
 *  hashes removed from the start of a body line. Not used on heading text, where
 *  "# 1. Introduction" keeps its number. */
function stripBlockMarkers(line: string): string {
  return line
    .replace(/^ {0,3}(?:>[ \t]?)+(?:\[![\w-]+\][+-]?(?=[ \t]|$))?/, '')
    .replace(/^\s*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/, '')
    .replace(/^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/, '$1')
}

/** Links and images reduced to their text; footnote refs and HTML tags dropped. */
function stripLinksAndTags(text: string): string {
  return text
    .replace(IMAGE, '$1')
    .replace(/\[\^[^[\]]{1,500}\]/g, '')
    .replace(LINK, '$1')
    .replace(/<((?:https?|mailto):[^<>\s]{1,2000})>/gi, '$1')
    .replace(/<\/?[a-z][^<>]{0,500}>/gi, '')
}

/** Inline Markdown removed, leaving the words a reader sees. Code spans and escaped
 *  characters stay literal. With `cells`, table pipes (not escaped or in code) become spaces. */
function stripInline(raw: string, cells = false): string {
  const { text, restore } = hideLiterals(raw)
  const flat = stripLinksAndTags(cells ? text.replace(/\|/g, ' ') : text)
  const unemphasized = EMPHASIS_SPANS.reduce((t, span) => t.replace(span, '$1'), flat)
  const plain = unemphasized
    .replace(/(^|[^\p{L}\p{N}_])_(?=[^\s_])(.{1,500}?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu, '$1$2')
    .replace(/^[*_~]+(?=\S)|(?<=\S)[*_~]+$/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (e) => ENTITIES.get(e) ?? e)
  return restore(plain).replace(/\s+/g, ' ').trim()
}

/** True for lines that carry no readable words (rules, fences, table dividers, link defs). */
function isSyntaxOnly(line: string): boolean {
  return THEMATIC_BREAK.test(line) || TABLE_DIVIDER.test(line) || LINK_DEFINITION.test(line) ||
    SETEXT_UNDERLINE.test(line)
}

function isParagraphLine(line: string): boolean {
  return line.trim() !== '' && !NOT_PARAGRAPH.test(line) && !isSyntaxOnly(line)
}

/** Raw text of a heading on line `i`: ATX, HTML, or setext, which takes the whole
 *  paragraph from `paraStart` through `i` when the next line underlines it. */
function headingAt(lines: readonly string[], i: number, paraStart: number): string | null {
  const line = lines[i]
  const atx = ATX_HEADING.exec(line)
  if (atx) return atx[1] ?? ''
  const html = HTML_HEADING.exec(line)
  if (html) return html[1]
  const underlined = i + 1 < lines.length && SETEXT_UNDERLINE.test(lines[i + 1])
  return underlined && isParagraphLine(line) ? lines.slice(paraStart, i + 1).join(' ') : null
}

/** Text of the first heading (ATX, setext or HTML) outside code blocks. */
function firstHeading(lines: readonly string[]): string | null {
  let fence: Fence | null = null
  // First line of the paragraph the current line continues.
  let paraStart = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (fence) {
      if (isFenceClose(line, fence)) fence = null
      paraStart = i + 1
      continue
    }
    fence = fenceOpen(line)
    const raw = fence ? null : headingAt(lines, i, paraStart)
    const text = raw === null ? '' : stripInline(raw)
    if (text) return text
    if (raw !== null || !isParagraphLine(line)) paraStart = i + 1
  }
  return null
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
    const text = stripInline(stripBlockMarkers(line), true)
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

/** How many of `chars` to keep when at most `room` fit: up to the last space, unless that
 *  would throw away more than half the room. */
function wordCutAt(chars: readonly string[], room: number): number {
  const atBoundary = room < chars.length && /^\s/.test(chars[room])
  const lastSpace = lastSpaceBefore(chars, room)
  return atBoundary || lastSpace < room / 2 ? room : lastSpace
}

const TRAILING_PUNCTUATION = /[\s,;:.\-–—(/]+$/u

/** The first `keep` of `chars`, without punctuation or spaces dangling at the cut. */
function joinCut(chars: readonly string[], keep: number): string {
  const cut = chars.slice(0, keep).join('')
  return cut.replace(TRAILING_PUNCTUATION, '') || cut
}

/** `text` cut to at most `max` characters (graphemes) on a word boundary. With
 *  `ellipsis`, a cut title ends in "…" (counted in `max`). */
function cutOnWord(text: string, max: number, ellipsis: boolean): string {
  if (text.length <= max) return text
  const chars = firstGraphemes(text, max + 1)
  if (chars.length <= max) return text
  const room = Math.max(0, ellipsis ? max - 1 : max)
  const tidy = joinCut(chars, wordCutAt(chars, room))
  return ellipsis ? `${tidy}…` : tidy
}

/** `text` cut on a word boundary (else between graphemes) to at most `maxBytes` UTF-8
 *  bytes. Short titles can still be long in bytes: a Devanagari conjunct or a skin-toned
 *  emoji is one character but up to a dozen bytes. */
function cutToBytes(text: string, maxBytes: number): string {
  if (byteLength(text) <= maxBytes) return text
  const chars = firstGraphemes(text, Infinity)
  let fit = 0
  let used = 0
  while (fit < chars.length) {
    const size = byteLength(chars[fit])
    if (used + size > maxBytes) break
    used += size
    fit++
  }
  return joinCut(chars, wordCutAt(chars, fit))
}

const DEFAULT_TITLE_LENGTH = 48

/** A readable title for a document: its first heading, else its first non-empty line,
 *  with Markdown syntax (#, *, _, `, [](), >, list markers, front matter) stripped,
 *  whitespace collapsed and cut to `maxLength` characters on a word boundary with "…".
 *  Null for an empty document. A front-matter `title:` is used when there is no heading,
 *  and code blocks only supply the title when the document has nothing else. Text inside
 *  code spans stays as written, and a callout's "[!NOTE]" marker is skipped. */
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
 *  trailing dots/spaces go, invisible characters are dropped, Windows device names get a
 *  " (1)" suffix, and a long title is cut on a word boundary to 60 characters and to the
 *  255-byte name limit. */
export function suggestFileName(md: string): string {
  const title = rawTitle(md)
  if (!title) return 'Untitled.md'
  const visible = title.replace(INVISIBLE_IN_NAME, '').replace(STRAY_JOINER, '')
  const cleaned = visible.replace(UNSAFE_NAME_CHARS, ' ').replace(/\s+/g, ' ').trim()
  const stem = cutToBytes(cutOnWord(cleaned, MAX_SUGGESTED_STEM, false), MAX_NAME_LENGTH - '.md'.length)
  const short = stem.replace(/^[.\s]+|[.\s]+$/g, '')
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
  /** Column the fence's container content starts at: a closing fence may sit at most 3
   *  columns past it; a more indented one is code. */
  indent: number
}

/** Display column reached after `line.slice(0, end)`, with tabs to the next multiple of 4. */
function columnAt(line: string, end: number): number {
  let column = 0
  for (let i = 0; i < end; i++) column = line[i] === '\t' ? column + 4 - (column % 4) : column + 1
  return column
}

/** Where the run of sticky `marker` matches at the start of `line` ends. */
function markersEnd(line: string, marker: RegExp): number {
  let end = 0
  marker.lastIndex = 0
  while (marker.exec(line)) end = marker.lastIndex
  return end
}

/** The fence `line` opens, after any quote and list markers ("- ```bat" opens one, as in
 *  CommonMark). A bare fence line belongs to the list whose text starts at `listIndent`
 *  when it is indented that far. */
function fenceOpen(line: string, listIndent = 0): Fence | null {
  const start = markersEnd(line, CONTAINER_MARKER)
  const m = FENCE_AT.exec(start > 0 ? line.slice(start) : line)
  if (!m || (m[2][0] === '`' && m[3].includes('`'))) return null
  const column = columnAt(line, start + m[1].length)
  const container = start > 0 ? columnAt(line, start) : column >= listIndent ? listIndent : 0
  return {
    marker: m[2],
    lang: (m[3].trim().split(/\s+/)[0] ?? '').toLowerCase(),
    indent: Math.max(container, column - 3)
  }
}

/** True when `line` closes `fence`: the same character, at least as long, nothing after
 *  it, and at most 3 columns past the fence's container. Quote markers are skipped; a
 *  line starting with a list marker is code content. */
function isFenceClose(line: string, fence: Fence): boolean {
  const start = markersEnd(line, QUOTE_MARKER)
  const m = FENCE_CLOSE_AT.exec(start > 0 ? line.slice(start) : line)
  if (!m || m[2][0] !== fence.marker[0] || m[2].length < fence.marker.length) return false
  return columnAt(line, start + m[1].length) - fence.indent <= 3
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

const HTML_CODE_OPEN = /<code\b[^>]*>/gi
const HTML_CODE_CLOSE = /<\/code\s*>/gi

/** Apply `fn` to the parts of `line` outside code: `<code>…</code>` elements and inline
 *  code spans. Stops looking once an opener has no closer, so no line is rescanned. */
function outsideCode(line: string, fn: (text: string) => string): string {
  const open = new RegExp(HTML_CODE_OPEN.source, 'gi')
  const close = new RegExp(HTML_CODE_CLOSE.source, 'gi')
  let out = ''
  let from = 0
  for (;;) {
    open.lastIndex = from
    const start = open.exec(line)
    close.lastIndex = start ? open.lastIndex : 0
    const end = start ? close.exec(line) : null
    if (!start || !end) return out + outsideInlineCode(line.slice(from), fn)
    out += outsideInlineCode(line.slice(from, start.index), fn) + line.slice(start.index, close.lastIndex)
    from = close.lastIndex
  }
}

/** Column width of leading whitespace, with tabs to the next multiple of 4. */
function indentWidth(line: string): number {
  return columnAt(line, /^[ \t]*/.exec(line)?.[0].length ?? 0)
}

const LIST_ITEM = /^([ \t]*(?:[-*+]|\d{1,9}[.)]))([ \t]+|$)/
/** HTML blocks whose contents are raw text (CommonMark's first kind of HTML block). */
const RAW_HTML_OPEN = /^ {0,3}<(pre|script|style|textarea|code)(?=[\s>]|$)/i

/** Column where a list item's text starts ("- a" → 2, "10.  b" → 5), or -1 for no item. */
function listContentIndent(line: string): number {
  const m = LIST_ITEM.exec(line)
  if (!m || THEMATIC_BREAK.test(line)) return -1
  const marker = indentWidth(m[1].replace(/\S+$/, '')) + m[1].trim().length
  const gap = indentWidth(`${' '.repeat(marker)}${m[2]}`) - marker
  return gap >= 1 && gap <= 4 ? marker + gap : marker + 1
}

function closesRaw(line: string, tag: string): boolean {
  return new RegExp(`</${tag}\\s*>`, 'i').test(line)
}

interface PasteState {
  fence: Fence | null
  /** Tag of the raw HTML block (<pre>, <script>…) being passed through, or null. */
  rawTag: string | null
  /** Indent of the indented code block being passed through; 0 outside one. */
  codeIndent: number
  /** Where list item text starts in the current list; 0 outside lists. */
  listIndent: number
  /** The last line was paragraph text, which an indented line continues (it's not code). */
  afterParagraph: boolean
}

const PASTE_START: PasteState = { fence: null, rawTag: null, codeIndent: 0, listIndent: 0, afterParagraph: false }

/** How a pasted line is treated: code is kept byte for byte, a fence opening also drops
 *  the copy-button residue above it, and prose is cleaned. */
type PasteLine = 'code' | 'fence' | 'prose'

/** The state after a line that isn't code: lists and paragraphs, which decide whether
 *  the next indented line is code. */
function afterProse(s: PasteState, line: string): PasteState {
  const blank = !line.trim()
  const item = listContentIndent(line)
  // Text back at the margin after a blank line ends the list; without one it continues it.
  const leftList = !blank && item < 0 && !s.afterParagraph && indentWidth(line) < s.listIndent
  const listIndent = item >= 0 ? item : leftList ? 0 : s.listIndent
  const afterParagraph = !blank && !ATX_HEADING.test(line) && !THEMATIC_BREAK.test(line)
  return { ...s, codeIndent: 0, listIndent, afterParagraph }
}

/** Classify `line` and return the state after it. Fenced code, raw HTML blocks such as
 *  <pre>, and indented code (4 columns past the list's text, not continuing a paragraph)
 *  are code. */
function stepPaste(s: PasteState, line: string): { kind: PasteLine; next: PasteState } {
  if (s.fence) return { kind: 'code', next: { ...s, fence: isFenceClose(line, s.fence) ? null : s.fence } }
  if (s.rawTag) return { kind: 'code', next: { ...s, rawTag: closesRaw(line, s.rawTag) ? null : s.rawTag } }
  const blank = !line.trim()
  const indent = indentWidth(line)
  if (s.codeIndent && (blank || indent >= s.codeIndent)) return { kind: 'code', next: s }
  const base: PasteState = { ...s, codeIndent: 0, afterParagraph: false }
  if (!blank && !s.afterParagraph && indent >= s.listIndent + 4) {
    return { kind: 'code', next: { ...base, codeIndent: s.listIndent + 4 } }
  }
  const fence = fenceOpen(line, s.listIndent)
  if (fence) {
    // A fence on a list item starts that item's text; one left of the list ends the list.
    const item = listContentIndent(line)
    const listIndent = item >= 0 ? item : indent < s.listIndent ? 0 : s.listIndent
    return { kind: 'fence', next: { ...base, fence, listIndent } }
  }
  const raw = RAW_HTML_OPEN.exec(line)?.[1].toLowerCase()
  // An inline <code>…</code> starting a line is prose with a code element in it.
  if (raw && !(raw === 'code' && closesRaw(line, raw))) {
    return { kind: 'code', next: { ...base, rawTag: closesRaw(line, raw) ? null : raw } }
  }
  return { kind: 'prose', next: afterProse(s, line) }
}

/** How many lines of `out` to keep: the run of copy-button lines that ends it goes, but
 *  only when the run really contains a Copy label (a language label above it goes too).
 *  Lines before `floor` are code and never go. */
function keepBeforeResidue(out: readonly string[], lang: string, floor: number): number {
  let k = out.length
  let sawCopy = false
  while (k > floor) {
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
 *  code may be real code, such as a batch command), indented code blocks, raw HTML
 *  blocks such as <pre>, inline code spans or <code> elements. The result ends with one
 *  newline, or is "" when nothing is left. */
export function normalizePastedMarkdown(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').split('\n')
  // A local accumulator, grown and trimmed in place: copying it per line or per fence
  // would make big pastes quadratic.
  const out: string[] = []
  let state = PASTE_START
  // out.length after the last code line: residue is never taken out of code.
  let codeEnd = 0
  for (const line of lines) {
    const { kind, next } = stepPaste(state, line)
    state = next
    if (kind === 'fence') out.length = keepBeforeResidue(out, next.fence?.lang ?? '', codeEnd)
    out.push(kind === 'prose' ? outsideCode(line, cleanProse) : line)
    if (kind !== 'prose') codeEnd = out.length
  }
  const kept = trimBlankEnds(out)
  return kept.length ? `${kept.join('\n')}\n` : ''
}
