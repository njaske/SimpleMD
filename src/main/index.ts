import { app, BrowserWindow, Menu, nativeTheme, session, shell } from 'electron'
import { join } from 'path'
import { openFromSecondInstance, prepareLaunch, registerIpc, restoreAccess } from './ipc'
import { extractLaunchPaths } from './launch'
import { macMenuTemplate, usesSpellcheck, windowBackground, windowChrome } from './platform'
import { loadSettings, saveSettings, settingsWritten } from './settings'

const RENDERER_DEV_URL = process.env['ELECTRON_RENDERER_URL']
const isDev = !!RENDERER_DEV_URL
const isMac = process.platform === 'darwin'

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

// Linux spell-checking would fetch Hunspell dictionaries from Google's servers;
// switch it off for the whole session, not only per window (see usesSpellcheck).
function configureSpellcheck(): void {
  if (!usesSpellcheck(process.platform)) session.defaultSession.setSpellCheckerEnabled(false)
}

/** Windows and macOS take the icon from the app bundle; Linux needs it on the
 *  window, from the PNG packaged as an extra resource. */
function windowIcon(): string | undefined {
  if (process.platform !== 'linux') return undefined
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
}

/** A BrowserWindow carrying close-guard flags set over IPC. */
type GuardedWindow = BrowserWindow & {
  _hasUnsaved?: boolean
  _forceClose?: boolean
  /** The deferred close came from quitting the app (Cmd+Q, Quit from the Dock). */
  _quitAfterClose?: boolean
}

// Set while the app is quitting, so a close deferred for unsaved edits can
// finish the quit once the user has answered (macOS would otherwise stay open).
let quitting = false

/** Quit once the last settings write (tabs, theme, ...) has reached disk. One
 *  macrotask first, so a save the closing window just sent is queued. */
function quitAfterSettingsFlush(): void {
  setTimeout(() => void settingsWritten().finally(() => app.quit()), 0)
}

function guardUnsavedClose(win: GuardedWindow): void {
  // Unsaved-changes guard: if the renderer reported unsaved edits, defer the
  // close and let it show the confirm dialog (it will call win:forceClose).
  win.on('close', (event) => {
    if (win._forceClose) return // the user answered a deferred close
    win._quitAfterClose = false
    if (!win._hasUnsaved) return
    event.preventDefault()
    win._quitAfterClose = quitting
    quitting = false
    win.webContents.send('app:request-close')
  })
  win.on('closed', () => {
    // The quit's own flush already ran when the close was deferred; the
    // renderer saved its tabs since, so flush again before finishing the quit.
    if (win._quitAfterClose) quitAfterSettingsFlush()
  })
}

function keepNavigationInApp(win: BrowserWindow): void {
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
}

async function createWindow(): Promise<BrowserWindow> {
  const settings = await loadSettings()
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    ...windowChrome(process.platform),
    backgroundColor: windowBackground(settings.theme, nativeTheme.shouldUseDarkColors),
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: usesSpellcheck(process.platform)
    }
  })

  win.once('ready-to-show', () => win.show())

  const broadcastMaximize = (): void =>
    win.webContents.send('win:maximizeChanged', win.isMaximized())
  win.on('maximize', broadcastMaximize)
  win.on('unmaximize', broadcastMaximize)

  guardUnsavedClose(win)
  keepNavigationInApp(win)

  if (RENDERER_DEV_URL) {
    win.loadURL(RENDERER_DEV_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

/** The window to show shell-opened files in: the existing one, brought to the
 *  front, or a new one (macOS keeps running with no window open). */
async function frontWindow(): Promise<BrowserWindow> {
  const existing = BrowserWindow.getAllWindows()[0]
  if (!existing) return createWindow()
  if (existing.isMinimized()) existing.restore()
  existing.focus()
  return existing
}

/** Follow OS light/dark changes with the native window fill (theme "system"). */
async function syncWindowBackground(): Promise<void> {
  const color = windowBackground((await loadSettings()).theme, nativeTheme.shouldUseDarkColors)
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(color)
}

function installMenu(): void {
  // macOS needs a menu for Cmd+Q/H/M and the clipboard; Windows and Linux draw
  // their own chrome and keep every shortcut for the page.
  if (!isMac) {
    Menu.setApplicationMenu(null)
    return
  }
  app.setAboutPanelOptions({ applicationName: 'SimpleMD', copyright: 'Copyright © 2026 njaske' })
  Menu.setApplicationMenu(Menu.buildFromTemplate(macMenuTemplate(app.name)))
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // macOS delivers double-clicked / "Open With" files as `open-file`, which can
  // fire before `ready`; hold those until the launch files are prepared.
  let launchPrepared = false
  const earlyOpenFiles: string[] = []
  app.on('open-file', (event, path) => {
    event.preventDefault()
    if (!launchPrepared) {
      earlyOpenFiles.push(path)
      return
    }
    void frontWindow().then((win) => openFromSecondInstance([path], process.cwd(), win))
  })

  app.on('second-instance', (_event, argv, workingDirectory) => {
    // In development argv carries Electron's own arguments, not user files.
    const args = app.isPackaged ? argv.slice(1) : []
    if (!launchPrepared) {
      earlyOpenFiles.push(...extractLaunchPaths(args, workingDirectory))
      return
    }
    void frontWindow().then((win) => openFromSecondInstance(args, workingDirectory, win))
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.simplemd.app')
    installMenu()
    // Optional: open a specific folder on launch (also used for first-run defaults).
    const initialFolder = process.env['SIMPLEMD_INITIAL_FOLDER']
    if (initialFolder) await saveSettings({ lastFolder: initialFolder })
    await restoreAccess()
    const launchArgs = app.isPackaged ? process.argv.slice(1) : []
    await prepareLaunch([...launchArgs, ...earlyOpenFiles.splice(0)], process.cwd())
    applyContentSecurityPolicy()
    denyPermissionRequests()
    configureSpellcheck()
    registerIpc()
    const win = await createWindow()
    launchPrepared = true
    // Files that arrived while the launch was being prepared.
    if (earlyOpenFiles.length) void openFromSecondInstance(earlyOpenFiles.splice(0), process.cwd(), win)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
    nativeTheme.on('updated', () => void syncWindowBackground())
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  // Let the last settings write (tabs, theme, ...) reach disk before exiting.
  let settingsFlushed = false
  app.on('before-quit', (event) => {
    quitting = true
    if (settingsFlushed) return
    settingsFlushed = true
    event.preventDefault()
    quitAfterSettingsFlush()
  })

  if (isDev) {
    // Surface uncaught main-process errors during development.
    process.on('uncaughtException', (err) => console.error('[main]', err))
  }
}
