import type { CSSProperties } from 'react'
import type { NamedFileRef } from '@/state/viewmodel'
import { BookmarkFill, ClockIcon, CloseIcon } from '@/lib/icons'
import { activateOnKey } from '@/lib/a11y'

interface Props {
  pinned: NamedFileRef[]
  recent: NamedFileRef[]
  onOpen: (id: string) => void
  onUnpin: (id: string) => void
}

const sectionLabel: CSSProperties = {
  fontSize: 10.5,
  fontWeight: 600,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: 'var(--fg-faint)'
}

function Meta({ name, folder }: { name: string; folder: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div
        style={{ fontSize: 12.5, color: 'var(--fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {name}
      </div>
      <div style={{ fontSize: 11, color: 'var(--fg-faint)' }}>{folder}</div>
    </div>
  )
}

export default function PinnedPanel({ pinned, recent, onOpen, onUnpin }: Props) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '10px 6px 16px' }}>
      <div style={{ ...sectionLabel, padding: '6px 10px 6px' }}>Pinned</div>
      {pinned.length > 0 ? (
        pinned.map((p) => (
          <div
            key={p.id}
            className="smd-pinrow"
            role="button"
            tabIndex={0}
            aria-label={`Open ${p.name}`}
            onClick={() => onOpen(p.id)}
            onKeyDown={activateOnKey(() => onOpen(p.id))}
            title={p.name}
          >
            <BookmarkFill size={13} style={{ flex: 'none', color: 'var(--accent)' }} />
            <Meta name={p.name} folder={p.folder} />
            <button
              className="smd-unpin"
              aria-label={`Unpin ${p.name}`}
              title="Unpin"
              onClick={(e) => {
                e.stopPropagation()
                onUnpin(p.id)
              }}
            >
              <CloseIcon size={13} />
            </button>
          </div>
        ))
      ) : (
        <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 11px 10px' }}>
          Pin a file to keep it close.
        </div>
      )}

      <div style={{ ...sectionLabel, padding: '14px 10px 6px' }}>Recent</div>
      {recent.length > 0 ? (
        recent.map((r) => (
          <div
            key={r.id}
            className="smd-pinrow"
            role="button"
            tabIndex={0}
            aria-label={`Open ${r.name}`}
            onClick={() => onOpen(r.id)}
            onKeyDown={activateOnKey(() => onOpen(r.id))}
            title={r.name}
          >
            <ClockIcon size={13} style={{ flex: 'none', color: 'var(--fg-faint)' }} />
            <Meta name={r.name} folder={r.folder} />
          </div>
        ))
      ) : (
        <div style={{ fontSize: 12, color: 'var(--fg-faint)', padding: '4px 11px 10px' }}>
          Recently opened files appear here.
        </div>
      )}
    </div>
  )
}
