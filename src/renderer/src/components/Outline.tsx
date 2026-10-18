import { memo, useEffect, useRef } from 'react'
import type { OutlineItem } from '@/state/viewmodel'

interface Props {
  outline: OutlineItem[]
  /** Slug of the section at the top of the reader (scroll spy), if known. */
  activeSlug: string | null
  onJump: (slug: string) => void
}

// "On this page": a quiet list of headings. The current section gets the accent
// tick on the rail and stays scrolled into view.
function Outline({ outline, activeSlug, onJump }: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const minLevel = outline.reduce((m, o) => Math.min(m, o.level), 6)

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.is-active')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeSlug])

  return (
    <nav className="smd-outline" aria-label="On this page">
      <div className="smd-outline-title">On this page</div>
      {outline.length === 0 ? (
        <div className="smd-ol-empty" style={{ margin: '0 12px 0 20px' }}>
          Headings in this document will show up here.
        </div>
      ) : (
        <ul ref={listRef} className="smd-outline-list">
          {outline.map((o) => {
            const depth = Math.min(3, o.level - minLevel)
            const active = o.slug === activeSlug
            return (
              <li key={o.key}>
                <button
                  type="button"
                  className={'smd-ol-item' + (depth === 0 ? ' smd-ol-item--l1' : '') + (active ? ' is-active' : '')}
                  aria-current={active ? 'location' : undefined}
                  style={{ paddingLeft: 12 + depth * 12 }}
                  onClick={() => onJump(o.slug)}
                  title={o.text}
                >
                  {o.text}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}

export default memo(Outline)
