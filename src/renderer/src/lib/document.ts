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

export function computeOutline(md: string): OutlineEntry[] {
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

export function computeStats(md: string): DocStats {
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
