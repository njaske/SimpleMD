import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { isApproved } from './access'
import { withMarkdownExtension } from './file-ops'
import { saveMdFile } from './fs-md'
import { grantFiles, settingsStore } from './grants'
import { saveRecovery } from './recovery-store'
import { chosenPath, exportStem, suggestedName } from './save-paths'
import { loadSettings } from './settings'
import { watchFolder } from './watcher'
import {
  createFileIn,
  createFolderIn,
  duplicateApproved,
  openRecentFolder,
  recoveryLoader,
  renameApproved,
  writeImageAsset
} from './workspace-ops'
import type { FolderScan } from '../shared/types'

// IPC for creating and changing files: new file / folder, rename, duplicate,
// Save As, pasted images, HTML/PDF export, crash recovery and recent folders.
// The access decisions live in workspace-ops (electron-free, unit-tested); this
// file adds the Save dialogs (names and paths from save-paths) and the folder watcher.

/** A standalone HTML export larger than this is refused (inlined images included). */
const MAX_EXPORT_CHARS = 64 * 1024 * 1024
const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'markdn'] },
  { name: 'All files', extensions: ['*'] }
]

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.lstat(path)
    return true
  } catch {
    return false
  }
}

/** Where Save dialogs start: the open workspace, else the Documents folder. */
async function dialogFolder(): Promise<string> {
  const settings = await loadSettings()
  const last = settings.lastFolder
  return typeof last === 'string' && (await isDirectory(last)) ? last : app.getPath('documents')
}

/** When we added the extension ourselves the dialog never asked about replacing
 *  that name, so ask now. */
async function confirmReplace(win: BrowserWindow, target: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Replace', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: `“${basename(target)}” already exists.`,
    detail: 'Replacing it will overwrite its contents.'
  })
  return response === 0
}

async function showSaveDialog(
  win: BrowserWindow,
  options: { title: string; name: string; filters: Electron.FileFilter[]; ext: string }
): Promise<string | null> {
  const result = await dialog.showSaveDialog(win, {
    title: options.title,
    defaultPath: join(await dialogFolder(), options.name),
    filters: options.filters,
    properties: ['createDirectory', 'showOverwriteConfirmation']
  })
  if (result.canceled || !result.filePath) return null
  const target = chosenPath(result.filePath, options.ext)
  if (target !== result.filePath && (await exists(target)) && !(await confirmReplace(win, target))) {
    return null
  }
  return target
}

function recoveryDir(): string {
  return join(app.getPath('userData'), 'recovery')
}

async function reopenRecentFolder(event: Electron.IpcMainInvokeEvent, path: unknown): Promise<FolderScan | null> {
  const scan = await openRecentFolder(settingsStore, path)
  if (scan) watchFolder(scan.root, event.sender)
  return scan
}

async function saveAs(event: Electron.IpcMainInvokeEvent, defaultName: unknown, content: unknown): Promise<string | null> {
  if (typeof content !== 'string') throw new Error('Invalid content')
  const win = senderWindow(event)
  if (!win) return null
  const target = await showSaveDialog(win, {
    title: 'Save as',
    name: withMarkdownExtension(suggestedName(defaultName, 'Untitled.md')),
    filters: MARKDOWN_FILTERS,
    ext: '.md'
  })
  if (!target) return null
  await saveMdFile(target, content)
  await grantFiles([target])
  return target
}

async function exportHtml(event: Electron.IpcMainInvokeEvent, defaultName: unknown, html: unknown): Promise<string | false> {
  if (typeof html !== 'string') throw new Error('Invalid export')
  if (html.length > MAX_EXPORT_CHARS) throw new Error('This document is too large to export as HTML.')
  const win = senderWindow(event)
  if (!win) return false
  const target = await showSaveDialog(win, {
    title: 'Export to HTML',
    name: `${exportStem(defaultName)}.html`,
    filters: [{ name: 'Web page', extensions: ['html', 'htm'] }],
    ext: '.html'
  })
  if (!target) return false
  await saveMdFile(target, html)
  return target
}

async function exportPdf(event: Electron.IpcMainInvokeEvent, defaultName: unknown): Promise<string | false> {
  const win = senderWindow(event)
  if (!win) return false
  const target = await showSaveDialog(win, {
    title: 'Export to PDF',
    name: `${exportStem(defaultName)}.pdf`,
    filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    ext: '.pdf'
  })
  if (!target) return false
  const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  await fs.writeFile(target, data)
  return target
}

export function registerWorkspaceIpc(): void {
  const loadRecoveredBuffers = recoveryLoader(recoveryDir)

  ipcMain.handle('fs:openRecentFolder', reopenRecentFolder)
  ipcMain.handle('fs:createFile', (_event, dir: unknown, name: unknown, content: unknown) =>
    createFileIn(dir, name, content)
  )
  ipcMain.handle('fs:createFolder', (_event, parent: unknown, name: unknown) => createFolderIn(parent, name))
  ipcMain.handle('fs:renamePath', (_event, path: unknown, newName: unknown) =>
    renameApproved(settingsStore, path, newName)
  )
  ipcMain.handle('fs:duplicateFile', (_event, path: unknown) => duplicateApproved(settingsStore, path))
  ipcMain.handle('dialog:saveAs', saveAs)
  ipcMain.handle('fs:writeAsset', (_event, docPath: unknown, fileName: unknown, data: unknown) =>
    writeImageAsset(docPath, fileName, data)
  )
  ipcMain.handle('export:html', exportHtml)
  ipcMain.handle('export:pdf', exportPdf)
  ipcMain.handle('recovery:save', (_event, entries: unknown) =>
    saveRecovery(recoveryDir(), entries, (path) => isApproved(path))
  )
  ipcMain.handle('recovery:load', () => loadRecoveredBuffers())
}
