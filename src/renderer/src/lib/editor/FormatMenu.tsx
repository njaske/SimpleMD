// The format bar's drop-down menus (text style, and "More" when the bar is narrow).
// Arrow keys move, Enter picks, Esc closes and returns to the trigger, a click outside closes.
import { useEffect, useRef, type ReactNode, type RefObject } from 'react'

export interface FormatMenuItem {
  readonly key: string
  readonly label: ReactNode
  /** Accessible name when `label` is decorated. */
  readonly text: string
  readonly icon?: ReactNode
  readonly hint?: string | null
  readonly separatorBefore?: boolean
  readonly className?: string
  readonly onSelect: () => void
}

interface Props {
  id: string
  items: readonly FormatMenuItem[]
  label: string
  anchor: RefObject<HTMLElement | null>
  /** Move focus into the menu (keyboard open); mouse opens leave it in the editor. */
  autoFocus: boolean
  align?: 'start' | 'end'
  onClose: (returnFocus: boolean) => void
}

function focusItem(menu: HTMLElement | null, index: number): void {
  const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  if (!items.length) return
  items[(index + items.length) % items.length].focus()
}

function currentIndex(menu: HTMLElement | null): number {
  const items = Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
  return items.findIndex((el) => el === document.activeElement)
}

/** Keys for an open menu, wherever focus is (capture phase, so the editor and the app's
 *  own Esc handling don't see them). */
function useMenuKeys(menu: RefObject<HTMLElement | null>, onClose: (returnFocus: boolean) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const inside = menu.current?.contains(document.activeElement) ?? false
      const at = currentIndex(menu.current)
      const moves: Record<string, () => void> = {
        ArrowDown: () => focusItem(menu.current, at + 1),
        ArrowUp: () => focusItem(menu.current, at < 0 ? -1 : at - 1),
        Home: () => focusItem(menu.current, 0),
        End: () => focusItem(menu.current, -1)
      }
      if (e.key === 'Escape') onClose(true)
      else if (e.key === 'Tab') return onClose(false)
      else if (moves[e.key] && (inside || e.key === 'ArrowDown' || e.key === 'ArrowUp')) moves[e.key]()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [menu, onClose])
}

function useOutsideClose(menu: RefObject<HTMLElement | null>, anchor: RefObject<HTMLElement | null>, onClose: (returnFocus: boolean) => void): void {
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node | null
      if (menu.current?.contains(target) || anchor.current?.contains(target)) return
      onClose(false)
    }
    const onBlur = (): void => onClose(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [menu, anchor, onClose])
}

export default function FormatMenu({ id, items, label, anchor, autoFocus, align = 'start', onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null)
  useMenuKeys(menu, onClose)
  useOutsideClose(menu, anchor, onClose)
  useEffect(() => {
    if (autoFocus) focusItem(menu.current, 0)
  }, [autoFocus])

  return (
    <div
      ref={menu}
      id={id}
      role="menu"
      aria-label={label}
      className={`smd-fmt-menu smd-fmt-menu--${align}`}
      // Keep the editor's selection while clicking around the menu.
      onMouseDown={(e) => e.preventDefault()}
    >
      {items.map((it) => (
        <div key={it.key} role="none">
          {it.separatorBefore && <div className="smd-fmt-menu__sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            aria-label={it.text}
            className={'smd-fmt-menu__item' + (it.className ? ' ' + it.className : '')}
            onClick={() => {
              onClose(false)
              it.onSelect()
            }}
          >
            {it.icon && <span className="smd-fmt-menu__icon">{it.icon}</span>}
            <span className="smd-fmt-menu__label">{it.label}</span>
            {it.hint && <kbd className="smd-fmt-menu__hint">{it.hint}</kbd>}
          </button>
        </div>
      ))}
    </div>
  )
}
