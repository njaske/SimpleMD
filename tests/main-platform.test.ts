import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MenuItemConstructorOptions } from 'electron'
import {
  APP_NAME,
  MAX_ZOOM,
  MIN_ZOOM,
  WINDOW_BACKGROUND,
  clampZoom,
  macMenuTemplate,
  usesSpellcheck,
  windowBackground,
  windowChrome
} from '../src/main/platform.ts'

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu as MenuItemConstructorOptions[]) : [])
  ])
}

describe('windowBackground', () => {
  it('uses the chosen theme', () => {
    assert.equal(windowBackground('light', true), WINDOW_BACKGROUND.light)
    assert.equal(windowBackground('dark', false), WINDOW_BACKGROUND.dark)
    assert.equal(windowBackground('sepia', true), WINDOW_BACKGROUND.sepia)
  })

  it('follows the OS for "system" and anything unknown', () => {
    assert.equal(windowBackground('system', true), '#1C1B19')
    assert.equal(windowBackground('system', false), '#F7F6F3')
    assert.equal(windowBackground(undefined, false), '#F7F6F3')
  })
})

describe('usesSpellcheck', () => {
  it('uses the OS spellchecker on Windows and macOS', () => {
    assert.equal(usesSpellcheck('win32'), true)
    assert.equal(usesSpellcheck('darwin'), true)
  })

  it('stays off on Linux and elsewhere, where Chromium would download dictionaries', () => {
    assert.equal(usesSpellcheck('linux'), false)
    assert.equal(usesSpellcheck('freebsd'), false)
  })
})

describe('windowChrome', () => {
  it('keeps native traffic lights on macOS', () => {
    const mac = windowChrome('darwin')
    assert.equal(mac.titleBarStyle, 'hiddenInset')
    assert.deepEqual(mac.trafficLightPosition, { x: 16, y: 15 })
    assert.equal(mac.frame, undefined)
  })

  it('is frameless on Windows and Linux', () => {
    assert.equal(windowChrome('win32').frame, false)
    assert.equal(windowChrome('linux').frame, false)
  })
})

describe('macMenuTemplate', () => {
  const items = flatten(macMenuTemplate('SimpleMD'))
  const roles = new Set(items.map((item) => item.role).filter(Boolean))

  it('has the app, Edit and Window roles macOS users rely on', () => {
    for (const role of ['about', 'hide', 'hideOthers', 'unhide', 'quit', 'undo', 'redo', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'selectAll', 'minimize', 'zoom', 'front']) {
      assert.ok(roles.has(role as MenuItemConstructorOptions['role']), role)
    }
  })

  it('leaves the app’s own shortcuts alone', () => {
    // Roles with standard shortcuts that clash with Cmd+W/R/N/... in the app.
    for (const role of ['close', 'reload', 'forceReload', 'toggleDevTools', 'resetZoom', 'zoomIn', 'zoomOut', 'fileMenu']) {
      assert.equal(roles.has(role as MenuItemConstructorOptions['role']), false, role)
    }
    assert.deepEqual(items.filter((item) => item.accelerator !== undefined), [])
  })

  it('names the app menu after the app', () => {
    assert.equal(macMenuTemplate('SimpleMD')[0].label, 'SimpleMD')
  })

  it('labels About, Hide and Quit with the product name, not the package name', () => {
    const label = (role: string): unknown => items.find((item) => item.role === role)?.label
    assert.equal(label('about'), 'About SimpleMD')
    assert.equal(label('hide'), 'Hide SimpleMD')
    assert.equal(label('quit'), 'Quit SimpleMD')
    assert.equal(APP_NAME, 'SimpleMD')
  })
})

describe('clampZoom', () => {
  it('keeps a UI scale inside the supported range', () => {
    assert.equal(clampZoom(1.25), 1.25)
    assert.equal(clampZoom(3), MAX_ZOOM)
    assert.equal(clampZoom(0.1), MIN_ZOOM)
  })

  it('falls back to 100% for anything that is not a finite number', () => {
    for (const value of [undefined, null, '1.2', Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(clampZoom(value), 1, String(value))
    }
  })
})
