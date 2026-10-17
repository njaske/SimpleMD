import { Component, createRef, lazy, Suspense } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'
import type {
  Activity,
  DropResult,
  FolderScan,
  MdFileInfo,
  MdFolderInfo,
  OpenedFile,
  ReadingFont,
  Settings,
  ThemeName,
  ViewMode
} from '@shared/types'
import { parseMarkdown, prepareMarkdown } from '@/lib/markdown'
import { highlightCode } from '@/lib/highlight'
import { computeOutline, computeStats, searchAll } from '@/lib/document'
import type { SearchableFile, SearchResult } from '@/lib/document'
import type { FolderItem, NamedFileRef, OutlineItem, TabItem } from '@/state/viewmodel'
import TitleBar from '@/components/TitleBar'
import ActivityBar from '@/components/ActivityBar'
import Sidebar from '@/components/Sidebar'
import Tabs from '@/components/Tabs'
import Toolbar from '@/components/Toolbar'
import Outline from '@/components/Outline'
import StatusBar from '@/components/StatusBar'
import EmptyState from '@/components/EmptyState'
import type { EditorJump } from '@/components/CodeEditor'
// The CodeMirror editor is only needed in Edit/Split view. Load it lazily so the
// (large) editor stack stays out of the startup chunk for read-only users.
const CodeEditor = lazy(() => import('@/components/CodeEditor'))
import ContextMenu, { type ContextMenuState, type MenuEntry } from '@/components/ContextMenu'
import { FolderPlusIcon } from '@/lib/icons'

interface ConfirmState {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
}

const MAX_AUTO_OPEN = 40
const MAX_RECENTS = 8
/** Settings writes are coalesced for this long after the last change. */
const PERSIST_DELAY_MS = 400
/** In split view the preview trails typing by this long (longer for huge docs). */
const LIVE_PREVIEW_DELAY_MS = 150
const LIVE_PREVIEW_DELAY_LARGE_MS = 400
const LARGE_DOC_CHARS = 200_000
/** Warm the lazy editor chunk this long after startup, off the critical path. */
const EDITOR_PREFETCH_DELAY_MS = 2000
const NO_SEARCH: SearchResult = { groups: [], total: 0, fileCount: 0 }
const READING_FONTS: Record<ReadingFont, string> = {
  Sans: "'Helvetica Neue',Helvetica,Arial,sans-serif",
  Serif: "'Iowan Old Style','Palatino Linotype',Palatino,Georgia,serif",
  Mono: 'var(--mono)'
}

let mermaidSeq = 0

/** Identity of what the reader last painted; a render is skipped while it matches. */
interface RenderKey {
  id: string | null
  mode: ViewMode
  theme: ThemeName
  md: string
}

/** Last path segment of a file/dir path (handles both / and \\). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || p
}
/** Parent directory of a path (handles both / and \\). */
function dirOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

interface FileMeta {
  name: string
  folderName: string
  dir: string
}

interface AppState {
  theme: ThemeName
  accent: string
  readingFont: ReadingFont
  readingWidth: number
  activity: Activity
  sidebarOpen: boolean
  outlineOpen: boolean
  viewMode: ViewMode
  expanded: Record<string, boolean>
  openTabs: string[]
  activeId: string | null
  searchQuery: string
  pinned: string[]
  recents: string[]
  prefsOpen: boolean
  contents: Record<string, string>
  saved: Record<string, string>
  tree: MdFolderInfo[]
  root: string | null
  rootName: string
  isMaximized: boolean
  statusNote: string | null
  ready: boolean
  closePrompt: boolean
  externalChanges: Record<string, boolean>
  editorJump: EditorJump | null
  looseFiles: MdFileInfo[]
  dragOver: boolean
  menu: ContextMenuState | null
  confirm: ConfirmState | null
}

export default class App extends Component<Record<string, never>, AppState> {
  private rootRef = createRef<HTMLDivElement>()
  private readerRef = createRef<HTMLDivElement>()
  private index = new Map<string, FileMeta>()
  private renderKey: RenderKey | null = null
  // Bumped on every real repaint so async work (images, mermaid) can tell its DOM is stale.
  private renderGen = 0
  private preparing = false
  private renderTimer: ReturnType<typeof setTimeout> | null = null
  private memos = new Map<string, { deps: readonly unknown[]; value: unknown }>()
  private scanning = false
  private rescanQueued = false
  private lastFile: string | null = null
  private unsubMax: (() => void) | null = null
  private unsubFolderChanged: (() => void) | null = null
  private unsubRequestClose: (() => void) | null = null
  private unsubOpenPaths: (() => void) | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private noteTimer: ReturnType<typeof setTimeout> | null = null
  private lastPersist = ''
  private lastReportedUnsaved = false
  private dragDepth = 0

  constructor(props: Record<string, never>) {
    super(props)
    this.state = {
      theme: 'dark',
      accent: '#c0392b',
      readingFont: 'Serif',
      readingWidth: 760,
      activity: 'files',
      sidebarOpen: true,
      outlineOpen: true,
      viewMode: 'read',
      expanded: {},
      openTabs: [],
      activeId: null,
      searchQuery: '',
      pinned: [],
      recents: [],
      prefsOpen: false,
      contents: {},
      saved: {},
      tree: [],
      root: null,
      rootName: '',
      isMaximized: false,
      statusNote: null,
      ready: false,
      closePrompt: false,
      externalChanges: {},
      editorJump: null,
      looseFiles: [],
      dragOver: false,
      menu: null,
      confirm: null
    }
    this.onKey = this.onKey.bind(this)
  }

  componentDidMount(): void {
    this.unsubMax = window.api.win.onMaximizeChange((v) => this.setState({ isMaximized: v }))
    window.api.win.isMaximized().then((v) => this.setState({ isMaximized: v }))
    this.unsubFolderChanged = window.api.onFolderChanged(() => this.reconcileFolder())
    this.unsubRequestClose = window.api.onRequestClose(() => this.setState({ closePrompt: true }))
    this.unsubOpenPaths = window.api.onOpenPaths(this.openResult)
    window.addEventListener('keydown', this.onKey)
    // Safety net so a cancelled/interrupted drag never leaves the overlay stuck.
    window.addEventListener('dragend', this.resetDrag)
    window.addEventListener('drop', this.resetDrag)
    // React never unmounts when the window closes, so flush on pagehide too.
    window.addEventListener('pagehide', this.flushPersist)
    this.bootstrap()
  }

  private flushPersist = (): void => {
    if (!this.persistTimer) return
    clearTimeout(this.persistTimer)
    this.persistTimer = null
    if (this.lastPersist) window.api.setSettings(JSON.parse(this.lastPersist))
  }

  componentWillUnmount(): void {
    window.removeEventListener('keydown', this.onKey)
    window.removeEventListener('dragend', this.resetDrag)
    window.removeEventListener('drop', this.resetDrag)
    window.removeEventListener('pagehide', this.flushPersist)
    this.unsubMax?.()
    this.unsubFolderChanged?.()
    this.unsubRequestClose?.()
    this.unsubOpenPaths?.()
    if (this.noteTimer) clearTimeout(this.noteTimer)
    if (this.renderTimer) clearTimeout(this.renderTimer)
    // Flush any pending settings write so nothing is lost on close.
    this.flushPersist()
  }

