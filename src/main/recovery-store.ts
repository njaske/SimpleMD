import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { isAbsolute, join } from 'path'
import type { RecoveryEntry } from '../shared/types'

// Crash-recovery buffers: unsaved text the renderer hands over every few
// seconds, kept in `<userData>/recovery/session.json` until it is saved or
// discarded. Everything is validated on the way in and again on the way out,
// because the file outlives the process that wrote it.

export const MAX_RECOVERY_ENTRIES = 50
export const MAX_RECOVERY_BYTES = 20 * 1024 * 1024
export const RECOVERY_FILE = 'session.json'
const FILE_VERSION = 1
const MAX_ID_LENGTH = 4096
const MAX_TITLE_LENGTH = 256
// JSON escaping can roughly double text size; anything bigger isn't ours.
const MAX_FILE_BYTES = 3 * MAX_RECOVERY_BYTES
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

/** Valid entries in order, without duplicate ids, within the count and size caps
 *  (an entry that would overflow the byte budget is skipped). */
export function sanitizeEntries(input: unknown, allowPath: PathFilter): RecoveryEntry[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const kept: RecoveryEntry[] = []
  let bytes = 0
  for (const raw of input) {
    if (kept.length >= MAX_RECOVERY_ENTRIES) break
    const entry = sanitizeEntry(raw, allowPath)
    if (!entry || seen.has(entry.id)) continue
    const size = Buffer.byteLength(entry.content, 'utf8') + Buffer.byteLength(entry.title, 'utf8')
    if (bytes + size > MAX_RECOVERY_BYTES) continue
    seen.add(entry.id)
    bytes += size
    kept.push(entry)
  }
  return kept
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
