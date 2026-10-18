import { approveFile, approveRoot, moveFileGrants, revokeUnder } from './access'
import { rebasePath, rebasePaths } from './file-ops'
import { addRecentFolder } from './recent-folders'
import type { Settings } from '../shared/types'

// Granting access and keeping the persisted grants (`approvedFiles`,
// `lastFolder`, `recentFolders`) in step with the in-memory allow-list. The
// settings store is passed in, so this runs (and is tested) without Electron.

/** Where grants are persisted: the main-process settings file in the app. */
export interface SettingsStore {
  load: () => Promise<Settings>
  save: (partial: Partial<Settings>) => Promise<unknown>
}

const MAX_APPROVED_FILES = 500
const caseInsensitive = process.platform === 'win32'

function persistedFiles(settings: Settings): string[] {
  return (settings.approvedFiles ?? []).filter((p): p is string => typeof p === 'string')
}

/** Grant and persist access to individually opened files (dialog, drop, Save As). */
export async function persistFileGrants(store: SettingsStore, paths: readonly string[]): Promise<void> {
  if (!paths.length) return
  paths.forEach(approveFile)
  const merged = [...new Set([...paths, ...persistedFiles(await store.load())])]
  await store.save({ approvedFiles: merged.slice(0, MAX_APPROVED_FILES) })
}

/** Grant access to a workspace folder and remember it as the last folder and
 *  at the top of the recent folders. */
export async function persistRootGrant(store: SettingsStore, root: string): Promise<void> {
  approveRoot(root)
  const settings = await store.load()
  await store.save({
    lastFolder: root,
    recentFolders: addRecentFolder(settings.recentFolders, root, caseInsensitive)
  })
}

/** Drop every individual grant at or under a trashed file or folder, in memory
 *  and in the persisted list (whatever its spelling). */
export async function forgetGrantsUnder(store: SettingsStore, path: string): Promise<void> {
  revokeUnder(path)
  const list = persistedFiles(await store.load())
  const kept = list.filter((p) => rebasePath(p, path, path, caseInsensitive) === null)
  if (kept.length !== list.length) await store.save({ approvedFiles: kept })
}

/** After a rename, individual grants (in memory and persisted) follow the file,
 *  or every file under a renamed folder. */
export async function moveGrants(store: SettingsStore, from: string, to: string): Promise<void> {
  moveFileGrants(from, to)
  const list = persistedFiles(await store.load())
  const next = rebasePaths(list, from, to, caseInsensitive)
  if (next.some((p, i) => p !== list[i])) await store.save({ approvedFiles: next })
}

/** Re-grant what the user opened in earlier sessions. Older settings files have
 *  no `approvedFiles`, so their loose files are trusted once to migrate; they
 *  also have no `recentFolders`, which then starts with the last folder. */
export async function restoreGrants(store: SettingsStore): Promise<void> {
  const settings = await store.load()
  const lastFolder = typeof settings.lastFolder === 'string' ? settings.lastFolder : null
  if (lastFolder) approveRoot(lastFolder)
  const migrating = !Array.isArray(settings.approvedFiles)
  const source = migrating ? settings.looseFiles : settings.approvedFiles
  const approved = Array.isArray(source) ? source.filter((p): p is string => typeof p === 'string') : []
  approved.forEach(approveFile)
  const migration = {
    ...(migrating ? { approvedFiles: approved } : {}),
    ...(!Array.isArray(settings.recentFolders) ? { recentFolders: lastFolder ? [lastFolder] : [] } : {})
  }
  if (Object.keys(migration).length) await store.save(migration)
}
