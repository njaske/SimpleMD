import type { ReadingFont, ViewMode } from '@shared/types'
import { DownloadIcon, OutlineIcon, SlidersIcon } from '@/lib/icons'
import Preferences from './Preferences'

interface Props {
  breadcrumb: string
  viewMode: ViewMode
  onSetView: (v: ViewMode) => void
  onExport: () => void
  outlineOpen: boolean
  onToggleOutline: () => void
  prefsOpen: boolean
  onTogglePrefs: () => void
  accent: string
  readingFont: ReadingFont
  readingWidth: number
  onAccent: (value: string) => void
  onFont: (value: ReadingFont) => void
  onWidth: (value: number) => void
}

const MODES: ViewMode[] = ['read', 'split', 'edit']
const MODE_LABEL: Record<ViewMode, string> = { read: 'Read', split: 'Split', edit: 'Edit' }

export default function Toolbar(props: Props) {
  return (
    <div
      className="smd-toolbar"
      style={{
        height: 44,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 14px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          fontSize: 12,
          color: 'var(--fg-faint)',
          minWidth: 0
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {props.breadcrumb}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
        <div className="smd-seg-group" role="group" aria-label="View mode">
          {MODES.map((m) => (
            <button
              key={m}
              className={'smd-seg' + (props.viewMode === m ? ' is-active' : '')}
              aria-pressed={props.viewMode === m}
              onClick={() => props.onSetView(m)}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button className="smd-ghostbtn" onClick={props.onExport} aria-label="Export to PDF" title="Export to PDF">
          <DownloadIcon size={14} />
          PDF
        </button>
        <div style={{ position: 'relative' }}>
          <button
            className={'smd-sqbtn' + (props.prefsOpen ? ' is-active' : '')}
            onClick={props.onTogglePrefs}
            aria-label="Reading preferences"
            aria-expanded={props.prefsOpen}
            title="Reading preferences"
          >
            <SlidersIcon size={16} />
          </button>
          {props.prefsOpen && (
            <Preferences
              accent={props.accent}
              readingFont={props.readingFont}
              readingWidth={props.readingWidth}
              onAccent={props.onAccent}
              onFont={props.onFont}
              onWidth={props.onWidth}
            />
          )}
        </div>
        <button
          className={'smd-sqbtn' + (props.outlineOpen ? ' is-active' : '')}
          onClick={props.onToggleOutline}
          aria-label="Toggle outline"
          aria-pressed={props.outlineOpen}
          title="Toggle outline"
        >
          <OutlineIcon size={16} />
        </button>
      </div>
    </div>
  )
}
