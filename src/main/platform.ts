import type { BrowserWindowConstructorOptions, MenuItemConstructorOptions } from 'electron'

// Per-OS window chrome and the macOS menu. Kept free of Electron runtime imports
// (types only) so the choices can be unit-tested.

/** Window fill before the page paints, matched to the theme so opening the app
 *  in light mode doesn't flash dark (and the reverse). */
export const WINDOW_BACKGROUND = { light: '#F7F6F3', dark: '#1C1B19', sepia: '#EEE5D3' } as const

export function windowBackground(theme: unknown, systemDark: boolean): string {
  if (theme === 'light' || theme === 'dark' || theme === 'sepia') return WINDOW_BACKGROUND[theme]
  return systemDark ? WINDOW_BACKGROUND.dark : WINDOW_BACKGROUND.light
}

/** macOS keeps its native traffic lights inside our top bar; Windows and Linux
 *  get a frameless window whose buttons the renderer draws. */
export function windowChrome(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } }
  }
  return { frame: false, titleBarStyle: 'hidden' }
}

/** Windows and macOS spell-check with the OS's own dictionaries. On Linux
 *  Chromium would download Hunspell dictionaries from Google's servers, which
 *  breaks the "no network requests of our own" promise, so it stays off there. */
export function usesSpellcheck(platform: NodeJS.Platform): boolean {
  return platform === 'win32' || platform === 'darwin'
}

/** The minimal native menu macOS needs: without it Cmd+Q/H/M and the clipboard
 *  shortcuts don't work at all. Only roles whose standard shortcuts don't clash
 *  with the app's own (Cmd+N/O/S/W/P/K/B/E/F/T/1/2/3 ... stay with the page), so
 *  no "close" (Cmd+W), reload or dev-tools items. */
export function macMenuTemplate(appName: string): MenuItemConstructorOptions[] {
  return [
    {
      label: appName,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [{ role: 'togglefullscreen' }]
    },
    {
      role: 'windowMenu',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    }
  ]
}
