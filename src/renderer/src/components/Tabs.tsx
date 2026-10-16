import type { TabItem } from '@/state/viewmodel'
import { BookmarkFill, CloseIcon } from '@/lib/icons'
import { activateOnKey } from '@/lib/a11y'

interface Props {
  tabs: TabItem[]
  onSelect: (id: string) => void
  onClose: (id: string) => void
}

export default function Tabs({ tabs, onSelect, onClose }: Props) {
  return (
    <div
      className="smd-tabs"
      style={{
        height: 40,
        flex: 'none',
        display: 'flex',
        alignItems: 'stretch',
        background: 'var(--bg-elev)',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
        overflowY: 'hidden'
      }}
    >
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={'smd-tab' + (tab.active ? ' is-active' : '')}
          role="button"
          tabIndex={0}
          aria-current={tab.active ? 'page' : undefined}
          aria-label={`${tab.name}${tab.dirty ? ' (unsaved)' : ''}`}
          onClick={() => onSelect(tab.id)}
          onKeyDown={activateOnKey(() => onSelect(tab.id))}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault()
              onClose(tab.id)
            }
          }}
        >
          {tab.active && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                height: 2,
                background: 'var(--accent)'
              }}
            />
          )}
          {tab.pinned && <BookmarkFill size={11} style={{ flex: 'none', color: 'var(--accent)' }} />}
          {tab.dirty && <span className="smd-dirty" />}
          <span
            style={{
              fontSize: 12.5,
              color: tab.active ? 'var(--fg)' : 'var(--fg-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
          >
            {tab.name}
          </span>
          <button
            className="smd-x"
            aria-label={`Close ${tab.name}`}
            title="Close tab"
            onClick={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
          >
            <CloseIcon size={13} sw={1.8} />
          </button>
        </div>
      ))}
      <div style={{ flex: 1 }} />
    </div>
  )
}
