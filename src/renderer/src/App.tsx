import { Component, createRef, Suspense } from 'react'
import { computeOutline, computeStats, searchAll } from '@/lib/document'
import type { SearchResult } from '@/lib/document'
import { ReaderController } from '@/lib/reader/ReaderController'
import type { EditorHandle, FormatCommand } from '@/lib/editor/types'
import { COMMANDS, commandLabel, rememberCommand, type CommandId, type PlatformWords } from '@/lib/commands'
import { isAgentInstructionFile, titleFromMarkdown } from '@/lib/logic/files'
import { formatShortcut, revealLabel, trashName } from '@/lib/logic/platform'
import type { NamedFileRef, OutlineItem } from '@/state/viewmodel'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import Outline from '@/components/Outline'
import StatusBar from '@/components/StatusBar'
import AppOverlays from '@/app/AppOverlays'
import DocumentView from '@/app/DocumentView'
import LazyBoundary from '@/app/LazyBoundary'
import { ContextMenu, Welcome, prefetchLazyParts } from '@/app/lazyParts'
import { ReaderBridge } from '@/app/readerBridge'
import { EditorLink } from '@/app/editorLink'
import { createReadingCommands } from '@/app/reading'
import type { PaletteCommand } from '@/components/CommandPalette'
import type { AppHost, Updater } from '@/app/host'
import { reason } from '@/app/host'
import type { AppState } from '@/app/types'
import { READING_FONTS, editorFontSize, resolveTheme } from '@/app/appearance'
import { baseName, dirOf, displayDir, isDirtyIn, isUntitled, unsavedIds, without } from '@/app/model'
import { buildIndex, buildQuickOpen, buildTabs, buildTree, searchableFiles, type FileMeta } from '@/app/view'
import { createDocumentActions } from '@/app/documents'
import { createFileActions } from '@/app/files'
import { createViewActions } from '@/app/viewActions'
import { createExportActions } from '@/app/exporting'
import { createDropTarget } from '@/app/dragDrop'
import type { MenuDeps } from '@/app/menus'
import { DOC_MENU, TAB_LIST, createMenuControl } from '@/app/menuControl'
import { buildCommandTable, type CommandTable } from '@/app/commandTable'
import { createKeyHandler } from '@/app/keyboard'
import { SettingsWriter, settingsSnapshot } from '@/app/persistence'
import { RecoveryKeeper } from '@/app/recovery'
import { bootstrap, restoreRecovered } from '@/app/bootstrap'
import { initialState } from '@/app/initialState'
/** Start warming the lazy chunks this long after startup, off the critical path. */
const PREFETCH_DELAY_MS = 1500
const NO_SEARCH: SearchResult = { groups: [], total: 0, fileCount: 0 }
const NO_FIXES: readonly string[] = []
/** Upper bound on how long a theme switch keeps transitions off. */
const THEME_SWITCH_MS = 120
const NARROW_QUERY = '(max-width: 999px)'
const COMPACT_QUERY = '(max-width: 859px)'

const media = (q: string): MediaQueryList | null => (typeof window !== 'undefined' ? window.matchMedia(q) : null)

export default class App extends Component<Record<string, never>, AppState> {
  private rootRef = createRef<HTMLDivElement>()
  private index = new Map<string, FileMeta>()
  private memos = new Map<string, { deps: readonly unknown[]; value: unknown }>()
  private toastSeq = 0
  /** Why the last image save failed, shown instead of the editor's generic notice. */
  private imageFailure: string | null = null
  private lastReportedUnsaved = false
  private unsubs: (() => void)[] = []
  private darkQuery = media('(prefers-color-scheme: dark)')
  private narrowQuery = media(NARROW_QUERY)
  private compactQuery = media(COMPACT_QUERY)
  private platform = window.api.platform
  private words: PlatformWords = { trash: trashName(this.platform), reveal: revealLabel(this.platform) }

