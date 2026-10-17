// Types shared across the main process, preload bridge, and renderer.

export type ThemeName = 'light' | 'dark'
export type ReadingFont = 'Sans' | 'Serif' | 'Mono'
export type Activity = 'files' | 'search' | 'pinned'
export type ViewMode = 'read' | 'split' | 'edit'

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

export interface Settings {
  theme: ThemeName
  accent: string
  readingFont: ReadingFont
  readingWidth: number
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
}

/** The bridge exposed on `window.api` by the preload script. */
export interface Api {
  openFolder: () => Promise<FolderScan | null>
  openFiles: () => Promise<OpenedFile[] | null>
  /** Files/folders passed on the command line at launch (double-click, "Open with"), once. */
  takeLaunchFiles: () => Promise<DropResult | null>
  /** Subscribe to files/folders opened from the shell while SimpleMD is already running. */
  onOpenPaths: (cb: (result: DropResult) => void) => () => void
  /** Open dropped files/folders. Paths are resolved in the preload from the real File objects. */
  resolveDrop: (files: File[]) => Promise<DropResult>
  scanFolder: (path: string) => Promise<FolderScan | null>
  readFile: (path: string) => Promise<string>
  saveFile: (path: string, content: string) => Promise<boolean>
  readImage: (docPath: string, src: string) => Promise<string | null>
  getSettings: () => Promise<Settings>
  setSettings: (partial: Partial<Settings>) => Promise<Settings>
  openExternal: (url: string) => Promise<void>
  /** Move a file or folder to the OS trash / Recycle Bin (recoverable). */
  trashItem: (path: string) => Promise<boolean>
  /** Show a file or folder in the OS file manager. */
  revealItem: (path: string) => Promise<void>
  exportPdf: (defaultName: string) => Promise<string | false>
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
  }
}
