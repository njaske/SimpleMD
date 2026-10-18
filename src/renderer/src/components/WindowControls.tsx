import { MaximizeIcon, MinimizeIcon, RestoreIcon, WinCloseIcon } from '@/lib/icons'

// Window buttons can't meaningfully fail; a rejected call just leaves the window as is.
const ignore = (): undefined => undefined

interface Props {
  isMaximized: boolean
}

/** Minimize / maximize / close for Windows and Linux (macOS draws native traffic lights). */
export default function WindowControls({ isMaximized }: Props) {
  return (
    <div className="smd-winctl">
      <button
        type="button"
        className="smd-winbtn"
        onClick={() => void window.api.win.minimize().catch(ignore)}
        aria-label="Minimize"
        title="Minimize"
      >
        <MinimizeIcon size={16} />
      </button>
      <button
        type="button"
        className="smd-winbtn"
        onClick={() => void window.api.win.maximizeToggle().catch(ignore)}
        aria-label={isMaximized ? 'Restore' : 'Maximize'}
        title={isMaximized ? 'Restore' : 'Maximize'}
      >
        {isMaximized ? <RestoreIcon size={16} /> : <MaximizeIcon size={16} />}
      </button>
      <button
        type="button"
        className="smd-winbtn smd-winbtn--close"
        onClick={() => void window.api.win.close().catch(ignore)}
        aria-label="Close window"
        title="Close"
      >
        <WinCloseIcon size={16} />
      </button>
    </div>
  )
}