  private reader = new ReaderController({
    readImage: (docPath, src) => window.api.readImage(docPath, src),
    onLink: (href) => this.openLink(href),
    onToggleTask: (line, checked) => this.bridge.onToggleTask(line, checked),
    onRenderInfo: (info) => this.bridge.onRenderInfo(info),
    onActiveHeading: (slug) => {
      if (slug !== this.state.activeSlug) this.setState({ activeSlug: slug })
    }
  })

  private host: AppHost = {
    platform: this.platform,
    reader: this.reader,
    state: () => this.state,
    update: (u: Updater, then?: () => void) => this.setState(u as Pick<AppState, keyof AppState>, then),
    toast: (message, action) => this.setState({ toast: { id: ++this.toastSeq, message, action } }),
    nameOf: (id) => this.nameOf(id),
    renderDoc: (force) => this.renderDoc(force),
    focusEditor: () => this.editorLink.focus()
  }
  private bridge = new ReaderBridge(this.host)
  private editorLink = new EditorLink(this.reader, this.platform)
  private files = createFileActions(this.host, () => this.docs, { onReload: this.bridge.beforeReload })
  private docs = createDocumentActions(this.host, {
    rescan: () => void this.files.reconcileFolder(),
    onReload: this.bridge.beforeReload
  })
  private view = createViewActions(this.host)
  private exports = createExportActions(this.host)
  private drop = createDropTarget(this.host, this.files)
  private menuDeps: MenuDeps = { host: this.host, docs: this.docs, files: this.files, exports: this.exports }
  private commands: CommandTable = buildCommandTable({
    host: this.host,
    docs: this.docs,
    files: this.files,
    view: this.view,
    exports: this.exports,
    renameTarget: () => this.renameTarget(),
    reading: createReadingCommands(this.host, this.bridge, this.editorLink)
  })
  private writer = new SettingsWriter((s) => window.api.setSettings(s))
  private recovery = new RecoveryKeeper(this.host)
  private onKey = createKeyHandler({
    platform: this.platform,
    modal: () => {
      const s = this.state
      if (s.dialog || s.settings || s.recovery) return 'dialog'
      return s.palette ? 'palette' : null
    },
    available: (id) => this.isAvailable(id),
    run: (id) => this.runCommand(id)
  })

  constructor(props: Record<string, never>) {
    super(props)
    this.state = initialState({
      systemDark: !!this.darkQuery?.matches,
      narrow: !!this.narrowQuery?.matches,
      compact: !!this.compactQuery?.matches
    })
  }

  componentDidMount(): void {
    const api = window.api
    this.unsubs.push(
      api.win.onMaximizeChange((v) => this.setState({ isMaximized: v })),
      api.onFolderChanged(() => void this.files.reconcileFolder()),
      api.onRequestClose(() => this.setState({ dialog: { kind: 'closeWindow' }, menu: null, palette: null })),
      api.onOpenPaths(this.files.openResult)
    )
    api.win.isMaximized().then(
      (v) => this.setState({ isMaximized: v }),
      () => undefined
    )
    window.addEventListener('keydown', this.onKey, true)
    window.addEventListener('keydown', this.onEscape)
    // Safety net so a cancelled/interrupted drag never leaves the overlay stuck.
    window.addEventListener('dragend', this.drop.reset)
    window.addEventListener('drop', this.drop.reset)
    // React never unmounts when the window closes, so flush on pagehide too.
    window.addEventListener('pagehide', this.onPageHide)
    this.darkQuery?.addEventListener('change', this.onMedia)
    this.narrowQuery?.addEventListener('change', this.onMedia)
    this.compactQuery?.addEventListener('change', this.onMedia)
    void this.start()
  }

