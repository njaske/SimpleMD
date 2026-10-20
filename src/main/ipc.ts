import { BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { dirname } from 'path'
import { isApproved, isApprovedFile, isApprovedRoot } from './access'
import { isMarkdownFile, readImageDataUrl, readMdFile, readMdFiles, resolveDrop, saveMdFile, scanFolder } from './fs-md'
import { forgetPath, grantFiles, grantRoot } from './grants'
import { registerWorkspaceIpc } from './ipc-workspace'
import { loadSettings, saveSettings } from './settings'
import { extractLaunchPaths } from './launch'
import { clampZoom, windowBackground } from './platform'
import { pickRendererSettings } from './settings-schema'
import { watchFolder } from './watcher'
import type { DropResult } from '../shared/types'

export { restoreAccess } from './grants'

/** A BrowserWindow carrying close-guard flags set over IPC. */
type GuardedWindow = BrowserWindow & { _hasUnsaved?: boolean; _forceClose?: boolean }

// Files/folders given on the command line (double-click, "Open with", a second
// launch while SimpleMD is already running, macOS `open-file`). The user chose
// them in the shell, so they are granted like a dialog pick. Held until the
// renderer asks for them; once a window has taken them, later opens are sent.
let pendingLaunch: DropResult | null = null
const launchTaken = new WeakSet<Electron.WebContents>()

/** Two launch results as one: the newer folder wins, files are combined. */
function mergeLaunch(earlier: DropResult | null, later: DropResult): DropResult {
  if (!earlier) return later
  const newer = new Set(later.files.map((f) => f.path))
  return {
    folder: later.folder ?? earlier.folder,
    files: [...earlier.files.filter((f) => !newer.has(f.path)), ...later.files]
  }
}

async function resolveLaunch(args: readonly string[], cwd: string): Promise<DropResult | null> {
  const paths = extractLaunchPaths(args, cwd)
  if (!paths.length) return null
  const result = await resolveDrop(paths)
  if (!result.folder && result.files.length === 0) return null
  if (result.folder) await grantRoot(result.folder.root)
  await grantFiles(result.files.map((f) => f.path))
  return result
}

/** Called once at startup with the process arguments (without the executable)
 *  and any macOS `open-file` paths that arrived before the app was ready. */
export async function prepareLaunch(args: readonly string[], cwd: string): Promise<void> {
  const result = await resolveLaunch(args, cwd)
  if (result) pendingLaunch = mergeLaunch(pendingLaunch, result)
}

/** Called when the user opens files from the shell while SimpleMD is running
 *  (second instance on Windows/Linux, `open-file` on macOS). A window whose page
 *  hasn't asked for its launch files yet receives them that way instead. */
export async function openFromSecondInstance(
  args: readonly string[],
  cwd: string,
  win: BrowserWindow | null
): Promise<void> {
  const result = await resolveLaunch(args, cwd)
  if (!result) return
  if (!win || win.isDestroyed() || !launchTaken.has(win.webContents)) {
    pendingLaunch = mergeLaunch(pendingLaunch, result)
    return
  }
  if (result.folder) watchFolder(result.folder.root, win.webContents)
  win.webContents.send('app:open-paths', result)
}

/** A file the document IPC may read or write: a Markdown file inside an opened folder,
 *  or a file the user opened individually. Anything else in a workspace (git hooks,
 *  scripts, .env, editor settings) stays out of reach even of a compromised page. */
function isDocumentPath(path: unknown): path is string {
  return isApprovedFile(path) || (isApproved(path) && isMarkdownFile(path))
}

function denied(): never {
  throw new Error('Access denied: this path was not opened in SimpleMD')
}

/** Clipboard text larger than this is refused (a pasted document, not a dump). */
const MAX_CLIPBOARD_CHARS = 5 * 1024 * 1024

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
  ipcMain.handle('app:takeLaunchFiles', (event) => {
    const pending = pendingLaunch
    pendingLaunch = null
    launchTaken.add(event.sender)
    if (pending?.folder) watchFolder(pending.folder.root, event.sender)
    return pending
  })

  ipcMain.handle('fs:scanFolder', async (event, path: unknown) => {
    if (!isApprovedRoot(path)) denied()
    const scan = await scanFolder(path)
    if (scan) watchFolder(path, event.sender)
    return scan
  })

  ipcMain.handle('fs:readFile', (_event, path: unknown) => {
    if (!isDocumentPath(path)) denied()
    return readMdFile(path)
  })

  ipcMain.handle('fs:saveFile', async (_event, path: unknown, content: string) => {
    if (!isDocumentPath(path)) denied()
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
  ipcMain.handle('settings:set', async (_event, partial: unknown) => {
    const picked = pickRendererSettings(partial)
    const saved = await saveSettings(picked)
    // Keep the native window fill in step, so a resize never flashes the old theme.
    if (picked.theme) {
      const color = windowBackground(picked.theme, nativeTheme.shouldUseDarkColors)
      for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(color)
    }
    return saved
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url)
  })

  ipcMain.handle('shell:trashItem', async (_event, path: unknown) => {
    // The open workspace itself is never trashed from the app, only what's inside it.
    if (!isApproved(path) || isApprovedRoot(path)) return false
    try {
      await shell.trashItem(path)
      await forgetPath(path)
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

  ipcMain.handle('win:setZoom', (event, factor: unknown) => {
    if (typeof factor !== 'number' || !Number.isFinite(factor)) return
    event.sender.setZoomFactor(clampZoom(factor))
  })

  ipcMain.handle('win:toggleFullScreen', (event) => {
    const win = senderWindow(event)
    if (!win) return false
    win.setFullScreen(!win.isFullScreen())
    return win.isFullScreen()
  })

  ipcMain.handle('clipboard:readText', () => {
    const text = clipboard.readText()
    return text.length > MAX_CLIPBOARD_CHARS ? '' : text
  })

  ipcMain.handle('clipboard:writeRich', (_event, html: unknown, text: unknown) => {
    if (typeof html !== 'string' || typeof text !== 'string') return
    clipboard.write({ html, text })
  })

  registerWorkspaceIpc()
}
