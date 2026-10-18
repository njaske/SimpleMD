import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { MenuItemConstructorOptions } from 'electron'
import { WINDOW_BACKGROUND, macMenuTemplate, windowBackground, windowChrome } from '../src/main/platform.ts'

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
})
