// Types shared across the main process, preload bridge, and renderer.

/** The theme the user picked. 'system' follows the OS light/dark setting. */
export type ThemeName = 'light' | 'dark' | 'sepia' | 'system'
/** The theme actually painted ('system' resolved to light or dark). */
export type ResolvedTheme = 'light' | 'dark' | 'sepia'
export type ReadingFont = 'Serif' | 'Sans' | 'Mono' | 'Hyperlegible'
export type Activity = 'files' | 'search' | 'pinned'
export type ViewMode = 'read' | 'split' | 'edit'
export type Platform = 'win32' | 'darwin' | 'linux'

/** A single Markdown file discovered on disk. `id` and `path` are the absolute path. */
export interface MdFileInfo {
  id: string
  name: string
  path: string
  dir: string
}

/** A directory that contains at least one Markdown file. */
export interface MdFolderInfo {
  id: string
  name: string
  path: string
  files: MdFileInfo[]
}

/** The result of scanning an opened root folder. */
export interface FolderScan {
  root: string
  name: string
  tree: MdFolderInfo[]
  /** Full text of every discovered file, keyed by absolute path. */
  contents: Record<string, string>
}

/** A single file opened individually (not via a folder scan). */
export interface OpenedFile {
  path: string
  content: string
}

/** Result of resolving a set of dropped paths into a folder and/or loose files. */
export interface DropResult {
  folder: FolderScan | null
  files: OpenedFile[]
}

/** One unsaved buffer kept on disk so it survives a crash. */
export interface RecoveryEntry {
  /** Document id in the renderer: an absolute path, or `untitled:<n>` for a new document. */
  id: string
  /** Absolute path of the file the buffer belongs to; null for an untitled document. */
  path: string | null
  /** Display name (file name, or the untitled document's title). */
  title: string
  /** The unsaved text. */
  content: string
  /** Epoch milliseconds when the buffer was captured. */
  savedAt: number
}

export interface Settings {
  theme: ThemeName
  accent: string
  readingFont: ReadingFont
  /** Max width of the reading column, px (480–1200). */
  readingWidth: number
  /** Body text size in the reader, px (13–26). */
  readingSize: number
  /** Body line height in the reader (1.3–2.2). */
  lineHeight: number
  /** Interface zoom factor (0.8–1.5). Applied by the main process to the whole window. */
  uiScale: number
  /** Turn off animations even when the OS doesn't ask for reduced motion. */
  reduceMotion: boolean
  /** Keep editor and preview scroll positions in step in Split view. */
  syncScroll: boolean
  /** Don't fetch http(s) images; show a placeholder with a "Load images" action instead. */
  blockRemoteImages: boolean
  showStatusBar: boolean
  sidebarOpen: boolean
  outlineOpen: boolean
  activity: Activity
  viewMode: ViewMode
  lastFolder: string | null
  pinned: string[]
  recents: string[]
  openTabs: string[]
  activeId: string | null
  /** Individually-opened files (outside the workspace folder), kept across sessions. */
  looseFiles: string[]
  /** Files the user granted access to (dialog or drop). Written by the main process only. */
  approvedFiles?: string[]
  /** Folders the user opened, most recent first. Written by the main process only. */
  recentFolders?: string[]
  /** Whether SimpleMD may ask GitHub once a day for the latest version number. */
  updateChecks: UpdateChecks
  /** When the last successful update check finished (ms since 1970), 0 if never. */
  lastUpdateCheck: number
  /** A version the user said Later to: no notice for it, only the dot on Settings. */
  skippedUpdate: string
}

/** `ask`: not decided yet (SimpleMD asks once). Checks are never automatic unless `on`. */
export type UpdateChecks = 'ask' | 'on' | 'off'

/** What an update check found. `url` is the release page on GitHub. */
export interface UpdateInfo {
  current: string
  latest: string
  available: boolean
  url: string
}

export type UpdateResult = { ok: true; info: UpdateInfo } | { ok: false; error: 'offline' | 'unavailable' }

/** The bridge exposed on `window.api` by the preload script. */
export interface Api {
  /** The OS SimpleMD runs on, for platform words, shortcut labels and window chrome. */
  platform: Platform

