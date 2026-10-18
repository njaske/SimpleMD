import { Component, createRef, lazy, Suspense } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { computeOutline, computeStats, searchAll } from '@/lib/document'
import type { SearchResult } from '@/lib/document'
import { ReaderController } from '@/lib/reader/ReaderController'
import type { EditorHandle } from '@/lib/editor/types'
import { COMMANDS, commandLabel, rememberCommand, type CommandId, type PlatformWords } from '@/lib/commands'
import { isAgentInstructionFile, titleFromMarkdown } from '@/lib/logic/files'
import { formatShortcut, revealLabel, trashName } from '@/lib/logic/platform'
import type { NamedFileRef, OutlineItem } from '@/state/viewmodel'
import { InfoIcon } from '@/lib/icons'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import Outline from '@/components/Outline'
import StatusBar from '@/components/StatusBar'
import Welcome from '@/components/Welcome'
import ContextMenu, { type MenuEntry } from '@/components/ContextMenu'
import AppOverlays, { prefetchOverlays } from '@/app/AppOverlays'
import type { PaletteCommand } from '@/components/CommandPalette'
import type { AppHost, Updater } from '@/app/host'
import type { AppState } from '@/app/types'
import { READING_FONTS, resolveTheme } from '@/app/appearance'
import { baseName, dirOf, displayDir, isDirtyIn, isUntitled, unsavedIds, without } from '@/app/model'
import { buildIndex, buildQuickOpen, buildTabs, buildTree, searchableFiles, type FileMeta } from '@/app/view'
import { createDocumentActions } from '@/app/documents'
import { createFileActions } from '@/app/files'
import { createViewActions } from '@/app/viewActions'
import { createExportActions } from '@/app/exporting'
import { createDropTarget } from '@/app/dragDrop'
import { documentMenu, fileMenu, folderMenu, tabMenu, type MenuDeps } from '@/app/menus'
import { buildCommandTable, type CommandTable } from '@/app/commandTable'
import { createKeyHandler } from '@/app/keyboard'
import { SettingsWriter, settingsSnapshot } from '@/app/persistence'
import { RecoveryKeeper } from '@/app/recovery'
import { bootstrap, restoreRecovered } from '@/app/bootstrap'
import { initialState } from '@/app/initialState'
// The CodeMirror editor is only needed in Edit/Split view. Load it lazily so the
// (large) editor stack stays out of the startup chunk for read-only users.
const CodeEditor = lazy(() => import('@/components/CodeEditor'))

/** Warm the lazy editor chunk this long after startup, off the critical path. */
const EDITOR_PREFETCH_DELAY_MS = 2000
const NO_SEARCH: SearchResult = { groups: [], total: 0, fileCount: 0 }
const NARROW_QUERY = '(max-width: 999px)'
const COMPACT_QUERY = '(max-width: 859px)'

const media = (q: string): MediaQueryList | null => (typeof window !== 'undefined' ? window.matchMedia(q) : null)

