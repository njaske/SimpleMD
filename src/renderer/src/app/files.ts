// Folder and file actions: opening folders/files/recent folders, the folder
// reconcile that never clobbers unsaved edits, and file management (rename,
// duplicate, new file/folder here, trash, reveal, copy path).
import type { DropResult, FolderScan, OpenedFile } from '@shared/types'
import { ensureMdExtension, isMarkdownName, validateFileName } from '@/lib/logic/files'
import { trashName } from '@/lib/logic/platform'
import type { AppHost } from './host'
import { reason } from './host'
import type { DocumentActions } from './documents'
import {
  baseName,
  dirOf,
  dropDoc,
  initialExpanded,
  insertTreeFile,
  isWithin,
  namesIn,
  pushRecents,
  reconcileNote,
  reconcileScan,
  remapPaths,
  remapTree,
  uniqueName,
  without
} from './model'
import type { DocSlice } from './model'

const MAX_AUTO_OPEN = 40

export type FileActions = ReturnType<typeof createFileActions>

interface ScanOptions {
  openAll?: boolean
  focusFiles?: boolean
  restoreTabs?: string[]
  restoreActive?: string | null
  availablePaths?: Set<string>
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

export function createFileActions(host: AppHost, docs: () => DocumentActions) {
  let scanning = false
  let rescanQueued = false

  const fail = (what: string, err: unknown, fix: string): void => {
    const why = reason(err)
    host.toast(`${what}${why ? ` (${why})` : ''}. ${fix}`)
  }

  const knownPaths = (): string[] => {
    const s = host.state()
    return [...s.tree.flatMap((f) => f.files.map((x) => x.path)), ...s.looseFiles.map((f) => f.path)]
  }

  const refreshRecentFolders = (): void => {
    window.api
      .getSettings()
      .then((st) => host.update({ recentFolders: st.recentFolders ?? [] }))
      .catch(() => undefined) // the list just stays as it was
  }

  const applyScan = (scan: FolderScan, opts: ScanOptions): void => {
    const allFiles = scan.tree.flatMap((f) => f.files.map((x) => x.path))
    let openTabs: string[] | null = null
    let activeId: string | null = null
    let note: string | null = null
    if (opts.restoreTabs?.length) {
      openTabs = opts.restoreTabs.filter((p) => scan.contents[p] !== undefined || opts.availablePaths?.has(p))
      activeId =
        opts.restoreActive && openTabs.includes(opts.restoreActive) ? opts.restoreActive : (openTabs[0] ?? null)
    }
    if (opts.openAll) {
      openTabs = allFiles.slice(0, MAX_AUTO_OPEN)
      activeId = openTabs[0] ?? null
      if (allFiles.length > MAX_AUTO_OPEN) note = `Opened ${MAX_AUTO_OPEN} of ${allFiles.length} Markdown files`
      else if (allFiles.length > 0) note = `Opened ${plural(allFiles.length, 'Markdown file')}`
      else note = `${scan.name} has no Markdown files yet`
    }
    if (openTabs && !openTabs.length && allFiles.length) {
      openTabs = [allFiles[0]]
      activeId = allFiles[0]
    }
    host.update(
      (prev) => {
        // Untitled documents survive opening another folder.
        const untitled = prev.openTabs.filter((t) => t.startsWith('untitled:'))
        const tabs = openTabs ? [...openTabs, ...untitled.filter((t) => !openTabs?.includes(t))] : prev.openTabs
        const active = openTabs ? (activeId ?? tabs[0] ?? null) : prev.activeId
        return {
          tree: scan.tree,
          root: scan.root,
          rootName: scan.name,
          contents: { ...prev.contents, ...scan.contents },
          saved: { ...prev.saved, ...scan.contents },
          // Files now covered by the workspace shouldn't also linger as loose groups.
          looseFiles: prev.looseFiles.filter((f) => scan.contents[f.path] === undefined),
          expanded: initialExpanded(scan.tree),
          newPaths: {},
          emptyFolders: [],
          openTabs: tabs,
          activeId: active,
          recents: pushRecents(activeId ? [activeId] : [], prev.recents),
          activity: opts.focusFiles ? 'files' : prev.activity,
          sidebarOpen: opts.focusFiles ? true : prev.sidebarOpen
        }
      },
      () => host.renderDoc(true)
    )
    if (note) host.toast(note)
  }

  const openFolderDialog = async (): Promise<void> => {
    try {
      const scan = await window.api.openFolder()
      if (!scan) return
      applyScan(scan, { openAll: true, focusFiles: true })
      refreshRecentFolders()
    } catch (err) {
      fail("Couldn't open that folder", err, 'Check that it still exists, then try again.')
    }
  }

  const openRecentFolder = async (path: string): Promise<void> => {
    try {
      const scan = await window.api.openRecentFolder(path)
      if (!scan) {
        host.toast(`Couldn't open ${baseName(path)}. It may have been moved or deleted.`)
        return
      }
      applyScan(scan, { openAll: true, focusFiles: true })
      refreshRecentFolders()
    } catch (err) {
      fail(`Couldn't open ${baseName(path)}`, err, 'Open it with Open folder instead.')
    }
  }

  /** Register individually-opened files (grouped by directory). With { open: false }
   *  it only fills the tree, without opening tabs. */
  const addLooseFiles = (files: OpenedFile[], opts: { open?: boolean } = {}): void => {
    if (!files.length) return
    const open = opts.open !== false
    host.update((s) => {
      const contents = { ...s.contents }
      const saved = { ...s.saved }
      const known = new Set(s.looseFiles.map((f) => f.path))
      const inTree = new Set(s.tree.flatMap((f) => f.files.map((x) => x.path)))
      const added = files.map((f) => f.path)
      for (const f of files) {
        // Never clobber unsaved edits of a file that's already open.
        if (contents[f.path] === undefined || contents[f.path] === saved[f.path]) {
          contents[f.path] = f.content
          saved[f.path] = f.content
        }
      }
      const looseFiles = [
        ...s.looseFiles,
        ...files
          .filter((f) => !known.has(f.path) && !inTree.has(f.path))
          .map((f) => ({ id: f.path, name: baseName(f.path), path: f.path, dir: dirOf(f.path) }))
      ]
      if (!open) return { contents, saved, looseFiles }
      return {
        contents,
        saved,
        looseFiles,
        openTabs: [...s.openTabs, ...added.filter((p, i) => !s.openTabs.includes(p) && added.indexOf(p) === i)],
        activeId: added[added.length - 1] ?? s.activeId,
        activity: 'files',
        recents: pushRecents([...added].reverse(), s.recents)
      }
    })
    if (open && files.length > 1) host.toast(`Opened ${plural(files.length, 'file')}`)
  }

  const openFilesDialog = async (): Promise<void> => {
    try {
      const files = await window.api.openFiles()
      if (files?.length) addLooseFiles(files)
    } catch (err) {
      fail("Couldn't open those files", err, 'Check that they still exist, then try again.')
    }
  }

  /** What the main process resolved from a drop, a launch argument or the shell. */
  const openResult = (result: DropResult): void => {
    if (result.folder) {
      applyScan(result.folder, { openAll: true, focusFiles: true })
      refreshRecentFolders()
    }
    if (result.files.length) addLooseFiles(result.files)
  }

  const reconcileFolder = async (): Promise<void> => {
    // One re-scan at a time; changes that land mid-scan trigger a single follow-up.
    if (scanning) {
      rescanQueued = true
      return
    }
    const root = host.state().root
    if (!root) return
    scanning = true
    let scan: FolderScan | null = null
    try {
      scan = await window.api.scanFolder(root)
    } catch {
      scan = null // the watcher fires again on the next change
    } finally {
      scanning = false
    }
    if (rescanQueued) {
      rescanQueued = false
      void reconcileFolder()
    }
    if (!scan || scan.root !== host.state().root) return
    const fresh = scan
    const result = reconcileScan(host.state(), fresh)
    host.update((s) => {
      const r = reconcileScan(s, fresh)
      const newPaths = { ...s.newPaths }
      for (const p of r.added) if (!s.openTabs.includes(p)) newPaths[p] = true
      const emptyFolders = s.emptyFolders.filter((d) => !fresh.tree.some((f) => f.id === d))
      return {
        tree: r.tree,
        contents: r.contents,
        saved: r.saved,
        externalChanges: r.externalChanges,
        openTabs: r.openTabs,
        activeId: r.activeId,
        newPaths,
        emptyFolders
      }
    })
    const note = reconcileNote(result)
    if (note) host.toast(note)
  }

  // ---- names --------------------------------------------------------------------

  /** The name actually used: files keep a Markdown extension. */
  const finalName = (name: string, isFolder: boolean): string =>
    isFolder || isMarkdownName(name) ? name : ensureMdExtension(name)

  /** Why `name` can't be used for `path` (renaming), or for a new item in `path` when `isNew`. */
  const validateName = (path: string, name: string, isFolder: boolean, isNew = false): string | null => {
    const trimmed = name.trim()
    const problem = validateFileName(trimmed, host.platform)
    if (problem) return problem
    const dir = isNew ? path : dirOf(path)
    const target = finalName(trimmed, isFolder)
    const self = isNew ? '' : baseName(path).toLowerCase()
    const clash = namesIn(dir, knownPaths()).some(
      (n) => n.toLowerCase() === target.toLowerCase() && n.toLowerCase() !== self
    )
    return clash ? `There's already a file named ${target} here` : null
  }

  const startRename = (path: string, isFolder: boolean): void => {
    const s = host.state()
    const rowVisible =
      s.sidebarOpen && !s.focusMode && s.activity === 'files' && !s.compact && (isFolder || knownPaths().includes(path))
    host.update(
      rowVisible
        ? { renaming: { path, isFolder }, menu: null }
        : { dialog: { kind: 'rename', path, isFolder }, menu: null }
    )
  }

  const commitRename = async (path: string, name: string, isFolder: boolean): Promise<void> => {
    host.update({ renaming: null, dialog: null })
    const next = finalName(name.trim(), isFolder)
    if (next === baseName(path)) return
    try {
      const to = await window.api.renamePath(path, next)
      const attr = isFolder ? 'data-folder' : 'data-path'
      host.update(
        (s) => ({ ...remapPaths(s, path, to), tree: remapTree(s.tree, path, to) }),
        () => {
          host.renderDoc(true)
          // Keep keyboard users on the row they just renamed.
          document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(to)}"]`)?.focus()
        }
      )
      void reconcileFolder()
    } catch (err) {
      fail(`Couldn't rename ${baseName(path)}`, err, 'Try a different name.')
    }
  }

