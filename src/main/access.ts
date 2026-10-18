import { realpathSync } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'

// Paths the user has granted through the main process: folders and files picked
// in an open dialog or dropped onto the window (resolved in the preload, so the
// page cannot invent them), plus those restored from settings at startup. File
// IPC refuses anything else, so even a compromised renderer cannot read, write,
// trash or reveal arbitrary files.

const files = new Set<string>()
const roots = new Set<string>()

function realOrNull(path: string): string | null {
  try {
    return realpathSync.native(path)
  } catch {
    return null
  }
}

/** Canonical comparison key: absolute, symlinks resolved, case-folded on Windows.
 *  A path that doesn't exist (yet, or any more after a rename) is keyed through its
 *  parent folder, so it still matches the key it had while it existed. */
function key(path: string): string {
  const full = resolve(path)
  const parent = dirname(full)
  const real =
    realOrNull(full) ?? (parent === full ? full : join(realOrNull(parent) ?? parent, basename(full)))
  return process.platform === 'win32' ? real.toLowerCase() : real
}

/** True when key `child` is key `parent` or lies inside it. */
function within(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** An absolute local path (UNC / network shares are never granted). */
export function isLocalAbsolute(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && isAbsolute(path) && !/^[\\/]{2}/.test(path)
}

export function approveFile(path: string): void {
  if (isLocalAbsolute(path)) files.add(key(path))
}

export function approveRoot(path: string): void {
  if (isLocalAbsolute(path)) roots.add(key(path))
}

/** Forget an individually approved file (trashed, or renamed away). */
export function revokeFile(path: string): void {
  if (isLocalAbsolute(path)) files.delete(key(path))
}

/** Forget every individually approved file at or under `path` (a trashed file
 *  or folder). Returns how many grants were dropped. */
export function revokeUnder(path: string): number {
  if (!isLocalAbsolute(path)) return 0
  const base = key(path)
  const gone = [...files].filter((file) => within(base, file))
  for (const file of gone) files.delete(file)
  return gone.length
}

/** Move individual file grants after a rename: the file itself, or every approved
 *  file under a renamed folder. Call it after the rename; returns how many moved. */
export function moveFileGrants(from: string, to: string): number {
  if (!isLocalAbsolute(from) || !isLocalAbsolute(to)) return 0
  const fromKey = key(from)
  const toKey = key(to)
  const moved = [...files].filter((file) => within(fromKey, file))
  for (const file of moved) {
    files.delete(file)
    files.add(toKey + file.slice(fromKey.length))
  }
  return moved.length
}

/** True when `path` is an individually approved file (not merely inside a root). */
export function isApprovedFile(path: unknown): path is string {
  return isLocalAbsolute(path) && files.has(key(path))
}

/** True when `path` is an approved root itself. */
export function isApprovedRoot(path: unknown): path is string {
  return isLocalAbsolute(path) && roots.has(key(path))
}

/** True when `path` is an approved root or inside one. Loose-file grants don't
 *  count: new files and folders may only be created inside a workspace. */
export function isInsideApprovedRoot(path: unknown): path is string {
  if (!isLocalAbsolute(path)) return false
  const k = key(path)
  for (const root of roots) if (within(root, k)) return true
  return false
}

/** True when an approved root is `path` or lies below it: renaming such a folder
 *  would leave that grant pointing at nothing. */
export function containsApprovedRoot(path: unknown): boolean {
  if (!isLocalAbsolute(path)) return false
  const k = key(path)
  for (const root of roots) if (within(k, root)) return true
  return false
}

/** True when `path` is an approved file, an approved root, or inside one. */
export function isApproved(path: unknown): path is string {
  if (!isLocalAbsolute(path)) return false
  return files.has(key(path)) || isInsideApprovedRoot(path)
}

/** Test helper: forget every grant. */
export function resetAccess(): void {
  files.clear()
  roots.clear()
}
