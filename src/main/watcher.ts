import { watch, type FSWatcher } from 'fs'
import type { WebContents } from 'electron'

// A single active folder watcher. Uses the built-in fs.watch (no native deps) so
// the packaged app needs no extra node_modules. Events are debounced and the
// renderer is told to reconcile — it owns the merge logic so unsaved edits are
// never clobbered.

let watcher: FSWatcher | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 300

export function stopWatching(): void {
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
  if (watcher) {
    try {
      watcher.close()
    } catch {
      // already closed
    }
    watcher = null
  }
}

export function watchFolder(root: string, sender: WebContents): void {
  stopWatching()

  const notify = (): void => {
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      if (!sender.isDestroyed()) sender.send('folder:changed')
    }, DEBOUNCE_MS)
  }

  try {
    watcher = watch(root, { recursive: true }, notify)
  } catch {
    // Recursive watching isn't supported everywhere (e.g. some Linux setups).
    // Fall back to a shallow watch of the root directory.
    try {
      watcher = watch(root, notify)
    } catch {
      watcher = null
      return
    }
  }
  watcher.on('error', () => stopWatching())
}