  // ---- create / duplicate --------------------------------------------------------

  const addCreated = (file: OpenedFile, folderName: string): void => {
    const s = host.state()
    const inWorkspace = !!s.root && isWithin(file.path, s.root)
    const info = { id: file.path, path: file.path, name: baseName(file.path), dir: dirOf(file.path) }
    host.update((st) => ({
      contents: { ...st.contents, [file.path]: file.content },
      saved: { ...st.saved, [file.path]: file.content },
      tree: inWorkspace ? insertTreeFile(st.tree, info, folderName) : st.tree,
      looseFiles: inWorkspace ? st.looseFiles : [...st.looseFiles, info],
      expanded: { ...st.expanded, [info.dir]: true },
      emptyFolders: st.emptyFolders.filter((d) => d !== info.dir)
    }))
  }

  const folderNameOf = (dir: string): string => host.state().tree.find((f) => f.id === dir)?.name ?? baseName(dir)

  /** A new empty file in `dir`, opened in Edit with its name ready to change. */
  const newFileIn = async (dir: string): Promise<void> => {
    const name = uniqueName('Untitled', '.md', namesIn(dir, knownPaths()))
    try {
      const file = await window.api.createFile(dir, name, '')
      addCreated(file, folderNameOf(dir))
      await docs().openFile(file.path)
      host.update({ viewMode: 'edit', activity: 'files', sidebarOpen: true })
      startRename(file.path, false)
    } catch (err) {
      fail(`Couldn't create a file in ${baseName(dir)}`, err, 'Check that the folder still exists.')
    }
  }

