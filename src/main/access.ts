import { realpathSync } from 'fs'
import { isAbsolute, relative, resolve } from 'path'

// Paths the user has granted through the main process: folders and files picked
// in an open dialog or dropped onto the window (resolved in the preload, so the
// page cannot invent them), plus those restored from settings at startup. File
// IPC refuses anything else, so even a compromised renderer cannot read, write,
// trash or reveal arbitrary files.

const files = new Set<string>()
const roots = new Set<string>()

/** Canonical comparison key: absolute, symlinks resolved, case-folded on Windows. */
function key(path: string): string {
  let full = resolve(path)
  try {
    full = realpathSync.native(full)
  } catch {
    // keep the lexical path for files that do not exist (yet)
  }
  return process.platform === 'win32' ? full.toLowerCase() : full
}

function isLocalAbsolute(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && isAbsolute(path) && !/^[\\/]{2}/.test(path)
}

export function approveFile(path: string): void {
  if (isLocalAbsolute(path)) files.add(key(path))
}

export function approveRoot(path: string): void {
  if (isLocalAbsolute(path)) roots.add(key(path))
}

/** True when `path` is an approved root itself. */
export function isApprovedRoot(path: unknown): path is string {
  return isLocalAbsolute(path) && roots.has(key(path))
}

/** True when `path` is an approved file, an approved root, or inside one. */
export function isApproved(path: unknown): path is string {
  if (!isLocalAbsolute(path)) return false
  const k = key(path)
  if (files.has(k) || roots.has(k)) return true
  for (const root of roots) {
    const rel = relative(root, k)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return true
  }
  return false
}

/** Test helper: forget every grant. */
export function resetAccess(): void {
  files.clear()
  roots.clear()
}