  componentWillUnmount(): void {
    window.removeEventListener('keydown', this.onKey, true)
    window.removeEventListener('keydown', this.onEscape)
    window.removeEventListener('dragend', this.drop.reset)
    window.removeEventListener('drop', this.drop.reset)
    window.removeEventListener('pagehide', this.onPageHide)
    this.darkQuery?.removeEventListener('change', this.onMedia)
    this.narrowQuery?.removeEventListener('change', this.onMedia)
    this.compactQuery?.removeEventListener('change', this.onMedia)
    this.unsubs.forEach((u) => u())
    this.editorLink.dispose()
    this.reader.dispose()
    this.recovery.dispose()
    this.writer.flush()
  }

  componentDidUpdate(_props: unknown, prev: AppState): void {
    const s = this.state
    if (
      s.accent !== prev.accent ||
      s.readingWidth !== prev.readingWidth ||
      s.readingFont !== prev.readingFont ||
      s.readingSize !== prev.readingSize ||
      s.lineHeight !== prev.lineHeight
    ) {
      this.applyProps()
    }
    if (s.uiScale !== prev.uiScale) void window.api.win.setZoom(s.uiScale).catch(() => undefined)
    if (resolveTheme(s.theme, s.systemDark) !== resolveTheme(prev.theme, prev.systemDark)) this.switchThemeCrisply()
    if (s.activeId !== prev.activeId) {
      this.bridge.left(prev.activeId)
      this.setState({ activeSlug: null, renderFixes: [], blockedImages: 0 })
    }
    // The find bar lives in the reader; Edit view has none.
    if (s.find && (s.viewMode === 'edit' || !s.activeId)) this.setState({ find: null })
    this.renderDoc(false)
    this.editorLink.sync(s.viewMode === 'split' && s.syncScroll)
    // Not before the session is back: an early write would save an empty tab strip.
    if (s.restored) this.writer.persist(settingsSnapshot(s))
    if (s.contents !== prev.contents || s.saved !== prev.saved) {
      this.reportUnsaved()
      this.recovery.schedule()
    }
  }

  /** Hover/press transitions would make each surface change colour at its own speed
   *  on a theme switch; turn them off until the new theme has painted. */
  private switchThemeCrisply(): void {
    const r = this.rootRef.current
    if (!r) return
    r.classList.add('smd-theme-switching')
    const done = (): void => r.classList.remove('smd-theme-switching')
    requestAnimationFrame(() => requestAnimationFrame(done))
    // rAF is paused in a hidden window; don't leave transitions off until it shows.
    setTimeout(done, THEME_SWITCH_MS)
  }

  private onPageHide = (): void => {
    this.writer.flush()
    void this.recovery.flush()
  }

  private onMedia = (): void =>
    this.setState((s) => {
      const compact = !!this.compactQuery?.matches
      return {
        systemDark: !!this.darkQuery?.matches,
        narrow: !!this.narrowQuery?.matches,
        compact,
        sidebarPeek: compact ? s.sidebarPeek : false
      }
    })