  const newFolderIn = (parent: string): void => host.update({ dialog: { kind: 'newFolder', parent }, menu: null })

  const createFolder = async (parent: string, name: string): Promise<void> => {
    host.update({ dialog: null })
    try {
      const dir = await window.api.createFolder(parent, name.trim())
      host.update((s) => ({
        emptyFolders: [...s.emptyFolders, dir],
        expanded: { ...s.expanded, [dir]: true },
        activity: 'files'
      }))
      host.toast(`Created ${baseName(dir)}`, { label: 'New file in it', run: () => void newFileIn(dir) })
    } catch (err) {
      fail(`Couldn't create ${name}`, err, 'Try a different name.')
    }
  }

  const duplicate = async (path: string): Promise<void> => {
    try {
      const file = await window.api.duplicateFile(path)
      addCreated(file, folderNameOf(dirOf(path)))
      await docs().openFile(file.path)
    } catch (err) {
      fail(`Couldn't duplicate ${baseName(path)}`, err, 'Check that the folder still exists.')
    }
  }

  // ---- trash / reveal / copy ------------------------------------------------------

  const confirmTrash = (path: string, isFolder: boolean): void => {
    const bin = trashName(host.platform)
    const name = baseName(path)
    host.update({
      menu: null,
      dialog: {
        kind: 'confirm',
        title: `Move ${isFolder ? 'folder ' : ''}to ${bin}?`,
        message: isFolder
          ? `“${name}” and everything in it will be moved to the ${bin}. You can restore it from there.`
          : `“${name}” will be moved to the ${bin}. You can restore it from there.`,
        confirmLabel: `Move to ${bin}`,
        danger: true,
        onConfirm: async () => {
          try {
            const ok = await window.api.trashItem(path)
            if (!ok) throw new Error('')
            if (!isFolder) host.update((s) => dropDoc(s, path))
            host.toast(`Moved ${name} to the ${bin}`)
            void reconcileFolder()
          } catch (err) {
            fail(`Couldn't move ${name} to the ${bin}`, err, 'It may be open in another app.')
          }
        }
      }
    })
  }

