import { promises as fs } from 'fs'
import { resolve } from 'path'
import {
  approveFile,
  containsApprovedRoot,
  grantKey,
  isApproved,
  isApprovedRoot,
  isInsideApprovedRoot
} from './access'
import { writeAsset } from './assets'
import { createFile, createFolder, duplicateFile, renamePath } from './file-ops'
import { readMdFile, scanFolder } from './fs-md'
import { moveGrants, persistFileGrants, persistRootGrant, type SettingsStore } from './grant-store'
import { isRecentFolder, removeRecentFolder } from './recent-folders'
import { loadRecovery } from './recovery-store'
import type { FolderScan, OpenedFile, RecoveryEntry } from '../shared/types'

// The access decisions behind the workspace IPC handlers (create, rename,
// duplicate, pasted images, recent folders, recovery). No Electron imports and
// the settings store is passed in, so every allow/deny branch is unit-tested;
// ipc-workspace only adds dialogs and the folder watcher.

function denied(): never {
  throw new Error('Access denied: this path was not opened in SimpleMD')
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** A workspace folder new files and folders may be created in (never next to a
 *  loose file: those grants cover one file, not its folder). */
export async function assertWorkspaceFolder(dir: unknown): Promise<string> {
  if (!isInsideApprovedRoot(dir)) denied()
  if (!(await isDirectory(dir))) throw new Error('That folder no longer exists.')
  return resolve(dir)
}

export async function createFileIn(dir: unknown, name: unknown, content: unknown): Promise<OpenedFile> {
  const folder = await assertWorkspaceFolder(dir)
  const text = content === undefined || content === null ? '' : content
  if (typeof text !== 'string') throw new Error('Invalid content')
  return { path: await createFile(folder, name, text), content: text }
}

export async function createFolderIn(parent: unknown, name: unknown): Promise<string> {
  return createFolder(await assertWorkspaceFolder(parent), name)
}

/** Rename an approved file, or a folder inside a workspace. An open workspace
 *  folder (or one holding it) can't be renamed: its grant would point at nothing. */
export async function renameApproved(store: SettingsStore, path: unknown, newName: unknown): Promise<string> {
  if (!isApproved(path)) denied()
  if (isApprovedRoot(path) || containsApprovedRoot(path)) {
    throw new Error('This folder is open in SimpleMD, so it can’t be renamed here.')
  }
  const from = resolve(path)
  if ((await isDirectory(from)) && !isInsideApprovedRoot(from)) denied()
  // Keyed before the rename: afterwards a case-only rename on macOS makes the
  // old spelling resolve to the new one.
  const fromKey = grantKey(from)
  const to = await renamePath(from, newName)
  if (to !== from) await moveGrants(store, from, to, fromKey)
  return to
}

export async function duplicateApproved(store: SettingsStore, path: unknown): Promise<OpenedFile> {
  if (!isApproved(path)) denied()
  const copy = await duplicateFile(resolve(path))
  // A copy of a loose file sits outside any workspace, so it needs its own grant.
  if (!isInsideApprovedRoot(copy)) await persistFileGrants(store, [copy])
  return { path: copy, content: await readMdFile(copy) }
}

/** Save a pasted image next to an approved document; returns "assets/<name>". */
export async function writeImageAsset(docPath: unknown, fileName: unknown, data: unknown): Promise<string> {
  if (!isApproved(docPath)) denied()
  let isFile: boolean
  try {
    isFile = (await fs.stat(docPath)).isFile()
  } catch {
    throw new Error('This document no longer exists on disk. Save it first.')
  }
  // A folder (an approved root) is not a document: its parent is outside the grant.
  if (!isFile) denied()
  return writeAsset(resolve(docPath), fileName, data)
}

/** Re-open an exact entry of the recent-folders list; a folder that no longer
 *  exists is dropped from the list. The caller starts watching the result. */
export async function openRecentFolder(store: SettingsStore, path: unknown): Promise<FolderScan | null> {
  const settings = await store.load()
  if (!isRecentFolder(settings.recentFolders, path)) return null
  const scan = await scanFolder(path)
  if (!scan) {
    await store.save({ recentFolders: removeRecentFolder(settings.recentFolders, path) })
    return null
  }
  await persistRootGrant(store, path)
  return scan
}

/** `recovery:load`. The main process wrote these paths itself after an access
 *  check, so the first load of a run re-grants every one of them: a recovered file
 *  that was deleted or moved since can then be saved back where it was (the atomic
 *  save recreates it). Later loads don't: a grant revoked meanwhile (trash,
 *  rename) must stay revoked. */
export function recoveryLoader(dir: () => string): () => Promise<RecoveryEntry[]> {
  let regranted = false
  return async () => {
    const entries = await loadRecovery(dir())
    if (regranted) return entries
    regranted = true
    entries.forEach((entry) => {
      if (entry.path) approveFile(entry.path)
    })
    return entries
  }
}