  componentDidUpdate(_props: unknown, prev: AppState): void {
    const s = this.state
    if (s.accent !== prev.accent || s.readingWidth !== prev.readingWidth || s.readingFont !== prev.readingFont) {
      this.applyProps()
    }
    this.renderDoc(false)
    if (
      s.theme !== prev.theme || s.accent !== prev.accent || s.readingFont !== prev.readingFont ||
      s.readingWidth !== prev.readingWidth || s.activity !== prev.activity ||
      s.sidebarOpen !== prev.sidebarOpen || s.outlineOpen !== prev.outlineOpen ||
      s.viewMode !== prev.viewMode || s.pinned !== prev.pinned || s.recents !== prev.recents ||
      s.openTabs !== prev.openTabs || s.activeId !== prev.activeId ||
      s.looseFiles !== prev.looseFiles || s.ready !== prev.ready
    ) {
      this.persist()
    }
    if (s.contents !== prev.contents || s.saved !== prev.saved) this.reportUnsaved()
  }

  /** Memoize a derived value on reference equality of its inputs, so typing in
   *  the editor doesn't rebuild the file tree, outline or search results. */
  private memo<T>(key: string, deps: readonly unknown[], compute: () => T): T {
    const hit = this.memos.get(key)
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => Object.is(d, deps[i]))) {
      return hit.value as T
    }
    const value = compute()
    this.memos.set(key, { deps, value })
    return value
  }

  private async bootstrap(): Promise<void> {
    const s = await window.api.getSettings()
    this.setState(
      {
        theme: s.theme,
        accent: s.accent,
        readingFont: s.readingFont,
        readingWidth: s.readingWidth,
        activity: s.activity,
        sidebarOpen: s.sidebarOpen,
        outlineOpen: s.outlineOpen,
        viewMode: s.viewMode,
        pinned: s.pinned,
        recents: s.recents,
        ready: true
      },
      () => {
        this.applyProps()
        this.renderDoc(true)
      }
    )
    // The three disk reads below are independent, so start them together and
    // apply the results in the original order.
    const looseRead = this.readLooseFiles(s.looseFiles)
    const folderScan = s.lastFolder
      ? window.api.scanFolder(s.lastFolder).catch(() => null)
      : Promise.resolve(null)
    const launchFiles = window.api.takeLaunchFiles().catch(() => null)

    // Restore individually-opened files into the tree (without reopening tabs;
    // the persisted openTabs already reference them).
    const valid = await looseRead
    const loosePaths = valid.map((x) => x.path)
    if (valid.length) this.addLooseFiles(valid, { open: false })

    if (s.lastFolder) {
      const scan = await folderScan
      if (scan) {
        this.applyScan(scan, {
          restoreTabs: s.openTabs,
          restoreActive: s.activeId,
          availablePaths: new Set(loosePaths)
        })
      }
    } else if (loosePaths.length) {
      // No workspace folder — restore just the loose-file tabs.
      this.setState(() => {
        const openTabs = s.openTabs.filter((p) => loosePaths.includes(p))
        const activeId = s.activeId && openTabs.includes(s.activeId) ? s.activeId : openTabs[0] ?? null
        return { openTabs, activeId }
      }, () => this.renderDoc(true))
    }

    // Files opened from the shell (double-click, "Open with") that started this
    // launch go on top of the restored session.
    const launched = await launchFiles
    if (launched) this.openResult(launched)

    // Warm the editor chunk once the first document is up, so the first switch
    // to Edit/Split doesn't wait on a ~1 MB parse.
    // Compiling it blocks the thread briefly, so wait for an idle moment too.
    setTimeout(
      () => requestIdleCallback(() => void import('@/components/CodeEditor'), { timeout: 10_000 }),
      EDITOR_PREFETCH_DELAY_MS
    )
  }

  private async readLooseFiles(paths: string[] | undefined): Promise<OpenedFile[]> {
    if (!paths || !paths.length) return []
    const items = await Promise.all(
      paths.map(async (p) => {
        try {
          return { path: p, content: await window.api.readFile(p) }
        } catch {
          return null
        }
      })
    )
    return items.filter((x): x is OpenedFile => x !== null)
  }

  private applyProps(): void {
    const r = this.rootRef.current
    if (!r) return
    r.style.setProperty('--accent', this.state.accent)
    r.style.setProperty('--read-width', this.state.readingWidth + 'px')
    r.style.setProperty('--read-font', READING_FONTS[this.state.readingFont])
  }

  private persist(): void {
    const s = this.state
    if (!s.ready) return
    const snapshot: Partial<Settings> = {
      theme: s.theme,
      accent: s.accent,
      readingFont: s.readingFont,
      readingWidth: s.readingWidth,
      activity: s.activity,
      sidebarOpen: s.sidebarOpen,
      outlineOpen: s.outlineOpen,
      viewMode: s.viewMode,
      pinned: s.pinned,
      recents: s.recents,
      openTabs: s.openTabs,
      activeId: s.activeId,
      looseFiles: s.looseFiles.map((f) => f.path)
    }
    const key = JSON.stringify(snapshot)
    if (key === this.lastPersist) return
    this.lastPersist = key
    if (this.persistTimer) clearTimeout(this.persistTimer)
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      window.api.setSettings(snapshot)
    }, PERSIST_DELAY_MS)
  }

  // ---- data helpers --------------------------------------------------------

  private fileMeta(id: string): NamedFileRef {
    const meta = this.index.get(id)
    if (meta) return { id, name: meta.name, folder: meta.folderName }
    const name = id.split(/[\\/]/).pop() || id
    return { id, name, folder: '' }
  }

  private contentOf(id: string | null): string {
    if (!id) return ''
    return this.state.contents[id] ?? ''
  }

  private isDirty(id: string): boolean {
    const c = this.state.contents[id]
    const saved = this.state.saved[id]
    return c !== undefined && saved !== undefined && c !== saved
  }

  private computeRecents(ids: string[], prev: string[]): string[] {
    const merged = [...ids, ...prev]
    return merged.filter((v, i) => merged.indexOf(v) === i).slice(0, MAX_RECENTS)
  }

  // ---- folder / file actions ----------------------------------------------

  private applyScan(
    scan: FolderScan,
    opts: {
      openAll?: boolean
      focusFiles?: boolean
      restoreTabs?: string[]
      restoreActive?: string | null
      availablePaths?: Set<string>
    }
  ): void {
    const expanded: Record<string, boolean> = {}
    scan.tree.forEach((folder, i) => {
      expanded[folder.id] = scan.tree.length <= 6 ? true : i < 3
    })

    const allFiles = scan.tree.flatMap((f) => f.files.map((x) => x.path))
    let openTabs: string[] = []
    let activeId: string | null = null
    let statusNote: string | null = null

    if (opts.restoreTabs && opts.restoreTabs.length) {
      openTabs = opts.restoreTabs.filter(
        (p) => scan.contents[p] !== undefined || opts.availablePaths?.has(p)
      )
      activeId =
        opts.restoreActive && openTabs.includes(opts.restoreActive)
          ? opts.restoreActive
          : openTabs[0] ?? null
    }
    if (opts.openAll) {
      openTabs = allFiles.slice(0, MAX_AUTO_OPEN)
      activeId = openTabs[0] ?? null
      if (allFiles.length > MAX_AUTO_OPEN) {
        statusNote = `Opened ${MAX_AUTO_OPEN} of ${allFiles.length} Markdown files`
      } else if (allFiles.length > 0) {
        statusNote = `Opened ${allFiles.length} Markdown file${allFiles.length === 1 ? '' : 's'}`
      }
    }
    if (!openTabs.length && allFiles.length) {
      openTabs = [allFiles[0]]
      activeId = allFiles[0]
    }

    this.setState(
      (prev) => ({
        tree: scan.tree,
        root: scan.root,
        rootName: scan.name,
        contents: { ...prev.contents, ...scan.contents },
        saved: { ...prev.saved, ...scan.contents },
        // Files now covered by the workspace shouldn't also linger as loose groups.
        looseFiles: prev.looseFiles.filter((f) => scan.contents[f.path] === undefined),
        expanded,
        openTabs,
        activeId,
        recents: this.computeRecents(activeId ? [activeId] : [], prev.recents),
        activity: opts.focusFiles ? 'files' : prev.activity,
        sidebarOpen: opts.focusFiles ? true : prev.sidebarOpen,
        prefsOpen: false,
        statusNote
      }),
      () => {
        this.renderDoc(true)
        this.flashNote()
      }
    )
  }

  private flashNote(): void {
    if (this.noteTimer) clearTimeout(this.noteTimer)
    if (!this.state.statusNote) return
    this.noteTimer = setTimeout(() => this.setState({ statusNote: null }), 2600)
  }

  private openFolderDialog = async (): Promise<void> => {
    const scan = await window.api.openFolder()
    if (scan) this.applyScan(scan, { openAll: true, focusFiles: true })
  }

  private openFilesDialog = async (): Promise<void> => {
    const files = await window.api.openFiles()
    if (files && files.length) this.addLooseFiles(files)
  }

  /** Register individually-opened files into the tree (grouped by directory).
   *  With { open: false } it only populates the tree/index without opening tabs. */
  private addLooseFiles = (files: OpenedFile[], opts: { open?: boolean } = {}): void => {
    if (!files.length) return
    const open = opts.open !== false
    this.setState(
      (s) => {
        const contents = { ...s.contents }
        const saved = { ...s.saved }
        const byPath = new Map(s.looseFiles.map((f) => [f.path, f]))
        const added: string[] = []
        for (const f of files) {
          contents[f.path] = f.content
          saved[f.path] = f.content
          if (!byPath.has(f.path)) {
            byPath.set(f.path, { id: f.path, name: baseName(f.path), path: f.path, dir: dirOf(f.path) })
          }
          added.push(f.path)
        }
        const looseFiles = [...byPath.values()]
        if (!open) {
          return {
            contents,
            saved,
            looseFiles,
            openTabs: s.openTabs,
            activeId: s.activeId,
            activity: s.activity,
            sidebarOpen: s.sidebarOpen,
            prefsOpen: s.prefsOpen,
            recents: s.recents,
            statusNote: s.statusNote
          }
        }
        const openTabs = [...s.openTabs]
        for (const p of added) if (!openTabs.includes(p)) openTabs.push(p)
        return {
          contents,
          saved,
          looseFiles,
          openTabs,
          activeId: added[added.length - 1] ?? s.activeId,
          activity: 'files' as Activity,
          sidebarOpen: true,
          prefsOpen: false,
          recents: this.computeRecents(added.slice().reverse(), s.recents),
          statusNote: `Opened ${added.length} file${added.length === 1 ? '' : 's'}`
        }
      },
      open ? this.flashNote.bind(this) : undefined
    )
  }

  // ---- drag & drop ---------------------------------------------------------

  private dragHasFiles(e: ReactDragEvent): boolean {
    return Array.from(e.dataTransfer?.types ?? []).includes('Files')
  }

  private onDragEnter = (e: ReactDragEvent): void => {
    if (!this.dragHasFiles(e)) return
    e.preventDefault()
    this.dragDepth++
    if (this.dragDepth === 1) this.setState({ dragOver: true })
  }

  private onDragOver = (e: ReactDragEvent): void => {
    if (!this.dragHasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  private onDragLeave = (): void => {
    if (this.dragDepth === 0) return
    this.dragDepth = Math.max(0, this.dragDepth - 1)
    if (this.dragDepth === 0) this.setState({ dragOver: false })
  }

  private resetDrag = (): void => {
    this.dragDepth = 0
    if (this.state.dragOver) this.setState({ dragOver: false })
  }

  private onDrop = async (e: ReactDragEvent): Promise<void> => {
    if (!this.dragHasFiles(e)) return
    e.preventDefault()
    this.dragDepth = 0
    this.setState({ dragOver: false })
    const files = Array.from(e.dataTransfer.files)
    if (!files.length) return
    const result = await window.api.resolveDrop(files)
    if (!result.folder && result.files.length === 0) {
      this.setState(
        { statusNote: 'Nothing to open — drop Markdown files or a folder' },
        this.flashNote.bind(this)
      )
      return
    }
    this.openResult(result)
  }

  /** Show what the main process resolved from a drop, a launch argument or
   *  a file opened from the shell. */
  private openResult = (result: DropResult): void => {
    if (result.folder) this.applyScan(result.folder, { openAll: true, focusFiles: true })
    if (result.files.length) this.addLooseFiles(result.files)
  }

  // ---- context menu & file management --------------------------------------

  private closeMenu = (): void => this.setState({ menu: null })

  private showFileMenu = (id: string, e: ReactMouseEvent): void => {
    e.preventDefault()
    const name = this.fileMeta(id).name
    const isLoose = this.state.looseFiles.some((f) => f.path === id)
    const isOpen = this.state.openTabs.includes(id)
    const pinned = this.state.pinned.includes(id)
    const items: MenuEntry[] = [
      { label: 'Open', onSelect: () => this.openFile(id) },
      { label: pinned ? 'Unpin' : 'Pin', onSelect: () => this.togglePin(id) }
    ]
    if (isOpen) items.push({ label: 'Close', onSelect: () => this.closeTab(id) })
    items.push(
      { separator: true },
      { label: 'Copy path', onSelect: () => this.copyPath(id) },
      { label: 'Reveal in File Explorer', onSelect: () => window.api.revealItem(id) }
    )
    if (isLoose) items.push({ label: 'Remove from sidebar', onSelect: () => this.removeFileFromState(id) })
    items.push(
      { separator: true },
      { label: 'Move to Recycle Bin', danger: true, onSelect: () => this.confirmTrashFile(id, name) }
    )
    this.setState({ menu: { x: e.clientX, y: e.clientY, items } })
  }

  private showFolderMenu = (folderId: string, e: ReactMouseEvent): void => {
    e.preventDefault()
    const isWorkspace = this.state.tree.some((fo) => fo.id === folderId)
    const name = baseName(folderId)
    const items: MenuEntry[] = [
      { label: 'Open all files', onSelect: () => this.openAllInFolder(folderId) },
      { separator: true },
      { label: 'Copy path', onSelect: () => this.copyPath(folderId) },
      { label: 'Reveal in File Explorer', onSelect: () => window.api.revealItem(folderId) },
      { separator: true },
      isWorkspace
        ? { label: 'Move folder to Recycle Bin', danger: true, onSelect: () => this.confirmTrashFolder(folderId, name) }
        : { label: 'Remove from sidebar', onSelect: () => this.removeLooseGroup(folderId) }
    ]
    this.setState({ menu: { x: e.clientX, y: e.clientY, items } })
  }

  private copyPath = (p: string): void => {
    navigator.clipboard?.writeText(p).catch(() => {})
    this.setState({ statusNote: 'Path copied' }, this.flashNote.bind(this))
  }

  private confirmTrashFile = (id: string, name: string): void =>
    this.setState({
      confirm: {
        title: 'Move to Recycle Bin?',
        message: `"${name}" will be moved to the Recycle Bin.`,
        confirmLabel: 'Move to Recycle Bin',
        danger: true,
        onConfirm: async () => {
          const ok = await window.api.trashItem(id)
          this.removeFileFromState(id)
          this.setState(
            { statusNote: ok ? `Moved ${name} to Recycle Bin` : `Could not delete ${name}` },
            this.flashNote.bind(this)
          )
        }
      }
    })

  private confirmTrashFolder = (folderId: string, name: string): void =>
    this.setState({
      confirm: {
        title: 'Move folder to Recycle Bin?',
        message: `"${name}" and all its files will be moved to the Recycle Bin.`,
        confirmLabel: 'Move to Recycle Bin',
        danger: true,
        onConfirm: async () => {
          const ok = await window.api.trashItem(folderId)
          // The file watcher reconciles the tree once the folder is gone.
          this.setState(
            { statusNote: ok ? `Moved ${name} to Recycle Bin` : `Could not delete ${name}` },
            this.flashNote.bind(this)
          )
        }
      }
    })

  private removeFileFromState = (id: string): void =>
    this.setState((s) => {
      const contents = { ...s.contents }
      delete contents[id]
      const saved = { ...s.saved }
      delete saved[id]
      const externalChanges = { ...s.externalChanges }
      delete externalChanges[id]
      const idx = s.openTabs.indexOf(id)
      const openTabs = s.openTabs.filter((t) => t !== id)
      let activeId = s.activeId
      if (activeId === id) activeId = openTabs[idx] || openTabs[idx - 1] || openTabs[openTabs.length - 1] || null
      return {
        contents,
        saved,
        externalChanges,
        openTabs,
        activeId,
        pinned: s.pinned.filter((p) => p !== id),
        recents: s.recents.filter((r) => r !== id),
        looseFiles: s.looseFiles.filter((f) => f.path !== id)
      }
    })

  private removeLooseGroup = (dir: string): void => {
    this.state.looseFiles
      .filter((f) => f.dir === dir)
      .forEach((f) => this.removeFileFromState(f.path))
  }

  private cancelConfirm = (): void => this.setState({ confirm: null })

  private runConfirm = (): void => {
    const c = this.state.confirm
    this.setState({ confirm: null }, () => {
      c?.onConfirm()
    })
  }

  private openFile = async (id: string): Promise<void> => {
    if (this.state.contents[id] === undefined) {
      try {
        const c = await window.api.readFile(id)
        this.setState((s) => ({ contents: { ...s.contents, [id]: c }, saved: { ...s.saved, [id]: c } }))
      } catch {
        // File missing/unreadable (e.g. a stale pinned/recent entry): tell the
        // user and don't open a blank tab or promote it to recents.
        this.setState({ statusNote: `Could not open ${baseName(id)} — file missing or unreadable` }, this.flashNote.bind(this))
        return
      }
    }
    this.setState((s) => ({
      openTabs: s.openTabs.includes(id) ? s.openTabs : [...s.openTabs, id],
      activeId: id,
      recents: [id, ...s.recents.filter((r) => r !== id)].slice(0, MAX_RECENTS)
    }))
  }

  private setActive = (id: string): void => this.setState({ activeId: id })

  private closeTab = (id: string): void =>
    this.setState((s) => {
      const idx = s.openTabs.indexOf(id)
      const openTabs = s.openTabs.filter((t) => t !== id)
      let activeId = s.activeId
      if (activeId === id) {
        activeId = openTabs[idx] || openTabs[idx - 1] || openTabs[openTabs.length - 1] || null
      }
      return { openTabs, activeId }
    })

  private toggleFolder = (id: string): void =>
    this.setState((s) => ({ expanded: { ...s.expanded, [id]: !(s.expanded[id] ?? true) } }))

  private openAllInFolder = (folderId: string): void => {
    // A group may be a workspace folder, a loose-file group, or both.
    const treeFolder = this.state.tree.find((f) => f.id === folderId)
    const looseInDir = this.state.looseFiles.filter((f) => f.dir === folderId)
    const ids = [
      ...(treeFolder ? treeFolder.files.map((f) => f.path) : []),
      ...looseInDir.map((f) => f.path).filter((p) => !treeFolder?.files.some((tf) => tf.path === p))
    ]
    if (!ids.length) return
    const name = treeFolder ? treeFolder.name : baseName(folderId)
    this.setState((s) => {
      const openTabs = [...s.openTabs]
      ids.forEach((p) => {
        if (!openTabs.includes(p)) openTabs.push(p)
      })
      return {
        openTabs,
        activeId: ids[0] ?? s.activeId,
        expanded: { ...s.expanded, [folderId]: true },
        activity: 'files',
        sidebarOpen: true,
        recents: this.computeRecents(ids.slice().reverse(), s.recents),
        statusNote: `Opened ${ids.length} file${ids.length === 1 ? '' : 's'} from ${name}`
      }
    }, this.flashNote.bind(this))
  }

  private togglePin = (id: string): void =>
    this.setState((s) => ({
      pinned: s.pinned.includes(id) ? s.pinned.filter((p) => p !== id) : [...s.pinned, id]
    }))

  private toggleTheme = (): void => this.setState((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' }))
  private toggleSidebar = (): void => this.setState((s) => ({ sidebarOpen: !s.sidebarOpen }))
  private toggleOutline = (): void => this.setState((s) => ({ outlineOpen: !s.outlineOpen }))
  private togglePrefs = (): void => this.setState((s) => ({ prefsOpen: !s.prefsOpen }))

  private setActivity = (a: Activity): void =>
    this.setState((s) => ({ activity: a, sidebarOpen: s.activity === a ? !s.sidebarOpen : true, prefsOpen: false }))

  private setView = (v: ViewMode): void => this.setState({ viewMode: v })
  private onSearch = (value: string): void => this.setState({ searchQuery: value })

  private onEditorChange = (value: string): void =>
    this.setState((s) => (s.activeId ? { contents: { ...s.contents, [s.activeId]: value } } : null))

  private setAccent = (value: string): void => this.setState({ accent: value })
  private setFont = (value: ReadingFont): void => this.setState({ readingFont: value })
  private setWidth = (value: number): void => this.setState({ readingWidth: value })

  private saveActive = async (): Promise<void> => {
    const id = this.state.activeId
    if (!id) return
    const content = this.state.contents[id]
    if (content === undefined || this.state.saved[id] === content) return
    try {
      await window.api.saveFile(id, content)
      this.setState((s) => ({ saved: { ...s.saved, [id]: content } }))
    } catch {
      this.setState({ statusNote: 'Could not save file' }, this.flashNote.bind(this))
    }
  }

  // ---- unsaved-changes tracking & close guard ------------------------------

  private hasUnsavedChanges(): boolean {
    const { contents, saved } = this.state
    return Object.keys(contents).some((id) => saved[id] !== undefined && contents[id] !== saved[id])
  }

  private unsavedFiles(): string[] {
    const { contents, saved } = this.state
    return Object.keys(contents).filter((id) => saved[id] !== undefined && contents[id] !== saved[id])
  }

  private reportUnsaved(): void {
    const has = this.hasUnsavedChanges()
    if (has !== this.lastReportedUnsaved) {
      this.lastReportedUnsaved = has
      window.api.setUnsaved(has)
    }
  }

  private saveAll = async (): Promise<void> => {
    for (const id of this.unsavedFiles()) {
      const content = this.state.contents[id]
      try {
        await window.api.saveFile(id, content)
        this.setState((s) => ({ saved: { ...s.saved, [id]: content } }))
      } catch {
        // keep dirty on failure
      }
    }
  }

  private confirmSaveAndClose = async (): Promise<void> => {
    await this.saveAll()
    window.api.win.forceClose()
  }

  private confirmDiscardAndClose = (): void => {
    window.api.win.forceClose()
  }

  private cancelClose = (): void => this.setState({ closePrompt: false })

  // ---- external change reconciliation (file watching) ----------------------

  private reconcileFolder = async (): Promise<void> => {
    // One re-scan at a time; changes that land mid-scan trigger a single follow-up.
    if (this.scanning) {
      this.rescanQueued = true
      return
    }
    const root = this.state.root
    if (!root) return
    this.scanning = true
    let scan: FolderScan | null = null
    try {
      scan = await window.api.scanFolder(root)
    } finally {
      this.scanning = false
    }
    if (this.rescanQueued) {
      this.rescanQueued = false
      void this.reconcileFolder()
    }
    if (!scan) return
    this.applyReconcile(scan)
  }

  private applyReconcile(scan: FolderScan): void {
    this.setState((s) => {
      const contents = { ...s.contents }
      const saved = { ...s.saved }
      const externalChanges = { ...s.externalChanges }
      let reloaded = 0
      for (const [id, diskText] of Object.entries(scan.contents)) {
        const cur = contents[id]
        const base = saved[id]
        const dirty = cur !== undefined && base !== undefined && cur !== base
        if (dirty) {
          // Don't clobber unsaved edits — flag a conflict if disk diverged.
          if (diskText !== base) externalChanges[id] = true
        } else {
          if (cur !== diskText) reloaded++
          contents[id] = diskText
          saved[id] = diskText
          delete externalChanges[id]
        }
      }

      // Remove workspace files that vanished from disk (unless edited or loose).
      const looseSet = new Set(s.looseFiles.map((f) => f.path))
      let removed = 0
      for (const folder of s.tree) {
        for (const file of folder.files) {
          const p = file.path
          if (scan.contents[p] !== undefined || looseSet.has(p)) continue
          const dirty = contents[p] !== undefined && saved[p] !== undefined && contents[p] !== saved[p]
          if (dirty) {
            externalChanges[p] = true // keep unsaved edits; flag the conflict
            continue
          }
          delete contents[p]
          delete saved[p]
          delete externalChanges[p]
          removed++
        }
      }
      let openTabs = s.openTabs
      let activeId = s.activeId
      if (removed > 0) {
        openTabs = s.openTabs.filter((p) => contents[p] !== undefined || looseSet.has(p))
        if (activeId && contents[activeId] === undefined && !looseSet.has(activeId)) {
          activeId = openTabs[0] ?? null
        }
      }

      const statusNote =
        reloaded > 0
          ? `Reloaded ${reloaded} file${reloaded === 1 ? '' : 's'} changed on disk`
          : removed > 0
            ? `${removed} file${removed === 1 ? '' : 's'} removed on disk`
            : s.statusNote
      return { tree: scan.tree, contents, saved, externalChanges, openTabs, activeId, statusNote }
    }, this.flashNote.bind(this))
  }

  private reloadFromDisk = async (id: string): Promise<void> => {
    try {
      const text = await window.api.readFile(id)
      this.setState((s) => {
        const externalChanges = { ...s.externalChanges }
        delete externalChanges[id]
        return {
          contents: { ...s.contents, [id]: text },
          saved: { ...s.saved, [id]: text },
          externalChanges
        }
      })
    } catch {
      // ignore unreadable file
    }
  }

  private dismissExternalChange = (id: string): void =>
    this.setState((s) => {
      const externalChanges = { ...s.externalChanges }
      delete externalChanges[id]
      return { externalChanges }
    })

  private exportPdf = (): void => {
    const meta = this.state.activeId ? this.fileMeta(this.state.activeId) : null
    this.setState({ viewMode: 'read', prefsOpen: false }, () => {
      setTimeout(() => window.api.exportPdf(meta ? meta.name : 'document'), 220)
    })
  }

  private scrollToHeading = (slug: string): void => {
    const el = this.readerRef.current
    if (!el) return
    try {
      const target = el.querySelector<HTMLElement>('#' + CSS.escape(slug))
      if (target) el.scrollTo({ top: Math.max(0, target.offsetTop - 16), behavior: 'smooth' })
    } catch {
      // invalid selector — ignore
    }
  }

  private gotoMatch = (id: string, line: number, col: number, len: number): void => {
    this.openFile(id)
    this.setState((s) => ({
      viewMode: 'edit',
      editorJump: { fileId: id, line, col, len, nonce: (s.editorJump?.nonce ?? 0) + 1 }
    }))
  }

  private onReaderClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (!href) return
    if (href.startsWith('#')) {
      e.preventDefault()
      this.scrollToHeading(href.slice(1))
      return
    }
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault()
      window.api.openExternal(href)
      return
    }
    e.preventDefault()
    this.tryOpenRelative(href)
  }

  private tryOpenRelative(href: string): void {
    const norm = href.replace(/^\.\//, '').replace(/\\/g, '/').split('#')[0]
    for (const path of this.index.keys()) {
      const p = path.replace(/\\/g, '/')
      if (p === norm || p.endsWith('/' + norm)) {
        this.openFile(path)
        return
      }
    }
  }

  private onKey(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey
    if (mod) {
      const k = (e.key || '').toLowerCase()
      if (k === 'f') {
        // Inside the editor, let CodeMirror handle find-in-document.
        if (document.activeElement?.closest('.cm-editor')) return
        e.preventDefault()
        this.setState({ activity: 'search', sidebarOpen: true })
        setTimeout(() => {
          const input = document.getElementById('smd-search-input') as HTMLInputElement | null
          input?.focus()
          input?.select()
        }, 50)
        return
      }
      if (k === 'b') {
        e.preventDefault()
        this.toggleSidebar()
        return
      }
      if (k === '\\') {
        e.preventDefault()
        this.toggleOutline()
        return
      }
      if (k === 'd' && e.shiftKey) {
        e.preventDefault()
        this.toggleTheme()
        return
      }
      if (k === 's') {
        e.preventDefault()
        this.saveActive()
        return
      }
      if (k === 'w') {
        e.preventDefault()
        if (this.state.activeId) this.closeTab(this.state.activeId)
        return
      }
      if (k === 'p') {
        e.preventDefault()
        this.exportPdf()
        return
      }
    }
    if (e.key === 'Escape') {
      if (this.state.prefsOpen) this.setState({ prefsOpen: false })
      else if (this.state.confirm) this.cancelConfirm()
      else if (this.state.closePrompt) this.cancelClose()
    }
  }

  // ---- imperative reader rendering -----------------------------------------

  private renderDoc(force: boolean): void {
    const el = this.readerRef.current
    if (!el) return
    const id = this.state.activeId
    const md = this.contentOf(id)
    const mode = this.state.viewMode
    const theme = this.state.theme
    const last = this.renderKey
    const sameView = !!last && last.id === id && last.mode === mode && last.theme === theme
    const needsFill = el.childElementCount === 0
    if (!force && !needsFill && sameView && last.md === md) return

    // While typing in split view, let the preview trail the keystrokes instead
    // of re-parsing the whole document on each one.
    if (!force && !needsFill && sameView && mode === 'split') {
      if (this.renderTimer) clearTimeout(this.renderTimer)
      const delay = md.length > LARGE_DOC_CHARS ? LIVE_PREVIEW_DELAY_LARGE_MS : LIVE_PREVIEW_DELAY_MS
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null
        this.renderDoc(true)
      }, delay)
      return
    }

    // KaTeX / highlight.js load on demand; wait for them so the first paint of
    // a document that needs them is already correct.
    const pending = id ? prepareMarkdown(md) : null
    if (pending) {
      // One re-render once the chunks arrive, however many updates came meanwhile.
      if (!this.preparing) {
        this.preparing = true
        void pending.then(() => {
          this.preparing = false
          this.renderDoc(true)
        })
      }
      return
    }

    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = null
    }
    this.renderKey = { id, mode, theme, md }
    const myGen = ++this.renderGen
    if (!id) {
      el.innerHTML = ''
      this.lastFile = null
      return
    }
    const changedFile = this.lastFile !== id
    const html = parseMarkdown(md)
    const outline = computeOutline(md)
    // Build the article inside an inert <template> so <img> tags in the document
    // are never fetched (enhanceImages swaps them out); it's attached once ready.
    const tpl = document.createElement('template')
    tpl.innerHTML = '<div class="smd-article' + (changedFile ? ' smd-fade' : '') + '">' + html + '</div>'
    const article = tpl.content.firstElementChild as HTMLElement | null
    if (!article) return

    article.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => {
      if (outline[i]) (h as HTMLElement).id = outline[i].slug
    })
    this.enhanceImages(article, id, myGen)

    // Pull mermaid blocks out before highlighting so hljs/copy buttons skip them.
    const mermaidJobs: { container: HTMLElement; source: string }[] = []
    article.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach((code) => {
      const pre = code.parentElement
      if (!pre) return
      const container = document.createElement('div')
      container.className = 'smd-mermaid'
      pre.replaceWith(container)
      mermaidJobs.push({ container, source: code.textContent || '' })
    })

    article.querySelectorAll<HTMLElement>('pre code[class*="language-"]').forEach((code) => {
      try {
        highlightCode(code)
      } catch {
        // unknown language — leave as plain text
      }
    })
    article.querySelectorAll<HTMLElement>('pre').forEach((pre) => this.addCopyButton(pre))

    el.replaceChildren(article)
    if (mermaidJobs.length) this.renderMermaid(mermaidJobs, myGen)

    if (changedFile) {
      el.scrollTop = 0
      this.lastFile = id
    }
  }

  private enhanceImages(article: HTMLElement, docPath: string, myGen: number): void {
    article.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || ''
      const alt = img.getAttribute('alt') || ''
      const remote = /^(https?:|data:)/i.test(src)
      const figure = document.createElement('figure')
      figure.className = 'smd-img'

      if (remote) {
        const real = document.createElement('img')
        real.src = src
        real.alt = alt
        figure.appendChild(real)
      } else {
        const placeholder = document.createElement('div')
        placeholder.className = 'smd-imgph'
        const span = document.createElement('span')
        span.textContent = alt || src || 'image'
        placeholder.appendChild(span)
        figure.appendChild(placeholder)
      }
      if (alt) {
        const caption = document.createElement('figcaption')
        caption.textContent = alt
        figure.appendChild(caption)
      }
      img.replaceWith(figure)

      if (!remote) {
        window.api
          .readImage(docPath, src)
          .then((dataUrl) => {
            if (this.renderGen !== myGen || !figure.isConnected || !dataUrl) return
            const real = document.createElement('img')
            real.src = dataUrl
            real.alt = alt
            const placeholder = figure.querySelector('.smd-imgph')
            if (placeholder) placeholder.replaceWith(real)
          })
          .catch(() => {})
      }
    })
  }

  private addCopyButton(pre: HTMLElement): void {
    const button = document.createElement('button')
    button.className = 'smd-copy'
    button.type = 'button'
    button.textContent = 'Copy'
    button.addEventListener('click', () => {
      const code = pre.querySelector('code')
      const text = code ? code.innerText : ''
      navigator.clipboard?.writeText(text).catch(() => {})
      button.textContent = 'Copied'
      setTimeout(() => {
        button.textContent = 'Copy'
      }, 1200)
    })
    pre.appendChild(button)
  }

  private async renderMermaid(
    jobs: { container: HTMLElement; source: string }[],
    myGen: number
  ): Promise<void> {
    let mermaid
    try {
      mermaid = (await import('mermaid')).default
    } catch {
      return // mermaid chunk failed to load; leave placeholders empty
    }
    if (this.renderGen !== myGen) return
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: this.state.theme === 'dark' ? 'dark' : 'default',
      fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif"
    })
    for (const job of jobs) {
      if (this.renderGen !== myGen) return
      if (!job.container.isConnected) continue
      try {
        const { svg } = await mermaid.render('smd-mmd-' + ++mermaidSeq, job.source)
        if (this.renderGen !== myGen || !job.container.isConnected) return
        job.container.innerHTML = svg
      } catch {
        // Invalid diagram — fall back to showing the source with a small note.
        job.container.className = 'smd-mermaid smd-mermaid-error'
        const note = document.createElement('div')
        note.className = 'smd-mermaid-note'
        note.textContent = 'Could not render this diagram'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = job.source
        pre.appendChild(code)
        job.container.replaceChildren(note, pre)
      }
    }
  }

  // ---- render --------------------------------------------------------------

  render() {
    const s = this.state
    const isDark = s.theme === 'dark'
    const activeId = s.activeId
    const af = activeId ? this.fileMeta(activeId) : null
    const hasTabs = s.openTabs.length > 0
    const activeMd = this.contentOf(activeId)

    // Build the file index from the workspace tree + individually-opened files.
    const index = this.memo('index', [s.tree, s.looseFiles], () => {
      const map = new Map<string, FileMeta>()
      for (const folder of s.tree) {
        for (const f of folder.files) map.set(f.path, { name: f.name, folderName: folder.name, dir: f.dir })
      }
      for (const lf of s.looseFiles) {
        if (!map.has(lf.path)) map.set(lf.path, { name: lf.name, folderName: baseName(lf.dir), dir: lf.dir })
      }
      return map
    })
    this.index = index

    // Merge workspace folders with loose files, grouped by directory (VS Code-like).
    const folders = this.memo('folders', [s.tree, s.looseFiles, s.expanded, s.pinned, activeId], () => {
      const pinnedSet = new Set(s.pinned)
      const fileItem = (path: string, name: string): FolderItem['files'][number] => ({
        id: path,
        name,
        active: path === activeId,
        pinned: pinnedSet.has(path)
      })
      const folderById = new Map<string, FolderItem>()
      const folderOrder: string[] = []
      for (const folder of s.tree) {
        folderById.set(folder.id, {
          id: folder.id,
          name: folder.name,
          expanded: s.expanded[folder.id] ?? true,
          files: folder.files.map((f) => fileItem(f.path, f.name))
        })
        folderOrder.push(folder.id)
      }
      const present = new Map<string, Set<string>>()
      for (const [gid, group] of folderById) present.set(gid, new Set(group.files.map((f) => f.id)))
      for (const lf of s.looseFiles) {
        let group = folderById.get(lf.dir)
        if (!group) {
          group = { id: lf.dir, name: baseName(lf.dir), expanded: s.expanded[lf.dir] ?? true, files: [] }
          folderById.set(lf.dir, group)
          folderOrder.push(lf.dir)
          present.set(lf.dir, new Set())
        }
        const ids = present.get(lf.dir)!
        if (!ids.has(lf.path)) {
          group.files.push(fileItem(lf.path, lf.name))
          ids.add(lf.path)
        }
      }
      return folderOrder.map((id) => folderById.get(id)!)
    })

    const tabs: TabItem[] = s.openTabs.map((id) => {
      const meta = this.fileMeta(id)
      return { id, name: meta.name, active: id === activeId, pinned: s.pinned.includes(id), dirty: this.isDirty(id) }
    })

    const searchResult: SearchResult =
      s.activity === 'search'
        ? this.memo('search', [s.searchQuery, s.tree, s.looseFiles, s.contents], () => {
            const files: SearchableFile[] = []
            const seen = new Set<string>()
            for (const folder of s.tree) {
              for (const f of folder.files) {
                seen.add(f.path)
                files.push({ id: f.path, name: f.name, folderName: folder.name, content: s.contents[f.path] ?? '' })
              }
            }
            for (const lf of s.looseFiles) {
              if (!seen.has(lf.path)) {
                files.push({ id: lf.path, name: lf.name, folderName: baseName(lf.dir), content: s.contents[lf.path] ?? '' })
              }
            }
            return searchAll(s.searchQuery, files)
          })
        : NO_SEARCH

    const outline = this.memo<OutlineItem[]>('outline', [activeMd], () =>
      computeOutline(activeMd).map((o, i) => ({ key: i, slug: o.slug, text: o.text, level: o.level }))
    )
    const st = activeId ? computeStats(activeMd) : { words: 0, minutes: 0, lines: 0, headings: 0 }

    const pinned = this.memo('pinnedRefs', [s.pinned, index], () => s.pinned.map((id) => this.fileMeta(id)))
    const recent = this.memo('recentRefs', [s.recents, index], () => s.recents.map((id) => this.fileMeta(id)))

    const breadcrumb = af ? (af.folder ? af.folder + '  /  ' + af.name : af.name) : ''
    const dirty = activeId ? this.isDirty(activeId) : false
    const unsavedList = s.closePrompt ? this.unsavedFiles() : []
    const modeLabel = s.viewMode === 'read' ? 'Reading' : s.viewMode === 'split' ? 'Split' : 'Editing'
    const showEditor = s.viewMode === 'edit' || s.viewMode === 'split'
    const showReader = s.viewMode === 'read' || s.viewMode === 'split'
    const showOutline = s.outlineOpen && hasTabs
    const titleName = af ? af.name : 'No document'
    const statusLeft = s.root ? (af ? breadcrumb : s.rootName) : 'Open a folder to begin'

    return (
      <div
        ref={this.rootRef}
        className={'smd-root ' + (isDark ? 'smd-dark' : 'smd-light')}
        onDragEnter={this.onDragEnter}
        onDragOver={this.onDragOver}
        onDragLeave={this.onDragLeave}
        onDrop={this.onDrop}
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg)',
          color: 'var(--fg)',
          fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif",
          fontSize: 13,
          WebkitFontSmoothing: 'antialiased',
          overflow: 'hidden'
        }}
      >
        <TitleBar
          titleName={titleName}
          dirty={dirty}
          isMaximized={s.isMaximized}
          onMinimize={() => window.api.win.minimize()}
          onMaximize={() => window.api.win.maximizeToggle()}
          onClose={() => window.api.win.close()}
        />

        <div className="smd-body" style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <ActivityBar
            activity={s.activity}
            sidebarOpen={s.sidebarOpen}
            isDark={isDark}
            onFiles={() => this.setActivity('files')}
            onSearch={() => this.setActivity('search')}
            onPinned={() => this.setActivity('pinned')}
            onToggleTheme={this.toggleTheme}
          />

          {s.sidebarOpen && (
            <Sidebar
              activity={s.activity}
              hasFolder={!!s.root || folders.length > 0}
              onOpenFolder={this.openFolderDialog}
              onOpenFiles={this.openFilesDialog}
              folders={folders}
              onToggleFolder={this.toggleFolder}
              onOpenFile={this.openFile}
              onOpenAll={this.openAllInFolder}
              onPinFile={this.togglePin}
              onFileContext={this.showFileMenu}
              onFolderContext={this.showFolderMenu}
              searchQuery={s.searchQuery}
              searchResult={searchResult}
              onSearchInput={this.onSearch}
              onOpenGroup={this.openFile}
              onGotoMatch={this.gotoMatch}
              pinned={pinned}
              recent={recent}
              onUnpin={this.togglePin}
            />
          )}

          <div
            className="smd-center"
            style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, background: 'var(--bg)' }}
          >
            <Tabs tabs={tabs} onSelect={this.setActive} onClose={this.closeTab} />

            {hasTabs ? (
              <>
                <Toolbar
                  breadcrumb={breadcrumb}
                  viewMode={s.viewMode}
                  onSetView={this.setView}
                  onExport={this.exportPdf}
                  outlineOpen={s.outlineOpen}
                  onToggleOutline={this.toggleOutline}
                  prefsOpen={s.prefsOpen}
                  onTogglePrefs={this.togglePrefs}
                  accent={s.accent}
                  readingFont={s.readingFont}
                  readingWidth={s.readingWidth}
                  onAccent={this.setAccent}
                  onFont={this.setFont}
                  onWidth={this.setWidth}
                />
                {activeId && s.externalChanges[activeId] && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '8px 14px',
                      background: 'var(--accent-soft)',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 12.5,
                      color: 'var(--fg)'
                    }}
                  >
                    <span style={{ flex: 1 }}>This file changed on disk while you had unsaved edits.</span>
                    <button
                      className="smd-ghostbtn smd-ghostbtn--sm"
                      onClick={() => this.reloadFromDisk(activeId)}
                    >
                      Reload from disk
                    </button>
                    <button
                      className="smd-ghostbtn smd-ghostbtn--sm"
                      onClick={() => this.dismissExternalChange(activeId)}
                    >
                      Keep mine
                    </button>
                  </div>
                )}
                <div style={{ flex: 1, display: 'flex', minHeight: 0, minWidth: 0 }}>
                  {showEditor && activeId && (
                    <div
                      style={{
                        width: s.viewMode === 'split' ? '50%' : '100%',
                        height: '100%',
                        flex: 'none',
                        minWidth: 0,
                        borderRight: s.viewMode === 'split' ? '1px solid var(--border)' : 'none',
                        background: 'var(--bg)'
                      }}
                    >
                      <Suspense fallback={null}>
                        <CodeEditor
                          key={activeId}
                          value={this.contentOf(activeId)}
                          onChange={this.onEditorChange}
                          isDark={isDark}
                          jump={s.editorJump && s.editorJump.fileId === activeId ? s.editorJump : null}
                        />
                      </Suspense>
                    </div>
                  )}
                  {showReader && (
                    <div
                      ref={this.readerRef}
                      className="smd-reader"
                      role="article"
                      tabIndex={0}
                      aria-label={af ? `${af.name} — rendered document` : 'Rendered document'}
                      onClick={this.onReaderClick}
                      style={{ flex: 1, minWidth: 0, overflowY: 'auto', position: 'relative', background: 'var(--bg)' }}
                    />
                  )}
                </div>
              </>
            ) : (
              <EmptyState onOpenFolder={this.openFolderDialog} onOpenFiles={this.openFilesDialog} />
            )}
          </div>

          {showOutline && <Outline outline={outline} onJump={this.scrollToHeading} />}
        </div>

        <StatusBar
          statusLeft={statusLeft}
          dirty={dirty}
          words={st.words}
          minutes={st.minutes}
          lines={st.lines}
          modeLabel={modeLabel}
        />

        {s.prefsOpen && (
          <div
            onClick={() => this.setState({ prefsOpen: false })}
            style={{ position: 'fixed', inset: 0, zIndex: 25 }}
          />
        )}

        {s.closePrompt && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 60,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,.45)'
            }}
          >
            <div
              className="smd-pop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="smd-closeprompt-title"
              style={{
                width: 400,
                maxWidth: 'calc(100vw - 40px)',
                background: 'var(--bg)',
                border: '1px solid var(--border-strong)',
                borderRadius: 12,
                boxShadow: '0 24px 70px rgba(0,0,0,.4)',
                padding: '20px 22px'
              }}
            >
              <div
                id="smd-closeprompt-title"
                style={{ fontSize: 15, fontWeight: 650, color: 'var(--fg)', marginBottom: 8 }}
              >
                Save changes before closing?
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5, marginBottom: 6 }}>
                {unsavedList.length} file{unsavedList.length === 1 ? ' has' : 's have'} unsaved changes.
              </div>
              <div style={{ maxHeight: 120, overflowY: 'auto', margin: '0 0 16px' }}>
                {unsavedList.slice(0, 8).map((id) => (
                  <div
                    key={id}
                    style={{
                      fontSize: 12.5,
                      color: 'var(--fg)',
                      padding: '2px 0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    • {this.fileMeta(id).name}
                  </div>
                ))}
                {unsavedList.length > 8 && (
                  <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '2px 0' }}>
                    …and {unsavedList.length - 8} more
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="smd-ghostbtn" onClick={this.cancelClose}>
                  Cancel
                </button>
                <button className="smd-ghostbtn" onClick={this.confirmDiscardAndClose}>
                  Discard &amp; close
                </button>
                <button className="smd-primarybtn" onClick={this.confirmSaveAndClose} autoFocus>
                  Save all &amp; close
                </button>
              </div>
            </div>
          </div>
        )}

        {s.statusNote && (
          <div
            className="smd-pop"
            role="status"
            aria-live="polite"
            style={{
              position: 'fixed',
              bottom: 40,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 40,
              background: 'var(--bg)',
              border: '1px solid var(--border-strong)',
              borderRadius: 9,
              boxShadow: '0 10px 30px rgba(0,0,0,.18)',
              padding: '9px 16px',
              fontSize: 12.5,
              color: 'var(--fg)'
            }}
          >
            {s.statusNote}
          </div>
        )}

        {s.dragOver && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 90,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'color-mix(in oklch, var(--bg) 72%, transparent)',
              pointerEvents: 'none'
            }}
          >
            <div
              className="smd-pop"
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 14,
                padding: '34px 48px',
                border: '2px dashed var(--accent)',
                borderRadius: 16,
                background: 'var(--bg-elev)',
                boxShadow: '0 20px 60px rgba(0,0,0,.28)'
              }}
            >
              <FolderPlusIcon size={36} style={{ color: 'var(--accent)' }} />
              <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--fg)' }}>Drop to open</div>
              <div style={{ fontSize: 12.5, color: 'var(--fg-muted)' }}>Markdown files or a folder</div>
            </div>
          </div>
        )}

        {s.confirm && (
          <div
            onClick={this.cancelConfirm}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 70,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(0,0,0,.45)'
            }}
          >
            <div
              className="smd-pop"
              role="dialog"
              aria-modal="true"
              aria-label={s.confirm.title}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 380,
                maxWidth: 'calc(100vw - 40px)',
                background: 'var(--bg)',
                border: '1px solid var(--border-strong)',
                borderRadius: 12,
                boxShadow: '0 24px 70px rgba(0,0,0,.4)',
                padding: '20px 22px'
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 650, color: 'var(--fg)', marginBottom: 8 }}>
                {s.confirm.title}
              </div>
              <div style={{ fontSize: 13, color: 'var(--fg-muted)', lineHeight: 1.5, marginBottom: 18 }}>
                {s.confirm.message}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button className="smd-ghostbtn" onClick={this.cancelConfirm}>
                  Cancel
                </button>
                <button
                  className={'smd-primarybtn' + (s.confirm.danger ? ' smd-dangerbtn' : '')}
                  onClick={this.runConfirm}
                  autoFocus
                >
                  {s.confirm.confirmLabel}
                </button>
              </div>
            </div>
          </div>
        )}

        {s.menu && <ContextMenu menu={s.menu} onClose={this.closeMenu} />}
      </div>
    )
  }
}
