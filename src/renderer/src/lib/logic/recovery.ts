// Which unsaved buffers to keep for crash recovery, and validating what comes back.
import type { RecoveryEntry } from '@shared/types'

/** Total characters of recovery text kept on disk; the largest buffers are dropped first. */
export const MAX_RECOVERY_CHARS = 20 * 1024 * 1024

export interface BufferState {
  id: string
  path: string | null
  title: string
  content: string
  /** Last saved text; for an untitled document this is "" (so any text counts as unsaved). */
  saved: string
}

const UNTITLED_ID = /^untitled:\d+$/

function isUnsaved(b: BufferState): boolean {
  if (b.content === b.saved) return false
  return b.path !== null || b.content.trim() !== ''
}

/** Indexes of the buffers to drop so the rest fit in `budget` characters, largest first.
 *  Among equal sizes the later tabs go first, keeping the earlier tabs, which usually hold
 *  the longer-running work. */
function overBudget(sizes: readonly number[], budget: number): Set<number> {
  let total = sizes.reduce((n, s) => n + s, 0)
  const largestFirst = sizes.map((size, index) => ({ size, index }))
    .sort((a, b) => b.size - a.size || b.index - a.index)
  const dropped = new Set<number>()
  for (const { size, index } of largestFirst) {
    if (total <= budget) break
    dropped.add(index)
    total -= size
  }
  return dropped
}

/** Entries for every buffer whose content differs from its saved text (untitled documents
 *  only when they are not empty/whitespace), stamped with `now`, keeping the total under
 *  MAX_RECOVERY_CHARS by dropping the largest buffers first. Order follows `buffers`.
 *  A buffer id that appears twice is kept once (the first). */
export function recoveryEntries(buffers: readonly BufferState[], now: number): RecoveryEntry[] {
  const seen = new Set<string>()
  const unsaved = buffers.filter((b) => {
    if (seen.has(b.id) || !isUnsaved(b)) return false
    seen.add(b.id)
    return true
  })
  const dropped = overBudget(unsaved.map((b) => b.content.length), MAX_RECOVERY_CHARS)
  return unsaved
    .filter((_, i) => !dropped.has(i))
    .map((b) => ({ id: b.id, path: b.path, title: b.title, content: b.content, savedAt: now }))
}

/** True for an absolute path on any desktop OS: "/x", "C:\x", "C:/x", or a UNC "\\server\share". */
export function isAbsolutePath(path: string): boolean {
  return /^\//.test(path) || /^[a-zA-Z]:[\\/]/.test(path) || /^\\\\[^\\/]+[\\/][^\\/]+/.test(path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One entry rebuilt from untrusted data, or null when anything about it is off
 *  (including getters that throw: one bad entry mustn't cost the others). */
function sanitizeEntry(value: unknown): RecoveryEntry | null {
  try {
    return readEntry(value)
  } catch {
    return null
  }
}

function readEntry(value: unknown): RecoveryEntry | null {
  if (!isRecord(value)) return null
  const { id, path, title, content, savedAt } = value
  if (typeof id !== 'string' || typeof title !== 'string' || typeof content !== 'string') return null
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt < 0) return null
  if (id.includes('\0')) return null
  if (UNTITLED_ID.test(id)) return path === null ? { id, path: null, title, content, savedAt } : null
  if (!isAbsolutePath(id) || path !== id) return null
  return { id, path, title, content, savedAt }
}

/** Validate entries read back from disk: drop anything with the wrong shape, an `id` that
 *  is neither an absolute path nor `untitled:<digits>`, or a `path` that doesn't equal
 *  `id` for file entries. Never throws. Untitled entries must have a null `path`, each id
 *  is kept once, and the entries are fresh objects with only the known fields. */
export function sanitizeRecovered(input: unknown): RecoveryEntry[] {
  try {
    if (!Array.isArray(input)) return []
    const seen = new Set<string>()
    const out: RecoveryEntry[] = []
    for (const value of input) {
      const entry = sanitizeEntry(value)
      if (!entry || seen.has(entry.id)) continue
      seen.add(entry.id)
      out.push(entry)
    }
    return out
  } catch {
    // Hostile getters or proxies: recovering nothing beats crashing on launch.
    return []
  }
}
