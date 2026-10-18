import { memo } from 'react'
import type { ReactNode } from 'react'
import type { NamedFileRef } from '@/state/viewmodel'
import { BookmarkFill, ClockIcon, CloseIcon } from '@/lib/icons'

interface Props {
  pinned: NamedFileRef[]
  recent: NamedFileRef[]
  onOpen: (id: string) => void
  onUnpin: (id: string) => void
  onForgetRecent: (id: string) => void
  onClearRecents: () => void
}

function Row({
  item,
  icon,
  onOpen,
  action
}: {
  item: NamedFileRef
  icon: ReactNode
  onOpen: (id: string) => void
  action: ReactNode
}) {
  return (
    <div className="smd-pinrow" role="listitem">
      {icon}
      <button type="button" className="smd-pinrow-text" onClick={() => onOpen(item.id)} title={item.id}>
        <div className="smd-pinrow-name">{item.name}</div>
        {item.folder && <div className="smd-pinrow-dir">{item.folder}</div>}
      </button>
      {action}
    </div>
  )
}

function PinnedPanel({ pinned, recent, onOpen, onUnpin, onForgetRecent, onClearRecents }: Props) {
  return (
    <div className="smd-scroll">
      <div className="smd-section-label">Pinned</div>
      {pinned.length > 0 ? (
        <div role="list" aria-label="Pinned">
          {pinned.map((p) => (
            <Row
              key={p.id}
              item={p}
              onOpen={onOpen}
              icon={<BookmarkFill size={13} style={{ flex: 'none', color: 'var(--accent-fg)' }} />}
              action={
                <button
                  type="button"
                  className="smd-iconbtn smd-iconbtn--sm"
                  aria-label={`Unpin ${p.name}`}
                  title="Unpin"
                  onClick={() => onUnpin(p.id)}
                >
                  <CloseIcon size={13} />
                </button>
              }
            />
          ))}
        </div>
      ) : (
        <div className="smd-hint-row">Pin a file from its menu to keep it one click away.</div>
      )}

      <div className="smd-section-label">
        Recent
        {recent.length > 0 && (
          <button type="button" className="smd-link" onClick={onClearRecents}>
            Clear
          </button>
        )}
      </div>
      {recent.length > 0 ? (
        <div role="list" aria-label="Recent">
          {recent.map((r) => (
            <Row
              key={r.id}
              item={r}
              onOpen={onOpen}
              icon={<ClockIcon size={14} style={{ flex: 'none', color: 'var(--fg-faint)' }} />}
              action={
                <button
                  type="button"
                  className="smd-iconbtn smd-iconbtn--sm"
                  aria-label={`Remove ${r.name} from recent`}
                  title="Remove from recent"
                  onClick={() => onForgetRecent(r.id)}
                >
                  <CloseIcon size={13} />
                </button>
              }
            />
          ))}
        </div>
      ) : (
        <div className="smd-hint-row">Files you open show up here.</div>
      )}
    </div>
  )
}

export default memo(PinnedPanel)
