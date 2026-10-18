import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { stepIndex, useFocusReturn, useOutsidePress } from '@/lib/a11y'

export interface MenuAction {
  label: string
  danger?: boolean
  disabled?: boolean
  icon?: ReactNode
  /** Right-aligned hint, usually a formatted shortcut. */
  hint?: string
  onSelect: () => void
}
export interface MenuSeparator {
  separator: true
}
export type MenuEntry = MenuAction | MenuSeparator

export interface ContextMenuState {
  x: number
  y: number
  items: MenuEntry[]
  /** 'end' anchors the menu's right edge at x (menus opened from a toolbar button). */
  align?: 'start' | 'end'
  /** Accessible name of the menu. */
  label?: string
  /** Opened from the keyboard: focus the first item right away. */
  keyboard?: boolean
}

interface Props {
  menu: ContextMenuState
  onClose: () => void
}

const MARGIN = 8

function isAction(e: MenuEntry): e is MenuAction {
  return !('separator' in e)
}

export default function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, ready: false })
  useFocusReturn(ref, !menu.keyboard)
  useOutsidePress(ref, onClose)

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const wantLeft = menu.align === 'end' ? menu.x - rect.width : menu.x
    const left = Math.max(MARGIN, Math.min(wantLeft, window.innerWidth - rect.width - MARGIN))
    const top =
      menu.y + rect.height > window.innerHeight - MARGIN
        ? Math.max(MARGIN, window.innerHeight - rect.height - MARGIN)
        : menu.y
    setPos({ left, top, ready: true })
  }, [menu.x, menu.y, menu.align])

  const buttons = (): HTMLButtonElement[] =>
    Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)') ?? [])

  const move = (delta: number | 'first' | 'last'): void => {
    const items = buttons()
    if (!items.length) return
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = delta === 'first' ? 0 : delta === 'last' ? items.length - 1 : stepIndex(current, delta, items.length)
    items[next]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    const keys: Record<string, () => void> = {
      ArrowDown: () => move(1),
      ArrowUp: () => move(-1),
      Home: () => move('first'),
      End: () => move('last'),
      Escape: onClose,
      Tab: onClose
    }
    const run = keys[e.key]
    if (run) {
      e.preventDefault()
      e.stopPropagation()
      run()
      return
    }
    // Type-ahead: jump to the next item starting with the typed letter.
    if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const items = buttons()
      const start = items.indexOf(document.activeElement as HTMLButtonElement)
      const lower = e.key.toLowerCase()
      for (let i = 1; i <= items.length; i++) {
        const item = items[(start + i) % items.length]
        if (item.textContent?.trim().toLowerCase().startsWith(lower)) {
          item.focus()
          break
        }
      }
    }
  }

  const withIcons = menu.items.some((x) => isAction(x) && !!x.icon)
  return (
    <div
      ref={ref}
      className="smd-menu"
      role="menu"
      aria-label={menu.label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.left, top: pos.top, opacity: pos.ready ? undefined : 0 }}
    >
      {menu.items.map((item, i) =>
        isAction(item) ? (
          <button
            key={`${item.label}-${i}`}
            type="button"
            role="menuitem"
            data-autofocus={i === menu.items.findIndex((x) => isAction(x) && !x.disabled) ? '' : undefined}
            className={'smd-menuitem' + (item.danger ? ' smd-menuitem--danger' : '')}
            disabled={item.disabled}
            onClick={() => {
              onClose()
              item.onSelect()
            }}
          >
            {item.icon ?? (withIcons && <span className="smd-menuitem-noicon" aria-hidden="true" />)}
            <span className="smd-menuitem-label">{item.label}</span>
            {item.hint && <span className="smd-menuitem-hint">{item.hint}</span>}
          </button>
        ) : (
          <div key={`sep-${i}`} className="smd-menusep" role="separator" />
        )
      )}
    </div>
  )
}
