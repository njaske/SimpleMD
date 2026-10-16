import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface MenuAction {
  label: string
  danger?: boolean
  disabled?: boolean
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
}

interface Props {
  menu: ContextMenuState
  onClose: () => void
}

const MARGIN = 8

export default function ContextMenu({ menu, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })

  // Keep the menu inside the viewport.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = menu.x
    let top = menu.y
    if (left + rect.width > window.innerWidth - MARGIN) left = Math.max(MARGIN, window.innerWidth - rect.width - MARGIN)
    if (top + rect.height > window.innerHeight - MARGIN) top = Math.max(MARGIN, window.innerHeight - rect.height - MARGIN)
    setPos({ left, top })
  }, [menu.x, menu.y])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 100 }}
    >
      <div
        ref={ref}
        className="smd-menu smd-pop"
        role="menu"
        onClick={(e) => e.stopPropagation()}
        style={{ position: 'fixed', left: pos.left, top: pos.top }}
      >
        {menu.items.map((item, i) =>
          'separator' in item ? (
            <div key={`sep-${i}`} className="smd-menusep" />
          ) : (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={'smd-menuitem' + (item.danger ? ' smd-menuitem--danger' : '')}
              disabled={item.disabled}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
            >
              {item.label}
            </button>
          )
        )}
      </div>
    </div>
  )
}
