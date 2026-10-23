import type { UpdateInfo } from '@shared/types'
import { CloseIcon, DownloadIcon, SparkIcon } from '@/lib/icons'

// The card in the bottom-right corner, in the manner of VS Code-style editors: once, to
// ask whether SimpleMD may check for new versions, and whenever a newer one is out. It
// never takes focus; it waits until it's answered or closed.

interface Props {
  kind: 'ask' | 'available'
  info: UpdateInfo | null
  onEnable: () => void
  onDecline: () => void
  onDownload: () => void
  onLater: () => void
}

export default function UpdateNotice({ kind, info, onEnable, onDecline, onDownload, onLater }: Props) {
  const asking = kind === 'ask'
  if (!asking && !info?.available) return null
  return (
    <section className="smd-update" aria-labelledby="smd-update-title" aria-live="polite">
      <span className="smd-update-icon" aria-hidden="true">
        {asking ? <SparkIcon size={16} /> : <DownloadIcon size={16} />}
      </span>
      <div className="smd-update-body">
        <h2 className="smd-update-title" id="smd-update-title">
          {asking ? 'Get told about new versions?' : `SimpleMD ${info!.latest} is available`}
        </h2>
        <p className="smd-update-text">
          {asking
            ? 'Once a day, SimpleMD can ask GitHub for the latest version number. No account, cookie or ID goes with it, and nothing about your files. You can change this in Settings.'
            : `You have ${info!.current}. The download page lists what's new.`}
        </p>
        <div className="smd-update-actions">
          {asking ? (
            <>
              <button type="button" className="smd-btn smd-btn--primary smd-btn--sm" onClick={onEnable}>
                Turn on
              </button>
              <button type="button" className="smd-btn smd-btn--ghost smd-btn--sm" onClick={onDecline}>
                No thanks
              </button>
            </>
          ) : (
            <>
              <button type="button" className="smd-btn smd-btn--primary smd-btn--sm" onClick={onDownload}>
                Download
              </button>
              <button type="button" className="smd-btn smd-btn--ghost smd-btn--sm" onClick={onLater}>
                Later
              </button>
            </>
          )}
        </div>
      </div>
      <button type="button" className="smd-update-close smd-iconbtn" aria-label="Close" title="Close" onClick={onLater}>
        <CloseIcon size={14} />
      </button>
    </section>
  )
}
