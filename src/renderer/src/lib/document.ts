// Pure helpers for headings/outline, document statistics, and full-text search.
// Ported from the SimpleMD design logic.

export interface OutlineEntry {
  level: number
  text: string
  slug: string
}

export function slugify(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// The App asks for the outline and stats of the active document on every render
// (and the outline again when painting), so remember the last answer.
let lastOutlineSrc: string | null = null
let lastOutline: OutlineEntry[] = []

/** Headings of a document. The returned array is shared between calls for the
 *  same text, so callers must treat it as read-only. */
export function computeOutline(md: string): OutlineEntry[] {
  if (md === lastOutlineSrc) return lastOutline
  const result = scanOutline(md)
  lastOutlineSrc = md
  lastOutline = result
  return result
}

function scanOutline(md: string): OutlineEntry[] {
  const lines = (md || '').split('\n')
  let inFence = false
  const out: OutlineEntry[] = []
  const used: Record<string, number> = {}
  for (const ln of lines) {
    if (/^\s*(```|~~~)/.test(ln)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const m = ln.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      const text = m[2].replace(/#+\s*$/, '').replace(/[*_`~]/g, '').trim()
      const base = slugify(text) || 'section'
      let slug = base
      let k = 1
      while (used[slug]) slug = base + '-' + k++
      used[slug] = 1
      out.push({ level: m[1].length, text, slug })
    }
  }
  return out
}

export interface DocStats {
  words: number
  minutes: number
  lines: number
  headings: number
}

let lastStatsSrc: string | null = null
let lastStats: DocStats | null = null

export function computeStats(md: string): DocStats {
  if (lastStats && md === lastStatsSrc) return lastStats
  const stats = scanStats(md)
  lastStatsSrc = md
  lastStats = stats
  return stats
}

function scanStats(md: string): DocStats {
  const text = (md || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ')
  const words = (text.match(/[A-Za-z0-9’'À-ɏ]+/g) || []).length
  return {
    words,
    minutes: Math.max(1, Math.round(words / 200)),
    lines: (md || '').split('\n').length,
    headings: computeOutline(md).length
  }
}

export interface SearchMatch {
  key: number
  line: number
  col: number
  len: number
  pre: string
  mid: string
  post: string
}

export interface SearchGroup {
  fileId: string
  fileName: string
  folderName: string
  count: number
  matches: SearchMatch[]
}

export interface SearchResult {
  groups: SearchGroup[]
  total: number
  fileCount: number
}

export interface SearchableFile {
  id: string
  name: string
  folderName: string
  content: string
}

const MAX_MATCHES_PER_FILE = 6
const SNIPPET_BEFORE = 22
const SNIPPET_AFTER = 52

export function searchAll(query: string, files: SearchableFile[]): SearchResult {
  const q = (query || '').trim()
  const ql = q.toLowerCase()
  const groups: SearchGroup[] = []
  let total = 0
  let fileCount = 0
  if (!q) return { groups, total, fileCount }

  for (const file of files) {
    // Cheap whole-file rejection before the per-line scan: most files in a big
    // workspace don't contain the query at all.
    if (file.content.toLowerCase().indexOf(ql) < 0) continue
    const lines = file.content.split('\n')
    const matches: SearchMatch[] = []
    let lineMatches = 0
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]
      const idx = ln.toLowerCase().indexOf(ql)
      if (idx < 0) continue
      lineMatches++
      total++
      if (matches.length < MAX_MATCHES_PER_FILE) {
        const start = Math.max(0, idx - SNIPPET_BEFORE)
        const pre = (start > 0 ? '…' : '') + ln.slice(start, idx)
        const mid = ln.slice(idx, idx + q.length)
        let post = ln.slice(idx + q.length, idx + q.length + SNIPPET_AFTER)
        if (ln.length > idx + q.length + SNIPPET_AFTER) post += '…'
        matches.push({ key: i, line: i, col: idx, len: q.length, pre, mid, post })
      }
    }
    if (matches.length) {
      fileCount++
      groups.push({
        fileId: file.id,
        fileName: file.name,
        folderName: file.folderName,
        count: lineMatches,
        matches
      })
    }
  }
  return { groups, total, fileCount }
}

/** Cheap pre-parse checks for the optional libraries a document needs, so KaTeX
 *  and highlight.js are only loaded for documents that can use them. */
export function mayContainMath(md: string): boolean {
  return md.includes('$')
}

export function mayContainCode(md: string): boolean {
  // Deliberately loose (fences may sit in blockquotes / list items, or be raw
  // HTML): a false positive only loads highlight.js early, a miss loses colours.
  return /(?:```|~~~)[ \t]*[^\s`~]|language-/.test(md)
}
