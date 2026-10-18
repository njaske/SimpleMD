// Opening context menus and the top-bar menus. The menu builders (and their icons)
// load on first use, warmed while idle, so they stay out of the startup chunk.
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { MenuEntry } from '@/components/ContextMenu'
import type { AppHost } from './host'
import type { MenuDeps } from './menus'

type Menus = typeof import('./menus')
type MenuEvent = ReactMouseEvent | ReactKeyboardEvent

/** Accessible names of the top-bar menus (also how the bar knows which one is open). */
export const DOC_MENU = 'Document actions'
export const TAB_LIST = 'Open tabs'

export const loadMenus = (): Promise<Menus> => import('./menus')

interface Spot {
  x: number
  y: number
  align?: 'end'
}

/** Where a menu opens: at the pointer, or under the focused row for the keyboard.
 *  Read now: the event's target is gone once the builders have loaded. */
function spotOf(e: MenuEvent, keyboard: boolean): Spot {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const mouse = 'clientX' in e && !keyboard
  return {
    x: mouse ? (e as ReactMouseEvent).clientX : rect.left + 12,
    y: mouse ? (e as ReactMouseEvent).clientY : rect.bottom
  }
}

export function createMenuControl(host: AppHost, deps: MenuDeps, nameOf: (id: string) => string) {
  const show = (spot: Spot, label: string, keyboard: boolean, build: (m: Menus) => MenuEntry[]): void => {
    loadMenus().then(
      (m) => host.update({ menu: { ...spot, items: build(m), label, keyboard } }),
      () => host.toast("Couldn't open that menu. Try again.")
    )
  }

  /** A menu hanging from a top-bar button; a second click closes it. */
  const anchored = (anchor: HTMLElement, label: string, keyboard: boolean, build: (m: Menus) => MenuEntry[]): void => {
    if (host.state().menu) return host.update({ menu: null })
    const r = anchor.getBoundingClientRect()
    show({ x: r.right, y: r.bottom + 6, align: 'end' }, label, keyboard, build)
  }

  return {
    tab: (id: string, e: MenuEvent, keyboard: boolean): void =>
      show(spotOf(e, keyboard), 'Tab actions', keyboard, (m) => m.tabMenu(deps, id)),
    file: (id: string, e: MenuEvent, keyboard: boolean): void =>
      show(spotOf(e, keyboard), 'File actions', keyboard, (m) => m.fileMenu(deps, id)),
    folder: (id: string, e: MenuEvent, keyboard: boolean): void =>
      show(spotOf(e, keyboard), 'Folder actions', keyboard, (m) => m.folderMenu(deps, id)),
    document: (anchor: HTMLElement, keyboard: boolean): void =>
      anchored(anchor, DOC_MENU, keyboard, (m) => m.documentMenu(deps)),
    tabList: (anchor: HTMLElement, keyboard: boolean): void =>
      anchored(anchor, TAB_LIST, keyboard, (m) => m.tabListMenu(deps, nameOf))
  }
}
