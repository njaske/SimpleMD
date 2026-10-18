import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent as ReactMouseEvent, RefObject, WheelEvent } from 'react'
import type { TabItem } from '@/state/viewmodel'
import { BookmarkFill, ChevronDown, CloseIcon, PlusIcon } from '@/lib/icons'

interface Props {
  tabs: TabItem[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onContext: (id: string, e: ReactMouseEvent | KeyboardEvent, keyboard: boolean) => void
  onNew: () => void
  newLabel: string
  /** The overflow button: list every open tab in a menu. */
  onList: (anchor: HTMLElement, keyboard: boolean) => void
  listOpen: boolean
}

interface Clip {
  start: boolean
  end: boolean
}

/** Sub-pixel scroll positions shouldn't count as "more tabs this way". */
const EDGE_SLACK = 2

/** Which edges of the strip hide tabs; re-measured on scroll, resize and tab changes. */
function useClip(ref: RefObject<HTMLDivElement | null>, count: number): Clip {
  const [clip, setClip] = useState<Clip>({ start: false, end: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => {
      const start = el.scrollLeft > EDGE_SLACK
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_SLACK
      setClip((c) => (c.start === start && c.end === end ? c : { start, end }))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [ref, count])
  return clip
}

/** A vertical wheel scrolls the strip sideways (most mice have no horizontal wheel). */
function onWheel(e: WheelEvent<HTMLDivElement>): void {
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return
  e.currentTarget.scrollLeft += e.deltaY
}

// The tab strip lives inside the top bar. Roving focus: Left/Right move between tabs,
// the context-menu key opens the tab menu, middle click closes. When tabs don't fit,
// the clipped edges fade and a chevron lists every tab.
function Tabs({ tabs, onSelect, onClose, onContext, onNew, newLabel, onList, listOpen }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const activeId = tabs.find((t) => t.active)?.id
  const clip = useClip(ref, tabs.length)
  const overflowing = clip.start || clip.end

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

  const clipClass = (clip.start ? ' is-clipped-start' : '') + (clip.end ? ' is-clipped-end' : '')
  return (
    <div className="smd-tabstrip smd-drag">
      <div
        ref={ref}
        className={'smd-tabs' + clipClass}
        role="tablist"
        aria-label="Open documents"
        onWheel={onWheel}
      >
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
            <span className="smd-tab-name">{tab.label}</span>
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
      </div>
      {overflowing && (
        <button
          type="button"
          className="smd-iconbtn smd-iconbtn--sm smd-tabs-more"
          aria-label={`All open tabs (${tabs.length})`}
          title="All open tabs"
          aria-haspopup="menu"
          aria-expanded={listOpen}
          onClick={(e) => onList(e.currentTarget, e.detail === 0)}
        >
          <ChevronDown size={15} />
        </button>
      )}
      <button type="button" className="smd-iconbtn smd-iconbtn--sm smd-tabs-new" onClick={onNew} aria-label={newLabel} title={newLabel}>
        <PlusIcon size={15} />
      </button>
      <div className="smd-tabs-filler" />
    </div>
  )
}

export default memo(Tabs)
