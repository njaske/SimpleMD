// Context menus for tabs, files and folders, and the document (⋯) menu. Uses the
// platform's own words ("Show in Finder", "Move to Recycle Bin").
import type { MenuEntry } from '@/components/ContextMenu'
import { formatShortcut, revealLabel, trashName } from '@/lib/logic/platform'
import {
  BookmarkIcon,
  CheckIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderPlusIcon,
  LayersIcon,
  OpenAllIcon,
  PencilIcon,
  PrinterIcon,
  RefreshIcon,
  RevealIcon,
  TrashIcon
} from '@/lib/icons'
import type { AppHost } from './host'
import type { DocumentActions } from './documents'
import type { ExportActions } from './exporting'
import type { FileActions } from './files'
import { dirOf, isDirtyIn, isUntitled, isWithin, tabsRightOf } from './model'
import { tabLabel } from './view'

export interface MenuDeps {
  host: AppHost
  docs: DocumentActions
  files: FileActions
  exports: ExportActions
}

const SEP: MenuEntry = { separator: true }
const ICON = 15


/** Every open tab, for the strip's overflow button: the active one is checked. */
export function tabListMenu({ host, docs }: MenuDeps, nameOf: (id: string) => string): MenuEntry[] {
  const s = host.state()
  return s.openTabs.map((id) => ({
    label: tabLabel(nameOf(id)),
    icon: id === s.activeId ? <CheckIcon size={ICON} /> : <FileTextIcon size={ICON} />,
    hint: isDirtyIn(s.contents, s.saved, id) ? 'Unsaved' : undefined,
    onSelect: () => void docs.openFile(id)
  }))
}

export function tabMenu({ host, docs, files }: MenuDeps, id: string): MenuEntry[] {
  const s = host.state()
  const p = host.platform
  const untitled = isUntitled(id)
  const pinned = s.pinned.includes(id)
  return [
    {
      label: 'Close',
      hint: formatShortcut('Mod+W', p),
      icon: <CloseIcon size={ICON} />,
      onSelect: () => docs.requestClose([id])
    },
    { label: 'Close others', disabled: s.openTabs.length < 2, onSelect: () => docs.closeOthers(id) },
    { label: 'Close to the right', disabled: !tabsRightOf(s.openTabs, id).length, onSelect: () => docs.closeRight(id) },
    SEP,
    {
      label: pinned ? 'Unpin' : 'Pin',
      icon: <BookmarkIcon size={ICON} />,
      disabled: untitled,
      onSelect: () => files.togglePin(id)
    },
    { label: 'Copy path', icon: <CopyIcon size={ICON} />, disabled: untitled, onSelect: () => files.copyPath(id) },
    { label: revealLabel(p), icon: <RevealIcon size={ICON} />, disabled: untitled, onSelect: () => files.reveal(id) }
  ]
}

export function fileMenu({ host, docs, files }: MenuDeps, id: string): MenuEntry[] {
  const s = host.state()
  const p = host.platform
  const isLoose = s.looseFiles.some((f) => f.path === id)
  const inWorkspace = !!s.root && isWithin(id, s.root)
  const items: MenuEntry[] = [
    { label: 'Open', onSelect: () => void docs.openFile(id) },
    {
      label: s.pinned.includes(id) ? 'Unpin' : 'Pin',
      icon: <BookmarkIcon size={ICON} />,
      onSelect: () => files.togglePin(id)
    },
    SEP,
    {
      label: 'Rename…',
      hint: formatShortcut('F2', p),
      icon: <PencilIcon size={ICON} />,
      onSelect: () => files.startRename(id, false)
    },
    { label: 'Duplicate', icon: <LayersIcon size={ICON} />, onSelect: () => void files.duplicate(id) }
  ]
  if (inWorkspace)
    items.push({
      label: 'New file here',
      icon: <FilePlusIcon size={ICON} />,
      onSelect: () => void files.newFileIn(dirOf(id))
    })
  items.push(
    SEP,
    { label: 'Copy path', onSelect: () => files.copyPath(id) },
    { label: revealLabel(p), icon: <RevealIcon size={ICON} />, onSelect: () => files.reveal(id) }
  )
  if (isLoose) items.push({ label: 'Remove from sidebar', onSelect: () => docs.forget(id) })
  items.push(SEP, {
    label: `Move to ${trashName(p)}`,
    danger: true,
    icon: <TrashIcon size={ICON} />,
    onSelect: () => files.confirmTrash(id, false)
  })
  return items
}

