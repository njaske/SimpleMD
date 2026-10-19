import { watch, type FSWatcher } from 'fs'
import type { WebContents } from 'electron'
import { usesNativeRecursiveWatch, watchTree } from './dir-watch'
import { isScanIgnored } from './fs-md'

// A single active folder watcher. Uses the built-in fs.watch (no native deps) so
// the packaged app needs no extra node_modules. Windows and macOS watch the tree
// natively; elsewhere (Linux) dir-watch keeps a bounded watch per folder. Events
// are debounced and the renderer is told to reconcile — it owns the merge logic
// so unsaved edits are never clobbered.

let active: { close(): void } | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
const DEBOUNCE_MS = 300

export function stopWatching(): void {
  if (debounce) {
    clearTimeout(debounce)
    debounce = null
  }
  if (active) {
    try {
      active.close()
    } catch {
      // already closed
    }
    active = null
  }
}

/** One native recursive watch of the whole tree, or of the root alone where
 *  recursive watching is refused. */
function watchRecursive(root: string, notify: (filename: string | null) => void): FSWatcher | null {
  const listener = (_event: string, filename: string | null): void => notify(filename)
  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, listener)
  } catch {
    try {
      watcher = watch(root, listener)
    } catch {
      return null
    }
  }
  watcher.on('error', () => stopWatching())
  return watcher
}

export function watchFolder(root: string, sender: WebContents): void {
  stopWatching()

  const notify = (filename: string | null = null): void => {
    // Churn inside node_modules/.git/dot-dirs (and our own save temp files) can't
    // change the scan, so don't wake the renderer for it.
    if (filename && isScanIgnored(filename)) return
    if (debounce) clearTimeout(debounce)
    debounce = setTimeout(() => {
      if (!sender.isDestroyed()) sender.send('folder:changed')
    }, DEBOUNCE_MS)
  }

  active = usesNativeRecursiveWatch(process.platform)
    ? watchRecursive(root, notify)
    : watchTree(root, () => notify())
}
