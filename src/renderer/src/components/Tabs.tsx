import { memo, useEffect, useRef } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import type { TabItem } from '@/state/viewmodel'
import { BookmarkFill, CloseIcon, PlusIcon } from '@/lib/icons'

interface Props {
  tabs: TabItem[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onContext: (id: string, e: ReactMouseEvent | KeyboardEvent, keyboard: boolean) => void
  onNew: () => void
  newLabel: string
}

// The tab strip lives inside the top bar. Roving focus: Left/Right move between tabs,
// the context-menu key opens the tab menu, middle click closes.
function Tabs({ tabs, onSelect, onClose, onContext, onNew, newLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const activeId = tabs.find((t) => t.active)?.id

  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.smd-tab.is-active')
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeId])

  const focusTab = (index: number): void => {
    const all = ref.current?.querySelectorAll<HTMLElement>('[role="tab"]')
    const el = all?.[(index + tabs.length) % tabs.length]
    if (!el) return
    el.focus()
    onSelect(tabs[(index + tabs.length) % tabs.length].id)
  }

  const onKeyDown = (e: KeyboardEvent, i: number, tab: TabItem): void => {
    if (e.key === 'ArrowRight') focusTab(i + 1)
    else if (e.key === 'ArrowLeft') focusTab(i - 1)
    else if (e.key === 'Home') focusTab(0)
    else if (e.key === 'End') focusTab(tabs.length - 1)
    else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) onContext(tab.id, e, true)
    else if (e.key === 'Enter' || e.key === ' ') onSelect(tab.id)
    else return
    e.preventDefault()
  }

  return (
    <div ref={ref} className="smd-tabs smd-drag" role="tablist" aria-label="Open documents">
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.active}
          tabIndex={tab.active ? 0 : -1}
          className={'smd-tab' + (tab.active ? ' is-active' : '') + (tab.dirty ? ' smd-tab--dirty' : '')}
          title={tab.path || tab.name}
          aria-label={`${tab.name}${tab.dirty ? ', unsaved' : ''}${tab.pinned ? ', pinned' : ''}`}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(e) => onKeyDown(e, i, tab)}
          onContextMenu={(e) => {
            e.preventDefault()
            onContext(tab.id, e, false)
          }}
          onMouseDown={(e) => {
            if (e.button === 1) e.preventDefault()
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              onClose(tab.id)
            }
          }}
        >
          {tab.pinned && <BookmarkFill size={11} className="smd-tab-pin" />}
          <span className="smd-tab-name">{tab.name}</span>
          <span className="smd-tab-end">
            {tab.dirty && <span className="smd-tab-dirty" aria-hidden="true" />}
            <button
              type="button"
              tabIndex={-1}
              className="smd-tab-close"
              aria-label={`Close ${tab.name}`}
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
            >
              <CloseIcon size={13} sw={1.8} />
            </button>
          </span>
        </div>
      ))}
      <button
        type="button"
        className="smd-iconbtn smd-iconbtn--sm"
        style={{ alignSelf: 'center', marginLeft: 4 }}
        onClick={onNew}
        aria-label={newLabel}
        title={newLabel}
      >
        <PlusIcon size={15} />
      </button>
      <div className="smd-tabs-filler" />
    </div>
  )
}

export default memo(Tabs)
