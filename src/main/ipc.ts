import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'fs/promises'
import { dirname } from 'path'
import { approveFile, approveRoot, isApproved, isApprovedRoot } from './access'
import { readImageDataUrl, readMdFile, readMdFiles, resolveDrop, saveMdFile, scanFolder } from './fs-md'
import { loadSettings, saveSettings } from './settings'
import { pickRendererSettings } from './settings-schema'
import { watchFolder } from './watcher'

/** A BrowserWindow carrying close-guard flags set over IPC. */
type GuardedWindow = BrowserWindow & { _hasUnsaved?: boolean; _forceClose?: boolean }

const MAX_APPROVED_FILES = 500

/** Grant and persist access to individually opened files (dialog or drop). */
async function grantFiles(paths: string[]): Promise<void> {
  if (!paths.length) return
  paths.forEach(approveFile)
  const settings = await loadSettings()
  const merged = [...new Set([...paths, ...(settings.approvedFiles ?? [])])]
  await saveSettings({ approvedFiles: merged.slice(0, MAX_APPROVED_FILES) })
}

/** Grant access to a workspace folder and remember it as the last folder. */
async function grantRoot(root: string, sender: Electron.WebContents): Promise<void> {
  approveRoot(root)
  await saveSettings({ lastFolder: root })
  watchFolder(root, sender)
}

/** Re-grant what the user opened in earlier sessions. Older settings files have
 *  no `approvedFiles`, so their loose files are trusted once to migrate. */
export async function restoreAccess(): Promise<void> {
  const settings = await loadSettings()
  if (typeof settings.lastFolder === 'string') approveRoot(settings.lastFolder)
  const migrating = !Array.isArray(settings.approvedFiles)
  const source = migrating ? settings.looseFiles : settings.approvedFiles
  const approved = Array.isArray(source) ? source.filter((p): p is string => typeof p === 'string') : []
  approved.forEach(approveFile)
  if (migrating) await saveSettings({ approvedFiles: approved })
}

function denied(): never {
  throw new Error('Access denied: this path was not opened in SimpleMD')
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function registerIpc(): void {
  ipcMain.handle('dialog:openFolder', async (event) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open a folder of Markdown files',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const root = result.filePaths[0]
    const scan = await scanFolder(root)
    if (scan) await grantRoot(root, event.sender)
    return scan
  })

  ipcMain.handle('dialog:openFiles', async (event) => {
    const win = senderWindow(event)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open Markdown files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'markdn'] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const opened = await readMdFiles(result.filePaths)
    await grantFiles(opened.map((f) => f.path))
    return opened
  })

  // The preload resolves these from real dropped File objects (webUtils).
  ipcMain.handle('fs:resolveDrop', async (event, paths: unknown) => {
    const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []
    const result = await resolveDrop(list)
    if (result.folder) await grantRoot(result.folder.root, event.sender)
    await grantFiles(result.files.map((f) => f.path))
    return result
  })

  // Re-scan a folder the user already opened (startup restore, external changes).
  ipcMain.handle('fs:scanFolder', async (event, path: unknown) => {
    if (!isApprovedRoot(path)) denied()
    const scan = await scanFolder(path)
    if (scan) watchFolder(path, event.sender)
    return scan
  })

  ipcMain.handle('fs:readFile', (_event, path: unknown) => {
    if (!isApproved(path)) denied()
    return readMdFile(path)
  })

  ipcMain.handle('fs:saveFile', async (_event, path: unknown, content: string) => {
    if (!isApproved(path)) denied()
    await saveMdFile(path, content)
    return true
  })

  ipcMain.handle('fs:readImage', async (_event, docPath: unknown, src: unknown) => {
    if (!isApproved(docPath) || typeof src !== 'string') return null
    const settings = await loadSettings()
    const roots = [dirname(docPath)]
    if (settings.lastFolder) roots.push(settings.lastFolder)
    return readImageDataUrl(docPath, src, roots)
  })

  ipcMain.handle('settings:get', () => loadSettings())

  // `lastFolder` widens the image-read roots, so only the main process (folder
  // dialog / drop) may set it; the renderer may persist display state only.
  ipcMain.handle('settings:set', (_event, partial: unknown) =>
    saveSettings(pickRendererSettings(partial))
  )

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('shell:trashItem', async (_event, path: unknown) => {
    if (!isApproved(path)) return false
    try {
      await shell.trashItem(path)
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('shell:revealItem', (_event, path: unknown) => {
    if (isApproved(path)) shell.showItemInFolder(path)
  })

  ipcMain.handle('win:minimize', (event) => senderWindow(event)?.minimize())

  ipcMain.handle('win:maximizeToggle', (event) => {
    const win = senderWindow(event)
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle('win:close', (event) => senderWindow(event)?.close())

  ipcMain.handle('win:setUnsaved', (event, hasUnsaved: boolean) => {
    const win = senderWindow(event) as GuardedWindow | null
    if (win) win._hasUnsaved = !!hasUnsaved
  })

  ipcMain.handle('win:forceClose', (event) => {
    const win = senderWindow(event) as GuardedWindow | null
    if (win) {
      win._forceClose = true
      win.close()
    }
  })

  ipcMain.handle('win:isMaximized', (event) => !!senderWindow(event)?.isMaximized())

  ipcMain.handle('export:pdf', async (event, defaultName: string) => {
    const win = senderWindow(event)
    if (!win) return false
    const base = (defaultName || 'document').replace(/\.[^.]+$/, '')
    const result = await dialog.showSaveDialog(win, {
      title: 'Export to PDF',
      defaultPath: `${base}.pdf`,
      filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
    })
    if (result.canceled || !result.filePath) return false
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4'
    })
    await writeFile(result.filePath, data)
    return result.filePath
  })
}