export function folderMenu({ host, files }: MenuDeps, folderId: string): MenuEntry[] {
  const s = host.state()
  const p = host.platform
  const inWorkspace = !!s.root && isWithin(folderId, s.root)
  const isRoot = folderId === s.root
  const items: MenuEntry[] = [
    { label: 'Open all files', icon: <OpenAllIcon size={ICON} />, onSelect: () => files.openAllInFolder(folderId) }
  ]
  if (inWorkspace) {
    items.push(
      { label: 'New file here', icon: <FilePlusIcon size={ICON} />, onSelect: () => void files.newFileIn(folderId) },
      { label: 'New folder here…', icon: <FolderPlusIcon size={ICON} />, onSelect: () => files.newFolderIn(folderId) }
    )
    if (!isRoot)
      items.push({
        label: 'Rename…',
        hint: formatShortcut('F2', p),
        icon: <PencilIcon size={ICON} />,
        onSelect: () => files.startRename(folderId, true)
      })
  }
  items.push(
    SEP,
    { label: 'Copy path', icon: <CopyIcon size={ICON} />, onSelect: () => files.copyPath(folderId) },
    { label: revealLabel(p), icon: <RevealIcon size={ICON} />, onSelect: () => files.reveal(folderId) }
  )
  if (inWorkspace && !isRoot) {
    items.push(SEP, {
      label: `Move folder to ${trashName(p)}`,
      danger: true,
      icon: <TrashIcon size={ICON} />,
      onSelect: () => files.confirmTrash(folderId, true)
    })
  } else if (!inWorkspace) {
    items.push(SEP, { label: 'Remove from sidebar', onSelect: () => files.removeLooseGroup(folderId) })
  }
  return items
}

/** The ⋯ menu for the active document. */
export function documentMenu({ host, docs, files, exports }: MenuDeps): MenuEntry[] {
  const s = host.state()
  const p = host.platform
  const id = s.activeId
  if (!id) return []
  const untitled = isUntitled(id)
  const items: MenuEntry[] = [
    {
      label: 'Export PDF…',
      hint: formatShortcut('Mod+Shift+E', p),
      icon: <DownloadIcon size={ICON} />,
      onSelect: exports.exportPdf
    },
    { label: 'Export HTML…', icon: <DownloadIcon size={ICON} />, onSelect: exports.exportHtml },
    { label: 'Copy as rich text', icon: <CopyIcon size={ICON} />, onSelect: exports.copyRichText },
    { label: 'Print…', icon: <PrinterIcon size={ICON} />, onSelect: exports.print },
    SEP
  ]
  if (untitled) {
    items.push({ label: 'Save as…', hint: formatShortcut('Mod+Shift+S', p), onSelect: () => void docs.saveAs(id) })
    return items
  }
  items.push(
    { label: revealLabel(p), icon: <RevealIcon size={ICON} />, onSelect: () => files.reveal(id) },
    { label: 'Copy path', icon: <CopyIcon size={ICON} />, onSelect: () => files.copyPath(id) },
    { label: 'Reload from disk', icon: <RefreshIcon size={ICON} />, onSelect: () => void docs.reloadFromDisk(id) },
    SEP,
    {
      label: 'Rename…',
      hint: formatShortcut('F2', p),
      icon: <PencilIcon size={ICON} />,
      onSelect: () => files.startRename(id, false)
    },
    { label: 'Duplicate', icon: <LayersIcon size={ICON} />, onSelect: () => void files.duplicate(id) },
    SEP,
    {
      label: `Move to ${trashName(p)}`,
      danger: true,
      icon: <TrashIcon size={ICON} />,
      onSelect: () => files.confirmTrash(id, false)
    }
  )
  return items
}
