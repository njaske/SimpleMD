// CONTRACT STUB (lane L implements). Which unsaved buffers to keep for crash recovery.
import type { RecoveryEntry } from '@shared/types'

/** Total characters of recovery text kept on disk; older/larger buffers are dropped first. */
export const MAX_RECOVERY_CHARS = 20 * 1024 * 1024

export interface BufferState {
  id: string
  path: string | null
  title: string
  content: string
  /** Last saved text; for an untitled document this is "" (so any text counts as unsaved). */
  saved: string
}

/** Entries for every buffer whose content differs from its saved text (untitled documents
 *  only when they are not empty/whitespace), stamped with `now`, keeping the total under
 *  MAX_RECOVERY_CHARS by dropping the largest buffers first. Order follows `buffers`. */
export function recoveryEntries(buffers: readonly BufferState[], now: number): RecoveryEntry[] {
  return buffers
    .filter((b) => b.content !== b.saved && (b.path !== null || b.content.trim() !== ''))
    .map((b) => ({ id: b.id, path: b.path, title: b.title, content: b.content, savedAt: now }))
}

/** Validate entries read back from disk: drop anything with the wrong shape, an `id` that
 *  is neither an absolute path nor `untitled:<digits>`, or a `path` that doesn't equal
 *  `id` for file entries. Never throws. */
export function sanitizeRecovered(input: unknown): RecoveryEntry[] {
  return Array.isArray(input) ? (input as RecoveryEntry[]) : []
}