  /** Esc leaves focus mode once every overlay has had its turn (they stop the event). */
  private onEscape = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return
    if (this.state.sidebarPeek) this.setState({ sidebarPeek: false })
    else if (this.state.focusMode) this.setState({ focusMode: false })
  }

  private setReaderEl = (el: HTMLDivElement | null): void => this.reader.attach(el)

  private onEditorReady = (handle: EditorHandle | null): void => {
    this.editorLink.ready(handle)
    this.editorLink.sync(this.state.viewMode === 'split' && this.state.syncScroll)
  }

  /** Pasted/dropped images land next to the document; untitled ones have no folder yet. */
  private saveImage = async (file: File): Promise<string | null> => {
    const id = this.state.activeId
    if (!id || isUntitled(id)) return null
    try {
      return await window.api.writeAsset(id, file.name, new Uint8Array(await file.arrayBuffer()))
    } catch (err) {
      const why = reason(err)
      this.imageFailure = `Couldn't add ${file.name}${why ? ` (${why})` : ''}. Check that the document's folder still exists, then try again.`
      throw err
    }
  }

  private editorNotice = (message: string): void => {
    const text = this.imageFailure ?? message
    this.imageFailure = null
    this.host.toast(text)
  }

  /** Repaint the reader from current state (cheap when nothing changed). */
  private renderDoc(force: boolean): void {
    const s = this.state
    const id = s.activeId
    this.reader.update(
      { id, path: id && !isUntitled(id) ? id : null, md: id ? (s.contents[id] ?? '') : '' },
      { mode: s.viewMode, theme: resolveTheme(s.theme, s.systemDark), blockRemoteImages: s.blockRemoteImages },
      force
    )
  }

  /** Memoize a derived value on reference equality of its inputs, so typing in
   *  the editor doesn't rebuild the file tree, outline or search results. */
  private memo<T>(key: string, deps: readonly unknown[], compute: () => T): T {
    const hit = this.memos.get(key)
    if (hit && hit.deps.length === deps.length && hit.deps.every((d, i) => Object.is(d, deps[i]))) return hit.value as T
    const value = compute()
    this.memos.set(key, { deps, value })
    return value
  }

  private async start(): Promise<void> {
    await bootstrap({
      host: this.host,
      files: this.files,
      recovery: this.recovery,
      onSettings: (st) => {
        this.applyProps()
        if (st.uiScale !== 1) void window.api.win.setZoom(st.uiScale).catch(() => undefined)
        this.renderDoc(true)
      }
    })
    // Warm the lazy chunks once the first document is up, so the first palette,
    // find bar or switch to Edit doesn't wait on a parse.
    setTimeout(() => {
      prefetchLazyParts()
      this.bridge.prefetch()
    }, PREFETCH_DELAY_MS)
  }

  private discardRecovered = (): void => {
    this.setState({ recovery: null })
    void this.recovery.clear().then(() => this.recovery.enable())
  }

  private applyProps(): void {
    const r = this.rootRef.current
    if (!r) return
    const s = this.state
    r.style.setProperty('--accent', s.accent)
    r.style.setProperty('--read-width', `${s.readingWidth}px`)
    r.style.setProperty('--read-font', READING_FONTS[s.readingFont])
    r.style.setProperty('--read-size', `${s.readingSize}px`)
    r.style.setProperty('--read-leading', String(s.lineHeight))
  }

  // ---- names, commands, menus ----------------------------------------------------

  private nameOf(id: string): string {
    if (isUntitled(id)) return titleFromMarkdown(this.state.contents[id] ?? '') ?? 'Untitled'
    return this.index.get(id)?.name ?? baseName(id)
  }

  private hint = (shortcut: string): string => formatShortcut(shortcut, this.platform)

  private isAvailable(id: CommandId): boolean {
    const b = this.commands[id]
    return !!b && (b.enabled?.() ?? true)
  }

  private hasCommand = (id: CommandId): boolean => !!this.commands[id]

  private runCommand = (id: CommandId): void => {
    const b = this.commands[id]
    if (!b || !(b.enabled?.() ?? true)) return
    this.setState((s) => ({ recentCommands: rememberCommand(s.recentCommands, id) }))
    b.run()
  }

  /** F2 target: the focused tree row, else the active document. */
  private renameTarget(): { path: string; isFolder: boolean } | null {
    const el = document.activeElement as HTMLElement | null
    if (el?.dataset.path) return { path: el.dataset.path, isFolder: false }
    if (el?.dataset.folder && el.dataset.folder !== this.state.root) return { path: el.dataset.folder, isFolder: true }
    const id = this.state.activeId
    return id && !isUntitled(id) ? { path: id, isFolder: false } : null
  }

  private menus = createMenuControl(this.host, this.menuDeps, (id) => this.nameOf(id))
  private showTabMenu = this.menus.tab
  private showFileMenu = this.menus.file
  private showFolderMenu = this.menus.folder
  private showDocMenu = this.menus.document
  private showTabList = this.menus.tabList

  private readingAnchor: HTMLElement | null = null
  private toggleReading = (anchor: HTMLElement): void => {
    this.readingAnchor = anchor
    this.setState((s) => ({ readingOpen: !s.readingOpen, menu: null }))
  }

  // ---- links, unsaved state, drag and drop -----------------------------------------

  /** A link clicked in the reader: web links go to the browser, relative ones open files. */
  private openLink(href: string): void {
    if (/^https?:\/\//i.test(href)) {
      void window.api.openExternal(href).catch(() => this.host.toast("Couldn't open that link."))
      return
    }
    const norm = href.replace(/^\.\//, '').replace(/\\/g, '/').split('#')[0]
    const hit = [...this.index.keys()].find((p) => {
      const q = p.replace(/\\/g, '/')
      return q === norm || q.endsWith('/' + norm)
    })
    if (hit) void this.docs.openFile(hit)
    else this.host.toast(`Couldn't find ${baseName(norm)} among the open files.`)
  }

  private reportUnsaved(): void {
    const has = unsavedIds(this.state.contents, this.state.saved).length > 0
    if (has === this.lastReportedUnsaved) return
    this.lastReportedUnsaved = has
    void window.api.setUnsaved(has).catch(() => undefined)
  }

  private closeWindow = async (save: boolean): Promise<void> => {
    this.setState({ dialog: null })
    if (save && !(await this.docs.saveAll())) return
    await this.recovery.clear()
    void window.api.win.forceClose()
  }

  // ---- small handlers passed to components -----------------------------------------

  /** The editor also echoes text it was given (a reload); only real edits count. */
  private onEditorChange = (value: string): void => {
    const id = this.state.activeId
    if (!id || this.state.contents[id] === value) return
    this.bridge.edited(id)
    this.setState((s) => (s.activeId === id ? { contents: { ...s.contents, [id]: value } } : null))
  }
  private setActive = (id: string): void => this.setState((s) => ({ activeId: id, newPaths: without(s.newPaths, id) }))
  private openFromSidebar = (id: string): void => {
    void this.docs.openFile(id)
    if (this.state.compact) this.setState({ sidebarPeek: false })
  }
  private gotoMatch = (id: string, line: number, col: number, len: number): void => {
    void this.docs.openFile(id)
    this.setState((s) => ({
      viewMode: s.viewMode === 'read' ? 'split' : s.viewMode,
      editorJump: { fileId: id, line, col, len, nonce: (s.editorJump?.nonce ?? 0) + 1 }
    }))
  }
  private closeTab = (id: string): void => this.docs.requestClose([id])
  private newDoc = (): void => void this.docs.newDocument()
  private quickOpen = (): void => this.view.openPalette('')
  private openSettings = (): void => this.view.openSettings('appearance')
  private openShortcuts = (): void => this.view.openSettings('shortcuts')
  /** Outline click: the reader scrolls to the heading; Edit view (no reader)
   *  moves the editor to the heading's line instead. */
  private scrollToHeading = (slug: string): void => {
    const s = this.state
    const id = s.activeId
    if (s.viewMode !== 'edit' || !id) return this.reader.scrollToId(slug)
    const heading = computeOutline(s.contents[id] ?? '').find((o) => o.slug === slug)
    if (!heading) return
    this.setState((st) => ({
      editorJump: { fileId: id, line: heading.line, col: 0, len: 0, nonce: (st.editorJump?.nonce ?? 0) + 1 }
    }))
  }
  private validateName = (path: string, name: string, isFolder: boolean): string | null =>
    this.files.validateName(path, name, isFolder)
  private commitRename = (path: string, name: string, isFolder: boolean): void =>
    void this.files.commitRename(path, name, isFolder)
  private cancelRename = (): void => this.setState({ renaming: null })
  private setSearch = (searchQuery: string): void => this.setState({ searchQuery })
  private clearRecents = (): void => this.setState({ recents: [] })
  private format = (cmd: FormatCommand): void => this.editorLink.current?.format(cmd)
  private closeFind = (): void => this.setState({ find: null })
  private closeMenu = (): void => this.setState({ menu: null })
  private loadImages = (): void => this.reader.loadBlockedImages()
  /** Status chip: the next change, or from Edit (no reader) to Split to see them. */
  private showChanges = (): void => {
    if (this.state.viewMode === 'edit') this.view.setView('split')
    else this.bridge.nextChange()
  }
  private forgetRecent = (id: string): void => this.setState((s) => ({ recents: s.recents.filter((r) => r !== id) }))

  // ---- render --------------------------------------------------------------------

  private paletteCommands(): PaletteCommand[] {
    return COMMANDS.filter((c) => !c.hideInPalette && this.isAvailable(c.id)).map((c) => {
      const base = commandLabel(c, this.words)
      const label = this.commands[c.id]?.label?.() ?? base
      return {
        id: c.id,
        label,
        group: c.group,
        // A state-following label still answers to the registry's words ("toggle ...").
        keywords: [c.keywords ?? '', label === base ? '' : base].join(' ').trim(),
        shortcut: c.shortcuts?.[0] ? this.hint(c.shortcuts[0]) : null
      }
    })
  }

  private renderSidebar(overlay: boolean) {
    const s = this.state
    const tree = this.memo(
      'tree',
      [s.tree, s.looseFiles, s.expanded, s.pinned, s.activeId, s.newPaths, s.root, s.emptyFolders],
      () => buildTree(s, isAgentInstructionFile)
    )
    const treeProps = this.memo('treeProps', [tree, s.root, s.renaming, s.restored], () => ({
      tree,
      hasFolder: !!s.root || tree.folders.length > 0,
      ready: s.restored,
      renaming: s.renaming,
      validateName: this.validateName,
      onRenameCommit: this.commitRename,
      onRenameCancel: this.cancelRename,
      onToggleFolder: this.files.toggleFolder,
      onOpenFile: this.openFromSidebar,
      onOpenAll: this.files.openAllInFolder,
      onPinFile: this.files.togglePin,
      onOpenFolder: this.files.openFolderDialog,
      onFileContext: this.showFileMenu,
      onFolderContext: this.showFolderMenu
    }))
    const searchResult =
      s.activity === 'search'
        ? this.memo('search', [s.searchQuery, s.tree, s.looseFiles, s.contents], () =>
            searchAll(s.searchQuery, searchableFiles(s.tree, s.looseFiles, s.contents))
          )
        : NO_SEARCH
    const ref = (id: string): NamedFileRef => {
      const meta = this.index.get(id)
      return { id, name: meta?.name ?? baseName(id), folder: displayDir(meta?.dir ?? dirOf(id), s.root, s.rootName) }
    }
    const pinned = this.memo('pinnedRefs', [s.pinned, this.index], () => s.pinned.map(ref))
    const recent = this.memo('recentRefs', [s.recents, this.index], () => s.recents.map(ref))
    return (
      <Sidebar
        activity={s.activity}
        overlay={overlay}
        workspaceName={s.rootName}
        resolvedTheme={resolveTheme(s.theme, s.systemDark)}
        hint={this.hint}
        onActivity={this.view.setActivity}
        onNewDocument={this.newDoc}
        onQuickOpen={this.quickOpen}
        onSettings={this.openSettings}
        onToggleTheme={this.view.toggleTheme}
        onShortcuts={this.openShortcuts}
        tree={treeProps}
        searchQuery={s.searchQuery}
        searchResult={searchResult}
        onSearchInput={this.setSearch}
        onGotoMatch={this.gotoMatch}
        pinned={pinned}
        recent={recent}
        onUnpin={this.files.togglePin}
        onForgetRecent={this.forgetRecent}
        onClearRecents={this.clearRecents}
      />
    )
  }

  private renderDocument(activeId: string) {
    const s = this.state
    return (
      <DocumentView
        id={activeId}
        name={this.nameOf(activeId)}
        viewMode={s.viewMode}
        platform={this.platform}
        value={s.contents[activeId] ?? ''}
        isDark={resolveTheme(s.theme, s.systemDark) === 'dark'}
        editorFontSize={editorFontSize(s.readingSize)}
        jump={s.editorJump && s.editorJump.fileId === activeId ? s.editorJump : null}
        conflict={!!s.externalChanges[activeId]}
        find={s.find}
        changes={s.changes[activeId] ?? 0}
        reader={this.reader}
        outline={this.renderOutline()}
        setReaderEl={this.setReaderEl}
        onEditorChange={this.onEditorChange}
        onEditorReady={this.onEditorReady}
        onSaveImage={this.saveImage}
        onNotice={this.editorNotice}
        onFormat={this.format}
        onReloadConflict={() => void this.docs.reloadFromDisk(activeId, { confirmed: true })}
        onKeepMine={() => this.docs.keepMine(activeId)}
        onCloseFind={this.closeFind}
        onNextChange={this.bridge.nextChange}
        onDismissChanges={this.bridge.dismiss}
      />
    )
  }

  private renderOutline() {
    const s = this.state
    if (!s.outlineOpen || s.narrow || s.focusMode || !s.activeId) return null
    const md = s.contents[s.activeId] ?? ''
    const outline = this.memo<OutlineItem[]>('outline', [md], () =>
      computeOutline(md).map((o, i) => ({ key: i, slug: o.slug, text: o.text, level: o.level }))
    )
    return <Outline outline={outline} activeSlug={s.activeSlug} onJump={this.scrollToHeading} />
  }

  private renderStatus() {
    const s = this.state
    const id = s.activeId
    if (!s.showStatusBar || s.focusMode || !id) return null
    const md = id ? (s.contents[id] ?? '') : ''
    const st = id ? computeStats(md) : { words: 0, minutes: 0 }
    const meta = id ? this.index.get(id) : undefined
    const saveState = !id ? null : isUntitled(id) ? 'new' : isDirtyIn(s.contents, s.saved, id) ? 'unsaved' : 'saved'
    const folder = id && !isUntitled(id) ? (meta?.folderName ?? baseName(dirOf(id))) : ''
    const reading = s.viewMode !== 'edit'
    return (
      <StatusBar
        folder={folder}
        file={id ? this.nameOf(id) : ''}
        saveState={saveState}
        words={st.words}
        minutes={st.minutes}
        fixes={reading ? s.renderFixes : NO_FIXES}
        blockedImages={reading ? s.blockedImages : 0}
        onLoadImages={this.loadImages}
        changes={s.changes[id] ?? 0}
        changesHint={reading ? `Next change (${this.hint('Alt+N')})` : 'Show the changes in Split view'}
        onChanges={this.showChanges}
      />
    )
  }

  render() {
    const s = this.state
    const resolved = resolveTheme(s.theme, s.systemDark)
    this.index = this.memo('index', [s.tree, s.looseFiles], () => buildIndex(s))
    const sidebarVisible = !s.focusMode && (s.compact ? s.sidebarPeek : s.sidebarOpen)
    const tabs = buildTabs(s, (id) => this.nameOf(id))
    const recentFolders = this.memo('recentFolders', [s.recentFolders], () =>
      s.recentFolders.map((path) => ({ path, name: baseName(path), parent: dirOf(path).replace(/\\/g, '/') }))
    )
    const rootClass = [
      'smd-root',
      `smd-${resolved}`,
      `smd-platform-${this.platform}`,
      s.reduceMotion ? 'smd-reduce-motion' : '',
      s.focusMode ? 'smd-focus' : '',
      sidebarVisible && !s.compact ? '' : 'smd-no-sidebar'
    ]
      .filter(Boolean)
      .join(' ')

    return (
      <div
        ref={this.rootRef}
        className={rootClass}
        onDragEnter={this.drop.onDragEnter}
        onDragOver={this.drop.onDragOver}
        onDragLeave={this.drop.onDragLeave}
        onDrop={this.drop.onDrop}
      >
        {sidebarVisible && s.compact && (
          <div className="smd-sidebar-scrim" onClick={() => this.setState({ sidebarPeek: false })} />
        )}
        {sidebarVisible && this.renderSidebar(s.compact)}
        <div className="smd-main">
          <TopBar
            platform={this.platform}
            tabs={tabs}
            hasDocument={!!s.activeId}
            sidebarVisible={sidebarVisible && !s.compact}
            viewMode={s.viewMode}
            outlineOpen={s.outlineOpen && !s.focusMode}
            outlineAvailable={!s.narrow}
            readingOpen={s.readingOpen}
            docMenuOpen={s.menu?.label === DOC_MENU}
            tabListOpen={s.menu?.label === TAB_LIST}
            isMaximized={s.isMaximized}
            hint={this.hint}
            onShowSidebar={this.view.showSidebar}
            onSelectTab={this.setActive}
            onCloseTab={this.closeTab}
            onTabContext={this.showTabMenu}
            onNewDocument={this.newDoc}
            onTabList={this.showTabList}
            onSetView={this.view.setView}
            onToggleOutline={this.view.toggleOutline}
            onToggleReading={this.toggleReading}
            onDocMenu={this.showDocMenu}
          />
          {s.activeId ? (
            this.renderDocument(s.activeId)
          ) : !s.restored ? (
            // Restoring the session: an empty page, not a Welcome that flashes away.
            <div className="smd-workspace" aria-busy="true" />
          ) : (
            <LazyBoundary>
              <Suspense fallback={<div className="smd-workspace" aria-busy="true" />}>
                <Welcome
              hint={this.hint}
              recentFiles={this.memo('welcomeRecents', [s.recents, this.index, s.root], () =>
                s.recents.map((id) => ({
                  id,
                  name: this.index.get(id)?.name ?? baseName(id),
                  folder: displayDir(dirOf(id), s.root, s.rootName)
                }))
              )}
              recentFolders={recentFolders}
              onNewDocument={this.newDoc}
              onOpenFile={() => void this.files.openFilesDialog()}
              onOpenFolder={() => void this.files.openFolderDialog()}
              onPasteFromAi={() => void this.docs.pasteFromAi()}
              onOpenRecentFile={(id) => void this.docs.openFile(id)}
              onOpenRecentFolder={(p) => void this.files.openRecentFolder(p)}
              onClearRecents={this.clearRecents}
                />
              </Suspense>
            </LazyBoundary>
          )}
          {this.renderStatus()}
        </div>
        <AppOverlays
          state={s}
          platform={this.platform}
          readingAnchor={this.readingAnchor}
          nameOf={(id) => this.nameOf(id)}
          quickOpen={() => buildQuickOpen(s, this.index, isAgentInstructionFile)}
          paletteCommands={() => this.paletteCommands()}
          recentFolders={recentFolders}
          host={this.host}
          docs={this.docs}
          files={this.files}
          runCommand={this.runCommand}
          hasCommand={this.hasCommand}
          onRestore={() => void restoreRecovered(this.host, this.recovery)}
          onDiscard={this.discardRecovered}
          onCloseWindow={(save) => void this.closeWindow(save)}
        />
        {s.menu && (
          <LazyBoundary>
            <Suspense fallback={null}>
              <ContextMenu menu={s.menu} onClose={this.closeMenu} />
            </Suspense>
          </LazyBoundary>
        )}
      </div>
    )
  }
}
