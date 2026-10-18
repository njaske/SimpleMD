import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { isAbsolute, join } from 'path'
import type { RecoveryEntry } from '../shared/types'

// Crash-recovery buffers: unsaved text the renderer hands over every few
// seconds, kept in `<userData>/recovery/session.json` until it is saved or
// discarded. Everything is validated on the way in and again on the way out,
// because the file outlives the process that wrote it.

export const MAX_RECOVERY_ENTRIES = 50
/** Text budget in UTF-16 characters (string length), the unit the renderer uses. */
export const MAX_RECOVERY_CHARS = 20 * 1024 * 1024
export const RECOVERY_FILE = 'session.json'
const FILE_VERSION = 1
const MAX_ID_LENGTH = 4096
const MAX_TITLE_LENGTH = 256
// A character is at most 3 UTF-8 bytes, or 6 when JSON escapes it (\u0001);
// a file bigger than that plus room for ids and titles isn't ours.
const MAX_FILE_BYTES = 6 * MAX_RECOVERY_CHARS + 4 * 1024 * 1024
const UNTITLED_ID = /^untitled:\d{1,9}$/

/** Decides whether a file entry's path may be kept (an access check on save). */
export type PathFilter = (path: string) => boolean

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLocalAbsolute(path: string): boolean {
  return isAbsolute(path) && !/^[\\/]{2}/.test(path)
}

/** One entry with exactly the expected shape, or null. File entries need
 *  `path === id`; untitled ones need an `untitled:<n>` id and a null path. */
export function sanitizeEntry(value: unknown, allowPath: PathFilter): RecoveryEntry | null {
  if (!isRecord(value)) return null
  const { id, path, title, content, savedAt } = value
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ID_LENGTH) return null
  if (typeof title !== 'string' || typeof content !== 'string') return null
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt < 0) return null
  if (path === null) {
    if (!UNTITLED_ID.test(id)) return null
  } else if (typeof path !== 'string' || path !== id || !isLocalAbsolute(path) || !allowPath(path)) {
    return null
  }
  return { id, path, title: title.slice(0, MAX_TITLE_LENGTH), content, savedAt }
}

/** Indexes to drop so the rest fit in `budget`: largest first, and the later of
 *  two equal sizes first. Same rule as the renderer's recoveryEntries, so a set
 *  it sends is never cut down differently here. */
function overBudget(sizes: readonly number[], budget: number): Set<number> {
  let total = sizes.reduce((sum, size) => sum + size, 0)
  const largestFirst = sizes
    .map((size, index) => ({ size, index }))
    .sort((a, b) => b.size - a.size || b.index - a.index)
  const dropped = new Set<number>()
  for (const { size, index } of largestFirst) {
    if (total <= budget) break
    dropped.add(index)
    total -= size
  }
  return dropped
}

/** Valid entries in order, without duplicate ids (the first wins), at most 50,
 *  within the character budget (the largest buffers are dropped first). */
export function sanitizeEntries(input: unknown, allowPath: PathFilter): RecoveryEntry[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const valid: RecoveryEntry[] = []
  for (const raw of input) {
    if (valid.length >= MAX_RECOVERY_ENTRIES) break
    const entry = sanitizeEntry(raw, allowPath)
    if (!entry || seen.has(entry.id)) continue
    seen.add(entry.id)
    valid.push(entry)
  }
  const dropped = overBudget(valid.map((entry) => entry.content.length), MAX_RECOVERY_CHARS)
  return valid.filter((_, index) => !dropped.has(index))
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await fs.unlink(path)
  } catch {
    // already gone
  }
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, data, { encoding: 'utf8', flag: 'wx' })
  } catch (err) {
    await removeQuietly(tmp)
    throw err
  }
  try {
    await fs.rename(tmp, path)
  } catch {
    // e.g. a virus scanner holding the old file on Windows: write in place.
    await removeQuietly(tmp)
    await fs.writeFile(path, data, 'utf8')
  }
}

// Saves are serialized so an older snapshot can never land after a newer one.
let queue: Promise<void> = Promise.resolve()

async function writeEntries(dir: string, entries: RecoveryEntry[]): Promise<void> {
  const file = join(dir, RECOVERY_FILE)
  if (entries.length === 0) {
    await removeQuietly(file)
    return
  }
  await fs.mkdir(dir, { recursive: true })
  await writeAtomic(file, JSON.stringify({ version: FILE_VERSION, entries }))
}

/** Replace the stored buffers with the valid part of `input`; an empty list
 *  deletes the file. Throws only when `input` isn't a list. */
export function saveRecovery(dir: string, input: unknown, allowPath: PathFilter): Promise<void> {
  if (!Array.isArray(input)) return Promise.reject(new Error('Invalid recovery data'))
  const entries = sanitizeEntries(input, allowPath)
  const run = queue.then(() => writeEntries(dir, entries))
  queue = run.catch(() => undefined)
  return run
}

/** The stored buffers, validated again. Never throws: a missing, oversized or
 *  corrupt file reads as "nothing to recover". */
export async function loadRecovery(dir: string): Promise<RecoveryEntry[]> {
  try {
    await queue
    const file = join(dir, RECOVERY_FILE)
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return []
    const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    if (!isRecord(parsed) || parsed.version !== FILE_VERSION) return []
    return sanitizeEntries(parsed.entries, () => true)
  } catch {
    return []
  }
}
