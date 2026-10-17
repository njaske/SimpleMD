import { app, BrowserWindow, Menu, session, shell } from 'electron'
import { join } from 'path'
import { openFromSecondInstance, prepareLaunch, registerIpc, restoreAccess } from './ipc'
import { saveSettings, settingsWritten } from './settings'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const isDev = !!RENDERER_DEV_URL

// Strict CSP in production (bundled code only); permissive in development so the
// Vite dev server's inline HMR scripts work. Only remote scripts are ever
// blocked; rendered Markdown is separately sanitized with DOMPurify.
const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data: blob: https:; font-src 'self' data:; " +
  "connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'; " +
  "form-action 'none'; frame-ancestors 'none'"
const DEV_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: ws: http: https:; " +
  "img-src 'self' data: blob: http: https:"

function applyContentSecurityPolicy(): void {
  const policy = isDev ? DEV_CSP : PROD_CSP
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy]
      }
    })
  })
}

// A document viewer never needs camera, microphone, geolocation, etc.
function denyPermissionRequests(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1a',
    autoHideMenuBar: true,
    icon: join(app.getAppPath(), 'build', 'icon.ico'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    }
  })

  win.once('ready-to-show', () => win.show())

  const broadcastMaximize = (): void =>
    win.webContents.send('win:maximizeChanged', win.isMaximized())
  win.on('maximize', broadcastMaximize)
  win.on('unmaximize', broadcastMaximize)

  // Unsaved-changes guard: if the renderer reported unsaved edits, defer the
  // close and let it show the confirm dialog (it will call win:forceClose).
  const guarded = win as BrowserWindow & { _hasUnsaved?: boolean; _forceClose?: boolean }
  win.on('close', (event) => {
    if (guarded._forceClose || !guarded._hasUnsaved) return
    event.preventDefault()
    win.webContents.send('app:request-close')
  })

  // Keep navigation inside the app; route external links to the OS browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    }
  })

  if (RENDERER_DEV_URL) {
    win.loadURL(RENDERER_DEV_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
    // In development argv carries Electron's own arguments, not user files.
    if (app.isPackaged) void openFromSecondInstance(argv.slice(1), workingDirectory, win)
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.simplemd.app')
    Menu.setApplicationMenu(null)
    // Optional: open a specific folder on launch (also used for first-run defaults).
    const initialFolder = process.env['SIMPLEMD_INITIAL_FOLDER']
    if (initialFolder) await saveSettings({ lastFolder: initialFolder })
    await restoreAccess()
    if (app.isPackaged) await prepareLaunch(process.argv.slice(1), process.cwd())
    applyContentSecurityPolicy()
    denyPermissionRequests()
    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Let the last settings write (tabs, theme, ...) reach disk before exiting.
  let settingsFlushed = false
  app.on('before-quit', (event) => {
    if (settingsFlushed) return
    settingsFlushed = true
    event.preventDefault()
    // One macrotask first, so a save the closing window just sent is queued.
    setTimeout(() => void settingsWritten().finally(() => app.quit()), 0)
  })

  if (isDev) {
    // Surface uncaught main-process errors during development.
    process.on('uncaughtException', (err) => console.error('[main]', err))
  }
}
