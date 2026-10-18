import { FolderPlusIcon } from '@/lib/icons'

/** Shown while files are dragged over the window. Never intercepts the drop itself. */
export default function DropOverlay() {
  return (
    <div className="smd-drop" aria-hidden="true">
      <div className="smd-drop-card">
        <div className="smd-drop-icon">
          <FolderPlusIcon size={26} />
        </div>
        <div className="smd-drop-title">Drop to open</div>
        <div className="smd-drop-sub">Markdown files or a whole folder</div>
      </div>
    </div>
  )
}
