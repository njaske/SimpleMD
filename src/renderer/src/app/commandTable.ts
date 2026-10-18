// Binds every registry command (lib/commands.ts) to its App action. A command
// that has no entry here doesn't show in the palette and its shortcut is inert,
// so later features add a line here instead of a new code path.
import type { CommandId } from '@/lib/commands'
import type { AppHost } from './host'
import type { DocumentActions } from './documents'
import type { ExportActions } from './exporting'
import type { FileActions } from './files'
import type { ViewActions } from './viewActions'
import { dirOf, isUntitled, isWithin, unsavedIds } from './model'

export interface CommandBinding {
  run: () => void
  /** Hidden from the palette and inert when false. */
  enabled?: () => boolean
  /** A palette label that follows state (a toggle says what it will do). */
  label?: () => string
}

export type CommandTable = Partial<Record<CommandId, CommandBinding>>

/** Reader features the App wires up (find bar, change marks, follow the end). */
export interface ReadingCommands {
  find: () => void
  nextChange: () => void
  dismissChanges: () => void
  followEnd: () => void
  /** The active document has "what changed" marks. */
  hasChanges: () => boolean
}

export interface CommandDeps {
  host: AppHost
  docs: DocumentActions
  files: FileActions
  view: ViewActions
  exports: ExportActions
  /** F2: the focused tree row, else the active document. */
  renameTarget: () => { path: string; isFolder: boolean } | null
  reading: ReadingCommands
}

export function buildCommandTable(deps: CommandDeps): CommandTable {
  const { host, docs, files, view, exports, renameTarget, reading } = deps
  const s = (): ReturnType<AppHost['state']> => host.state()
  const hasDoc = (): boolean => !!s().activeId
  const hasFile = (): boolean => !!s().activeId && !isUntitled(s().activeId)
  const inWorkspace = (): boolean => hasFile() && !!s().root && isWithin(s().activeId ?? '', s().root ?? '')
  const active = (): string => s().activeId ?? ''
  const manyTabs = (): boolean => s().openTabs.length > 1
  const changesShown = (): boolean => hasDoc() && s().viewMode !== 'edit' && reading.hasChanges()

  return {
    newDocument: { run: () => void docs.newDocument() },
    openFile: { run: () => void files.openFilesDialog() },
    openFolder: { run: () => void files.openFolderDialog() },
    openRecentFolder: { run: () => view.openPalette('', true), enabled: () => s().recentFolders.length > 0 },
    pasteFromAi: { run: () => void docs.pasteFromAi() },
    save: { run: () => void docs.save(), enabled: hasDoc },
    saveAs: { run: () => void docs.saveAs(active()), enabled: hasDoc },
    saveAll: {
      run: () => {
        if (unsavedIds(s().contents, s().saved).length) void docs.saveAll()
        else host.toast('Everything is already saved')
      }
    },
    reloadFromDisk: { run: () => void docs.reloadFromDisk(), enabled: hasFile },
    closeTab: { run: docs.closeActive, enabled: hasDoc },
    closeOtherTabs: { run: () => docs.closeOthers(), enabled: manyTabs },
    closeAllTabs: { run: docs.closeAll, enabled: hasDoc },
    reopenClosedTab: { run: () => void docs.reopenClosed(), enabled: () => s().closed.length > 0 },
    nextTab: { run: () => docs.cycle(1), enabled: manyTabs },
    previousTab: { run: () => docs.cycle(-1), enabled: manyTabs },
    quickOpen: { run: () => view.openPalette('') },
    commandPalette: { run: () => view.openPalette('>') },
    findInDocument: { run: reading.find, enabled: hasDoc },
    searchAllFiles: { run: view.searchAll },
    viewRead: { run: () => view.setView('read'), enabled: hasDoc },
    viewSplit: { run: () => view.setView('split'), enabled: hasDoc },
    viewEdit: { run: () => view.setView('edit'), enabled: hasDoc },
    toggleReadEdit: { run: view.toggleReadEdit, enabled: hasDoc },
    toggleSidebar: { run: view.toggleSidebar },
    toggleOutline: {
      // Below the outline breakpoint there's no room for it: say so instead of a silent toggle.
      run: () => (s().narrow ? host.toast('Make the window wider to show the outline.') : view.toggleOutline()),
      enabled: hasDoc
    },
    toggleStatusBar: {
      run: view.toggleStatusBar,
      label: () => (s().showStatusBar ? 'Hide status bar' : 'Show status bar')
    },
    focusMode: { run: view.toggleFocus, label: () => (s().focusMode ? 'Leave focus mode' : 'Focus mode') },
    toggleTheme: { run: view.toggleTheme },
    themeLight: { run: () => view.setTheme('light') },
    themeDark: { run: () => view.setTheme('dark') },
    themeSepia: { run: () => view.setTheme('sepia') },
    themeSystem: { run: () => view.setTheme('system') },
    textBigger: { run: () => view.textSize(1) },
    textSmaller: { run: () => view.textSize(-1) },
    textReset: { run: () => view.textSize('reset') },
    toggleSyncScroll: {
      run: view.toggleSyncScroll,
      label: () => (s().syncScroll ? 'Turn off synced scrolling' : 'Turn on synced scrolling')
    },
    toggleRemoteImages: {
      run: view.toggleRemoteImages,
      label: () => (s().blockRemoteImages ? 'Allow remote images' : 'Block remote images')
    },
    nextChange: { run: reading.nextChange, enabled: changesShown },
    dismissChanges: { run: reading.dismissChanges, enabled: changesShown },
    // Following only makes sense for a file something else can grow.
    followEnd: { run: reading.followEnd, enabled: hasFile },
    rename: {
      run: () => {
        const t = renameTarget()
        if (t) files.startRename(t.path, t.isFolder)
        else if (isUntitled(s().activeId)) void docs.saveAs(active())
      },
      // A focused tree row can be renamed even with no tab open.
      enabled: () => hasDoc() || renameTarget() !== null
    },
    duplicate: { run: () => void files.duplicate(active()), enabled: hasFile },
    openAllWorkspaceFiles: { run: files.openWorkspaceFiles, enabled: () => s().tree.length > 0 },
    newFileInFolder: {
      run: () => void files.newFileIn(inWorkspace() ? dirOf(active()) : (s().root ?? '')),
      enabled: () => !!s().root
    },
    newFolder: {
      run: () => files.newFolderIn(inWorkspace() ? dirOf(active()) : (s().root ?? '')),
      enabled: () => !!s().root
    },
    revealInFolder: { run: () => files.reveal(active()), enabled: hasFile },
    copyPath: { run: () => files.copyPath(active()), enabled: hasFile },
    moveToTrash: { run: () => files.confirmTrash(active(), false), enabled: hasFile },
    exportPdf: { run: exports.exportPdf, enabled: hasDoc },
    exportHtml: { run: exports.exportHtml, enabled: hasDoc },
    copyRichText: { run: exports.copyRichText, enabled: hasDoc },
    print: { run: exports.print, enabled: hasDoc },
    settings: { run: () => view.openSettings('appearance') },
    shortcuts: { run: () => view.openSettings('shortcuts') }
  }
}
