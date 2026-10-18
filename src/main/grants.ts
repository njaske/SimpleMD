import type { WebContents } from 'electron'
import {
  forgetGrantsUnder,
  persistFileGrants,
  persistRootGrant,
  restoreGrants,
  type SettingsStore
} from './grant-store'
import { loadSettings, saveSettings } from './settings'
import { watchFolder } from './watcher'

// The grant operations bound to the app's settings file. The logic lives in
// grant-store (electron-free, unit-tested); this only wires in the real store
// and the folder watcher.

export const settingsStore: SettingsStore = { load: loadSettings, save: saveSettings }

/** Grant and persist access to individually opened files (dialog, drop, Save As). */
export function grantFiles(paths: string[]): Promise<void> {
  return persistFileGrants(settingsStore, paths)
}

/** Grant access to a workspace folder, remember it as the last and most recent
 *  folder, and watch it when a window is given. */
export async function grantRoot(root: string, sender?: WebContents): Promise<void> {
  await persistRootGrant(settingsStore, root)
  if (sender) watchFolder(root, sender)
}

/** Drop the grants of a file or folder that was moved to the trash. */
export function forgetPath(path: string): Promise<void> {
  return forgetGrantsUnder(settingsStore, path)
}

/** Re-grant what the user opened in earlier sessions (startup). */
export function restoreAccess(): Promise<void> {
  return restoreGrants(settingsStore)
}
