import { promises as fs, watch } from 'fs'
import { join } from 'path'
import { isScanIgnored, MAX_SCAN_DEPTH } from './fs-md'

// Folder watching where Node has no native recursive fs.watch (Linux). Node's
// fallback there reads and watches every file and folder synchronously,
// node_modules and .git included, which freezes the main process on a code
// repository and uses up the user's inotify watches. Instead this keeps one plain
// watch per folder the scanner would enter, capped, and re-reads the folder list
// when entries appear or disappear. No Electron imports, so it is unit-tested.

/** Folders watched at most; the shallowest win (inotify watches are a per-user budget). */
export const MAX_WATCHED_DIRS = 400
/** Coalesces a burst of creates and deletes into one re-read of the folder list. */
const RESYNC_DELAY_MS = 250

export interface WatchLimits {
  readonly maxDirs: number
  readonly maxDepth: number
}

export const DEFAULT_WATCH_LIMITS: WatchLimits = { maxDirs: MAX_WATCHED_DIRS, maxDepth: MAX_SCAN_DEPTH }

/** Names of the subfolders of `dir`. */
export type ListSubdirs = (dir: string) => Promise<readonly string[]>

export interface DirHandle {
  close(): void
}

/** Starts a non-recursive watch of `dir`. May throw (ENOSPC, ENOENT); `onError`
 *  runs when the watch fails later (the folder was removed, for example). */
export type WatchDir = (
  dir: string,
  onEvent: (event: string, filename: string | null) => void,
  onError: () => void
) => DirHandle

export interface TreeWatchOptions {
  readonly listSubdirs?: ListSubdirs
  readonly watchDir?: WatchDir
  readonly limits?: WatchLimits
  readonly resyncDelayMs?: number
}

export interface TreeWatcher {
  close(): void
  /** Resolves once scheduled folder-list updates have been applied. */
  settled(): Promise<void>
}

/** Windows and macOS watch a whole tree natively, with one OS handle. */
export function usesNativeRecursiveWatch(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/** Subfolder names of `dir`. Symlinks are not followed, like the scanner, so a
 *  link loop can't multiply watches. */
export async function readSubdirs(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

/** Folders to watch: the root, then every subfolder the scanner would enter (no
 *  dot-folders, node_modules, .git, build, ...) down to its depth. Breadth-first
 *  and sorted, so the cap keeps the shallowest folders, the same ones each time. */
export async function collectWatchDirs(
  root: string,
  listSubdirs: ListSubdirs,
  limits: WatchLimits = DEFAULT_WATCH_LIMITS
): Promise<string[]> {
  const found = [root]
  const depths = [0]
  for (let i = 0; i < found.length && found.length < limits.maxDirs; i++) {
    if (depths[i] >= limits.maxDepth) continue
    let names: readonly string[]
    try {
      names = await listSubdirs(found[i])
    } catch {
      continue // removed or unreadable meanwhile: nothing below it to watch
    }
    const kept = names.filter((name) => !isScanIgnored(name)).sort()
    for (const name of kept.slice(0, limits.maxDirs - found.length)) {
      found.push(join(found[i], name))
      depths.push(depths[i] + 1)
    }
  }
  return found
}

/** The watches to start and stop to go from `watched` to `wanted`. */
export function planWatchChanges(
  watched: Iterable<string>,
  wanted: readonly string[]
): { add: string[]; remove: string[] } {
  const current = new Set(watched)
  const next = new Set(wanted)
  return {
    add: [...next].filter((dir) => !current.has(dir)),
    remove: [...current].filter((dir) => !next.has(dir))
  }
}

const watchDirNative: WatchDir = (dir, onEvent, onError) => {
  const watcher = watch(dir, (event, filename) => onEvent(event, filename ?? null))
  watcher.on('error', onError)
  return watcher
}

function closeQuietly(handle: DirHandle): void {
  try {
    handle.close()
  } catch {
    // already closed
  }
}

/** The watches of one tree (see watchTree). Re-reads of the folder list run one
 *  at a time; a failed one keeps the current watches and the next change retries,
 *  so there is nothing to report. */
class DirTreeWatcher implements TreeWatcher {
  private readonly handles = new Map<string, DirHandle>()
  private closed = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private idle: Promise<void> = Promise.resolve()
  private release: (() => void) | null = null

  private readonly root: string
  private readonly onChange: () => void
  private readonly options: Required<TreeWatchOptions>

  // Plain fields, not parameter properties: tests load this file through Node's
  // type stripping, which only erases types.
  constructor(root: string, onChange: () => void, options: Required<TreeWatchOptions>) {
    this.root = root
    this.onChange = onChange
    this.options = options
    void this.run(false)
  }

  close(): void {
    this.closed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.release?.()
    this.release = null
    for (const dir of [...this.handles.keys()]) this.drop(dir)
  }

  settled(): Promise<void> {
    return this.idle.then(() => this.chain)
  }

  private readonly onEvent = (event: string, filename: string | null): void => {
    if (this.closed || (filename && isScanIgnored(filename))) return
    this.onChange()
    // A created, deleted or renamed entry may be a folder.
    if (event === 'rename') this.scheduleResync()
  }

  private drop(dir: string): void {
    const handle = this.handles.get(dir)
    if (!handle) return
    this.handles.delete(dir)
    closeQuietly(handle)
  }

  private start(dir: string): boolean {
    const onError = (): void => {
      this.drop(dir)
      this.scheduleResync()
    }
    try {
      this.handles.set(dir, this.options.watchDir(dir, this.onEvent, onError))
      return true
    } catch {
      return false // out of inotify watches, or already gone: retried on the next re-read
    }
  }

  private async resync(announce: boolean): Promise<void> {
    const wanted = await collectWatchDirs(this.root, this.options.listSubdirs, this.options.limits)
    if (this.closed) return
    const { add, remove } = planWatchChanges(this.handles.keys(), wanted)
    remove.forEach((dir) => this.drop(dir))
    const started = add.filter((dir) => this.start(dir))
    // Files written into a new folder before its watch started went unseen.
    if (announce && started.length) this.onChange()
  }

  private run(announce: boolean): Promise<void> {
    this.chain = this.chain.then(() => this.resync(announce)).catch(() => undefined)
    return this.chain
  }

  private scheduleResync(): void {
    if (this.closed) return
    if (this.timer) clearTimeout(this.timer)
    if (!this.release) {
      this.idle = new Promise((resolve) => {
        this.release = resolve
      })
    }
    this.timer = setTimeout(() => {
      this.timer = null
      const done = this.release
      this.release = null
      void this.run(true).then(() => done?.())
    }, this.options.resyncDelayMs)
  }
}

/** Watch `root` and the folders below it (see collectWatchDirs). `onChange`
 *  runs for every change the scan could see, and once more after watches start
 *  on new folders. */
export function watchTree(root: string, onChange: () => void, options: TreeWatchOptions = {}): TreeWatcher {
  return new DirTreeWatcher(root, onChange, {
    listSubdirs: options.listSubdirs ?? readSubdirs,
    watchDir: options.watchDir ?? watchDirNative,
    limits: options.limits ?? DEFAULT_WATCH_LIMITS,
    resyncDelayMs: options.resyncDelayMs ?? RESYNC_DELAY_MS
  })
}
