// CONTRACT STUB (lane L implements). Pure helpers about files and names.
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

/** Why `name` can't be used as a file or folder name on `platform`, or null when it's fine.
 *  Rejects empty/whitespace-only names, "." and "..", path separators, characters Windows
 *  forbids (< > : " | ? * and control chars) on every platform (files travel between OSes),
 *  Windows reserved device names (CON, PRN, AUX, NUL, COM1–9, LPT1–9, with or without an
 *  extension), names ending in a dot or space, and names longer than 255 characters.
 *  Messages are short, friendly sentences ("A name can't contain /"). */
export function validateFileName(name: string, _platform: Platform): string | null {
  if (!name.trim()) return 'Enter a name'
  return null
}

/** True for files coding agents read as instructions: AGENTS.md, AGENT.md, CLAUDE.md,
 *  GEMINI.md, copilot-instructions.md, .cursorrules-style "*.mdc" rules, CONVENTIONS.md
 *  (case-insensitive on the base name). */
export function isAgentInstructionFile(fileName: string): boolean {
  return /^(agents?|claude|gemini)\.md$/i.test(fileName)
}

/** Paths present in `after` but not in `before` (in `after` order). */
export function addedPaths(before: Iterable<string>, after: Iterable<string>): string[] {
  const seen = new Set(before)
  return [...after].filter((p) => !seen.has(p))
}

/** A readable title for a document: its first heading, else its first non-empty line,
 *  with Markdown syntax (#, *, _, `, [](), >, list markers, front matter) stripped,
 *  whitespace collapsed and cut to `maxLength` characters on a word boundary with "…".
 *  Null for an empty document. */
export function titleFromMarkdown(md: string, maxLength = 48): string | null {
  const line = md.split('\n').find((l) => l.trim())
  if (!line) return null
  const t = line.replace(/^#+\s*/, '').trim()
  return t.length > maxLength ? t.slice(0, maxLength - 1) + '…' : t
}

/** A safe default file name for a document (title → valid name + ".md"),
 *  "Untitled.md" when there is no usable title. */
export function suggestFileName(md: string): string {
  const title = titleFromMarkdown(md, 60)
  return ensureMdExtension(title ? title.replace(/[<>:"/\\|?*]/g, '') : 'Untitled')
}

/** Clean up Markdown copied out of a chat app before it becomes a document: normalize
 *  CRLF to LF, drop a leading/trailing blank run, remove zero-width characters and
 *  non-breaking spaces outside code, and strip copy-button residue lines that some chat
 *  UIs put inside copied code ("Copy code", "Copy", "Copied!") when they sit directly
 *  above a fenced block. Never changes text inside fenced code blocks otherwise. */
export function normalizePastedMarkdown(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim() + '\n'
}