export default class App extends Component<Record<string, never>, AppState> {
  private rootRef = createRef<HTMLDivElement>()
  private index = new Map<string, FileMeta>()
  private memos = new Map<string, { deps: readonly unknown[]; value: unknown }>()
  private editor: EditorHandle | null = null
  private wantEditorFocus = false
  private toastSeq = 0
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
    onToggleTask: () => {},
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
    focusEditor: () => {
      if (this.editor) this.editor.focus()
      else this.wantEditorFocus = true
    }
  }
  private files = createFileActions(this.host, () => this.docs)
  private docs = createDocumentActions(this.host, { rescan: () => void this.files.reconcileFolder() })
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
    renameTarget: () => this.renameTarget()
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
    if (s.activeId !== prev.activeId) this.setState({ activeSlug: null })
    this.renderDoc(false)
    if (s.ready) this.writer.persist(settingsSnapshot(s))
    if (s.contents !== prev.contents || s.saved !== prev.saved) {
      this.reportUnsaved()
      this.recovery.schedule()
    }
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
    this.editor = handle
    if (handle && this.wantEditorFocus) {
      this.wantEditorFocus = false
      handle.focus()
    }
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
    // Warm the lazy chunks once the first document is up, so the first switch to
    // Edit/Split (or the first palette) doesn't wait on a parse.
    setTimeout(() => {
      requestIdleCallback(prefetchOverlays, { timeout: 5_000 })
      requestIdleCallback(() => void import('@/components/CodeEditor'), { timeout: 10_000 })
    }, EDITOR_PREFETCH_DELAY_MS)
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

  private openMenu(
    items: MenuEntry[],
    e: ReactMouseEvent | ReactKeyboardEvent,
    keyboard: boolean,
    label: string
  ): void {
    const target = e.currentTarget as HTMLElement
    const rect = target.getBoundingClientRect()
    const mouse = 'clientX' in e && !keyboard
    this.setState({
      menu: {
        x: mouse ? (e as ReactMouseEvent).clientX : rect.left + 12,
        y: mouse ? (e as ReactMouseEvent).clientY : rect.bottom,
        items,
        label,
        keyboard
      }
    })
  }

  private showTabMenu = (id: string, e: ReactMouseEvent | ReactKeyboardEvent, keyboard: boolean): void =>
    this.openMenu(tabMenu(this.menuDeps, id), e, keyboard, 'Tab actions')
  private showFileMenu = (id: string, e: ReactMouseEvent | ReactKeyboardEvent, keyboard: boolean): void =>
    this.openMenu(fileMenu(this.menuDeps, id), e, keyboard, 'File actions')
  private showFolderMenu = (id: string, e: ReactMouseEvent | ReactKeyboardEvent, keyboard: boolean): void =>
    this.openMenu(folderMenu(this.menuDeps, id), e, keyboard, 'Folder actions')

  private showDocMenu = (anchor: HTMLElement, keyboard: boolean): void => {
    if (this.state.menu) return this.setState({ menu: null })
    const r = anchor.getBoundingClientRect()
    this.setState({
      menu: {
        x: r.right,
        y: r.bottom + 6,
        align: 'end',
        items: documentMenu(this.menuDeps),
        label: 'Document actions',
        keyboard
      }
    })
  }

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

  private onEditorChange = (value: string): void =>
    this.setState((s) => (s.activeId ? { contents: { ...s.contents, [s.activeId]: value } } : null))
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
  private forgetRecent = (id: string): void => this.setState((s) => ({ recents: s.recents.filter((r) => r !== id) }))

  // ---- render --------------------------------------------------------------------

  private paletteCommands(): PaletteCommand[] {
    return COMMANDS.filter((c) => !c.hideInPalette && this.isAvailable(c.id)).map((c) => ({
      id: c.id,
      label: commandLabel(c, this.words),
      group: c.group,
      keywords: c.keywords ?? '',
      shortcut: c.shortcuts?.[0] ? this.hint(c.shortcuts[0]) : null
    }))
  }

  private renderSidebar(overlay: boolean) {
    const s = this.state
    const tree = this.memo(
      'tree',
      [s.tree, s.looseFiles, s.expanded, s.pinned, s.activeId, s.newPaths, s.root, s.emptyFolders],
      () => buildTree(s, isAgentInstructionFile)
    )
    const treeProps = this.memo('treeProps', [tree, s.root, s.renaming], () => ({
      tree,
      hasFolder: !!s.root || tree.folders.length > 0,
      renaming: s.renaming,
      validateName: this.validateName,
      onRenameCommit: this.commitRename,
      onRenameCancel: this.cancelRename,
      onToggleFolder: this.files.toggleFolder,
      onOpenFile: this.openFromSidebar,
      onOpenAll: this.files.openAllInFolder,
      onPinFile: this.files.togglePin,
      onOpenFolder: this.files.openFolderDialog,
      onOpenFiles: this.files.openFilesDialog,
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
    const showEditor = s.viewMode !== 'read'
    const showReader = s.viewMode !== 'edit'
    const name = this.nameOf(activeId)
    return (
      <div className="smd-workspace">
        <div className="smd-docarea">
          {s.externalChanges[activeId] && (
            <div className="smd-conflict" role="alert">
              <InfoIcon size={16} />
              <span>This file changed on disk while you had unsaved edits.</span>
              <button
                type="button"
                className="smd-btn smd-btn--sm"
                onClick={() => void this.docs.reloadFromDisk(activeId)}
              >
                Reload from disk
              </button>
              <button
                type="button"
                className="smd-btn smd-btn--sm smd-btn--ghost"
                onClick={() => this.docs.keepMine(activeId)}
              >
                Keep mine
              </button>
            </div>
          )}
          <div className={'smd-panes' + (s.viewMode === 'split' ? ' smd-panes--split' : '')}>
            {showEditor && (
              <div className="smd-editor-pane">
                {/* Format bar slot (Edit/Split only), wired at integration. */}
                <div className="smd-editor-host">
                  <Suspense fallback={null}>
                    <CodeEditor
                      key={activeId}
                      value={s.contents[activeId] ?? ''}
                      onChange={this.onEditorChange}
                      isDark={resolveTheme(s.theme, s.systemDark) === 'dark'}
                      jump={s.editorJump && s.editorJump.fileId === activeId ? s.editorJump : null}
                      onReady={this.onEditorReady}
                    />
                  </Suspense>
                </div>
              </div>
            )}
            {showReader && (
              // Positioned pane: the find bar and change bar float inside it.
              <div className="smd-reader-pane">
                <div
                  ref={this.setReaderEl}
                  className="smd-reader"
                  role="article"
                  tabIndex={0}
                  aria-label={`${name}, rendered`}
                />
              </div>
            )}
          </div>
        </div>
        {this.renderOutline()}
      </div>
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
    return (
      <StatusBar
        folder={folder}
        file={id ? this.nameOf(id) : ''}
        saveState={saveState}
        words={st.words}
        minutes={st.minutes}
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
            outlineOpen={s.outlineOpen}
            outlineAvailable={!s.narrow}
            readingOpen={s.readingOpen}
            docMenuOpen={!!s.menu && s.menu.align === 'end'}
            isMaximized={s.isMaximized}
            hint={this.hint}
            onShowSidebar={this.view.showSidebar}
            onSelectTab={this.setActive}
            onCloseTab={this.closeTab}
            onTabContext={this.showTabMenu}
            onNewDocument={this.newDoc}
            onSetView={this.view.setView}
            onToggleOutline={this.view.toggleOutline}
            onToggleReading={this.toggleReading}
            onDocMenu={this.showDocMenu}
          />
          {s.activeId ? (
            this.renderDocument(s.activeId)
          ) : (
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
        {s.menu && <ContextMenu menu={s.menu} onClose={() => this.setState({ menu: null })} />}
      </div>
    )
  }
}
