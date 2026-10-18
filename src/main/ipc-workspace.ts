import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { basename, extname, join, resolve } from 'path'
import {
  approveFile,
  containsApprovedRoot,
  isApproved,
  isApprovedRoot,
  isInsideApprovedRoot,
  isLocalAbsolute
} from './access'
import { writeAsset } from './assets'
import {
  createFile,
  createFolder,
  duplicateFile,
  hasUnsafeExtension,
  nameProblem,
  renamePath,
  withMarkdownExtension
} from './file-ops'
import { readMdFile, saveMdFile, scanFolder } from './fs-md'
import { grantFiles, grantRoot, moveGrants } from './grants'
import { isRecentFolder, removeRecentFolder } from './recent-folders'
import { loadRecovery, saveRecovery } from './recovery-store'
import { loadSettings, saveSettings } from './settings'
import type { FolderScan, OpenedFile, RecoveryEntry } from '../shared/types'

// IPC for creating and changing files: new file / folder, rename, duplicate,
// Save As, pasted images, HTML/PDF export, crash recovery and recent folders. Every
// handler checks the allow-list first; the filesystem work lives in
// electron-free modules (file-ops, assets, recovery-store) that are unit-tested.

/** A standalone HTML export larger than this is refused (inlined images included). */
const MAX_EXPORT_CHARS = 64 * 1024 * 1024
const MARKDOWN_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'markdn'] },
  { name: 'All files', extensions: ['*'] }
]

function denied(): never {
  throw new Error('Access denied: this path was not opened in SimpleMD')
}

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

/** A workspace folder new files and folders may be created in. */
async function assertWorkspaceFolder(dir: unknown): Promise<string> {
  if (!isInsideApprovedRoot(dir)) denied()
  if (!(await isDirectory(dir))) throw new Error('That folder no longer exists.')
  return resolve(dir)
}

/** A bare, valid file name for a Save dialog, from whatever the renderer sent. */
function suggestedName(defaultName: unknown, fallback: string): string {
  const raw = typeof defaultName === 'string' ? basename(defaultName.replace(/\\/g, '/')).trim() : ''
  return raw && !nameProblem(raw, 'file') ? raw : fallback
}

/** Where Save dialogs start: the open workspace, else the Documents folder. */
async function dialogFolder(): Promise<string> {
  const settings = await loadSettings()
  const last = settings.lastFolder
  return typeof last === 'string' && (await isDirectory(last)) ? last : app.getPath('documents')
}

/** The path the user chose, with `ext` added when they typed no extension.
 *  Refuses runnable file types and network locations. */
function chosenPath(filePath: string, ext: string): string {
  const target = extname(filePath) === '' ? `${filePath}${ext}` : filePath
  if (hasUnsafeExtension(target)) throw new Error('SimpleMD can’t save files of that type.')
  if (!isLocalAbsolute(target)) {
    throw new Error('SimpleMD can’t save to network locations. Choose a folder on this computer.')
  }
  return target
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

async function openRecentFolder(event: Electron.IpcMainInvokeEvent, path: unknown): Promise<FolderScan | null> {
  const settings = await loadSettings()
  if (!isRecentFolder(settings.recentFolders, path)) return null
  const scan = await scanFolder(path)
  if (!scan) {
    await saveSettings({ recentFolders: removeRecentFolder(settings.recentFolders, path) })
    return null
  }
  await grantRoot(path, event.sender)
  return scan
}

async function renameApproved(path: unknown, newName: unknown): Promise<string> {
  if (!isApproved(path)) denied()
  if (isApprovedRoot(path) || containsApprovedRoot(path)) {
    throw new Error('This folder is open in SimpleMD, so it can’t be renamed here.')
  }
  const from = resolve(path)
  if ((await isDirectory(from)) && !isInsideApprovedRoot(from)) denied()
  const to = await renamePath(from, newName)
  if (to !== from) await moveGrants(from, to)
  return to
}

async function duplicateApproved(path: unknown): Promise<OpenedFile> {
  if (!isApproved(path)) denied()
  const copy = await duplicateFile(resolve(path))
  // A copy of a loose file sits outside any workspace, so it needs its own grant.
  if (!isInsideApprovedRoot(copy)) await grantFiles([copy])
  return { path: copy, content: await readMdFile(copy) }
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

/** A bare stem for an export's file name ("notes.md" becomes "notes"). */
function exportStem(defaultName: unknown): string {
  return suggestedName(defaultName, 'document').replace(/\.[^.]+$/, '') || 'document'
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

async function writeImageAsset(docPath: unknown, fileName: unknown, data: unknown): Promise<string> {
  if (!isApproved(docPath)) denied()
  // A folder (an approved root) is not a document: its parent is outside the grant.
  const stat = await fs.stat(docPath)
  if (!stat.isFile()) denied()
  return writeAsset(resolve(docPath), fileName, data)
}

async function loadRecoveredBuffers(): Promise<RecoveryEntry[]> {
  const entries = await loadRecovery(recoveryDir())
  // The main process wrote these paths itself, after an access check.
  for (const entry of entries) if (entry.path) approveFile(entry.path)
  return entries
}

export function registerWorkspaceIpc(): void {
  ipcMain.handle('fs:openRecentFolder', openRecentFolder)

  ipcMain.handle('fs:createFile', async (_event, dir: unknown, name: unknown, content: unknown) => {
    const folder = await assertWorkspaceFolder(dir)
    const text = content === undefined || content === null ? '' : content
    if (typeof text !== 'string') throw new Error('Invalid content')
    const path = await createFile(folder, name, text)
    return { path, content: text } satisfies OpenedFile
  })

  ipcMain.handle('fs:createFolder', async (_event, parent: unknown, name: unknown) =>
    createFolder(await assertWorkspaceFolder(parent), name)
  )

  ipcMain.handle('fs:renamePath', (_event, path: unknown, newName: unknown) => renameApproved(path, newName))
  ipcMain.handle('fs:duplicateFile', (_event, path: unknown) => duplicateApproved(path))
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