  openFolder: () => Promise<FolderScan | null>
  openFiles: () => Promise<OpenedFile[] | null>
  /** Re-open a folder from `settings.recentFolders` (the main process only accepts those). */
  openRecentFolder: (path: string) => Promise<FolderScan | null>
  /** Files/folders passed on the command line at launch (double-click, "Open with"), once. */
  takeLaunchFiles: () => Promise<DropResult | null>
  /** Subscribe to files/folders opened from the shell while SimpleMD is already running
   *  (second instance on Windows/Linux, `open-file` on macOS). */
  onOpenPaths: (cb: (result: DropResult) => void) => () => void
  /** Open dropped files/folders. Paths are resolved in the preload from the real File objects. */
  resolveDrop: (files: File[]) => Promise<DropResult>
  scanFolder: (path: string) => Promise<FolderScan | null>
  readFile: (path: string) => Promise<string>
  saveFile: (path: string, content: string) => Promise<boolean>
  readImage: (docPath: string, src: string) => Promise<string | null>

  /** Create a new Markdown file inside the open workspace. `name` is a bare file name;
   *  ".md" is added when it has no Markdown extension. Fails if the file exists. */
  createFile: (dir: string, name: string, content?: string) => Promise<OpenedFile>
  /** Create a folder inside the open workspace; returns its absolute path. */
  createFolder: (parent: string, name: string) => Promise<string>
  /** Rename a file or folder in place (`newName` is a bare name, no separators).
   *  Returns the new absolute path; access moves to the new path. */
  renamePath: (path: string, newName: string) => Promise<string>
  /** Copy a file next to itself as "name copy.md" (then "name copy 2.md", ...). */
  duplicateFile: (path: string) => Promise<OpenedFile>
  /** Show a Save dialog, write `content` to the chosen path and grant access to it.
   *  Returns the path, or null when the user cancels. */
  saveAs: (defaultName: string, content: string) => Promise<string | null>
  /** Save an image (pasted or dropped into the editor) into an `assets` folder next to the
   *  document. Returns the Markdown-ready relative path, e.g. "assets/screenshot-2.png". */
  writeAsset: (docPath: string, fileName: string, data: Uint8Array) => Promise<string>
  /** Show a Save dialog and write a standalone HTML export. Returns the path or false. */
  exportHtml: (defaultName: string, html: string) => Promise<string | false>
  exportPdf: (defaultName: string) => Promise<string | false>

  readClipboardText: () => Promise<string>
  /** Put rich text on the clipboard (pastes formatted into Docs, Word, email). */
  writeClipboardRich: (html: string, text: string) => Promise<void>

  /** Replace the stored crash-recovery buffers (an empty list clears them). */
  saveRecovery: (entries: RecoveryEntry[]) => Promise<void>
  /** Buffers left by a session that ended without saving them. */
  loadRecovery: () => Promise<RecoveryEntry[]>

  getSettings: () => Promise<Settings>
  setSettings: (partial: Partial<Settings>) => Promise<Settings>
  openExternal: (url: string) => Promise<void>
  /** Ask GitHub for the latest release (only when the user turned that on, or asked). */
  checkForUpdates: () => Promise<UpdateResult>
  /** Move a file or folder to the OS trash / Recycle Bin (recoverable). */
  trashItem: (path: string) => Promise<boolean>
  /** Show a file or folder in the OS file manager. */
  revealItem: (path: string) => Promise<void>
  /** Tell the main process whether there are unsaved edits (gates the close guard). */
  setUnsaved: (hasUnsaved: boolean) => Promise<void>
  /** Subscribe to "the opened folder changed on disk" notifications. Returns an unsubscribe fn. */
  onFolderChanged: (cb: () => void) => () => void
  /** Subscribe to a close request that was deferred because of unsaved edits. */
  onRequestClose: (cb: () => void) => () => void
  win: {
    minimize: () => Promise<void>
    maximizeToggle: () => Promise<boolean>
    close: () => Promise<void>
    /** Close the window bypassing the unsaved-changes guard. */
    forceClose: () => Promise<void>
    isMaximized: () => Promise<boolean>
    onMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void
    /** Interface zoom (0.8–1.5). */
    setZoom: (factor: number) => Promise<void>
    toggleFullScreen: () => Promise<boolean>
  }
}