  const reveal = (path: string): void => {
    window.api
      .revealItem(path)
      .catch((err: unknown) => fail(`Couldn't show ${baseName(path)}`, err, 'It may have been moved or deleted.'))
  }

  const copyPath = (path: string): void => {
    navigator.clipboard
      .writeText(path)
      .then(() => host.toast('Path copied'))
      .catch(() => host.toast("Couldn't copy the path. Try again."))
  }

  // ---- sidebar bookkeeping ----------------------------------------------------------

  const removeLooseGroup = (dir: string): void =>
    host.update((s) => s.looseFiles.filter((f) => f.dir === dir).reduce<DocSlice>((acc, f) => dropDoc(acc, f.path), s))

  const openAllInFolder = (folderId: string): void => {
    const s = host.state()
    const treeFolder = s.tree.find((f) => f.id === folderId)
    const ids = [
      ...(treeFolder ? treeFolder.files.map((f) => f.path) : []),
      ...s.looseFiles
        .filter((f) => f.dir === folderId && !treeFolder?.files.some((tf) => tf.path === f.path))
        .map((f) => f.path)
    ]
    if (!ids.length) return
    host.update((st) => ({
      openTabs: [...st.openTabs, ...ids.filter((p) => !st.openTabs.includes(p))],
      activeId: ids[0],
      expanded: { ...st.expanded, [folderId]: true },
      newPaths: without(st.newPaths, ...ids),
      recents: pushRecents([...ids].reverse(), st.recents)
    }))
    host.toast(`Opened ${plural(ids.length, 'file')} from ${treeFolder ? treeFolder.name : baseName(folderId)}`)
  }

  const togglePin = (id: string): void =>
    host.update((s) => ({ pinned: s.pinned.includes(id) ? s.pinned.filter((p) => p !== id) : [...s.pinned, id] }))

  const toggleFolder = (id: string): void =>
    host.update((s) => ({ expanded: { ...s.expanded, [id]: !(s.expanded[id] ?? true) } }))

  return {
    applyScan,
    openFolderDialog,
    openRecentFolder,
    openFilesDialog,
    addLooseFiles,
    openResult,
    reconcileFolder,
    refreshRecentFolders,
    validateName,
    startRename,
    commitRename,
    newFileIn,
    newFolderIn,
    createFolder,
    duplicate,
    confirmTrash,
    reveal,
    copyPath,
    removeLooseGroup,
    openAllInFolder,
    togglePin,
    toggleFolder
  }
}
