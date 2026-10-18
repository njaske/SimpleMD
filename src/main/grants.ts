import type { WebContents } from 'electron'
import { approveFile, approveRoot, isApprovedFile, moveFileGrants, revokeFile } from './access'
import { rebasePaths } from './file-ops'
import { addRecentFolder } from './recent-folders'
import { loadSettings, saveSettings } from './settings'
import { watchFolder } from './watcher'

// Granting access and keeping the persisted grants (`approvedFiles`,
// `lastFolder`, `recentFolders`) in step with the in-memory allow-list.

const MAX_APPROVED_FILES = 500
const caseInsensitive = process.platform === 'win32'

/** Grant and persist access to individually opened files (dialog, drop, Save As). */
export async function grantFiles(paths: string[]): Promise<void> {
  if (!paths.length) return
  paths.forEach(approveFile)
  const settings = await loadSettings()
  const merged = [...new Set([...paths, ...(settings.approvedFiles ?? [])])]
  await saveSettings({ approvedFiles: merged.slice(0, MAX_APPROVED_FILES) })
}

/** Grant access to a workspace folder, remember it as the last folder and at the
 *  top of the recent folders, and watch it when a window is given. */
export async function grantRoot(root: string, sender?: WebContents): Promise<void> {
  approveRoot(root)
  const settings = await loadSettings()
  await saveSettings({
    lastFolder: root,
    recentFolders: addRecentFolder(settings.recentFolders, root, caseInsensitive)
  })
  if (sender) watchFolder(root, sender)
}

/** Drop the grant of a file that was moved to the trash. */
export async function forgetFile(path: string): Promise<void> {
  if (!isApprovedFile(path)) return
  revokeFile(path)
  const settings = await loadSettings()
  const list = settings.approvedFiles ?? []
  const lower = path.toLowerCase()
  const kept = list.filter((p) => (caseInsensitive ? p.toLowerCase() !== lower : p !== path))
  if (kept.length !== list.length) await saveSettings({ approvedFiles: kept })
}

/** After a rename, individual grants (in memory and persisted) follow the file,
 *  or every file under a renamed folder. */
export async function moveGrants(from: string, to: string): Promise<void> {
  if (moveFileGrants(from, to) === 0) return
  const settings = await loadSettings()
  const list = settings.approvedFiles ?? []
  const next = rebasePaths(list, from, to, caseInsensitive)
  if (next.some((p, i) => p !== list[i])) await saveSettings({ approvedFiles: next })
}

/** Re-grant what the user opened in earlier sessions. Older settings files have
 *  no `approvedFiles`, so their loose files are trusted once to migrate; they
 *  also have no `recentFolders`, which then starts with the last folder. */
export async function restoreAccess(): Promise<void> {
  const settings = await loadSettings()
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
  if (Object.keys(migration).length) await saveSettings(migration)
}
