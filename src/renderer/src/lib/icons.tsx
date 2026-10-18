import type { CSSProperties, ReactNode } from 'react'

// Stroke icons on a 24-unit grid, 1.6 stroke, round caps and joins. Decorative by
// default (aria-hidden); the control that holds an icon carries the label.

export interface IconProps {
  size?: number
  sw?: number
  style?: CSSProperties
  className?: string
}

function Stroke({ size = 16, sw = 1.6, style, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

function Fill({ size = 16, style, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      style={style}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/** The SimpleMD mark: an ink page with the accent corner block. */
export function AppMark({ size = 18, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true" focusable="false">
      <rect x="2.75" y="2.75" width="18.5" height="18.5" rx="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="12.5" y="12.5" width="5.5" height="5.5" rx="1.4" fill="var(--accent)" />
    </svg>
  )
}

export const FileTextIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M9 13h6M9 17h4" />
  </Stroke>
)
export const FilePlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11.5v6M9 14.5h6" />
  </Stroke>
)
export const FolderIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Stroke>
)
export const FolderOpenIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v1" />
    <path d="M3 17l2.4-6.1A1.5 1.5 0 0 1 6.8 10H21l-2.6 7.4a1.5 1.5 0 0 1-1.4 1H5a2 2 0 0 1-2-1.4z" />
  </Stroke>
)
export const FolderPlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 10.5v5M9.5 13h5" />
  </Stroke>
)
export const PlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
)
export const MinusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 12h14" />
  </Stroke>
)
export const SearchIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Stroke>
)
export const BookmarkIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-3.8L6 20V4.5a1 1 0 0 1 1-1z" />
  </Stroke>
)
export const BookmarkFill = (p: IconProps) => (
  <Fill {...p}>
    <path d="M7 3h10a1.5 1.5 0 0 1 1.5 1.5v16.2a.6.6 0 0 1-.92.5L12 17.6l-5.58 3.6a.6.6 0 0 1-.92-.5V4.5A1.5 1.5 0 0 1 7 3z" />
  </Fill>
)
/** Half-filled circle: "theme". */
export const ContrastIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" />
  </Stroke>
)
export const GearIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </Stroke>
)
export const KeyboardIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
  </Stroke>
)
/** A prompt chevron for Commands mode (the same on every platform, unlike ⌘). */
export const PromptIcon = (p: IconProps) => (
  <Stroke sw={1.8} {...p}>
    <path d="M5.5 7.5l4.5 4.5-4.5 4.5M12.5 17h6" />
  </Stroke>
)
export const DotsIcon = (p: IconProps) => (
  <Fill {...p}>
    <circle cx="5.5" cy="12" r="1.6" />
    <circle cx="12" cy="12" r="1.6" />
    <circle cx="18.5" cy="12" r="1.6" />
  </Fill>
)
export const SidebarIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M9 4.5v15" />
  </Stroke>
)
export const OutlineIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
    <path d="M15 4.5v15M6.5 9h5M6.5 12.5h5M6.5 16h3" />
  </Stroke>
)
export const ChevronRight = (p: IconProps) => (
  <Stroke sw={1.8} {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Stroke>
)
export const ChevronDown = (p: IconProps) => (
  <Stroke sw={1.8} {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Stroke>
)
export const OpenAllIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M8 4h9a2 2 0 0 1 2 2v9" />
    <rect x="4" y="8" width="11" height="12" rx="2" />
  </Stroke>
)
export const CloseIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </Stroke>
)
export const CheckIcon = (p: IconProps) => (
  <Stroke sw={2} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Stroke>
)
export const MinimizeIcon = (p: IconProps) => (
  <Stroke sw={1.2} {...p}>
    <path d="M5 12h14" />
  </Stroke>
)
export const MaximizeIcon = (p: IconProps) => (
  <Stroke sw={1.2} {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="1" />
  </Stroke>
)
export const RestoreIcon = (p: IconProps) => (
  <Stroke sw={1.2} {...p}>
    <rect x="5" y="8" width="11" height="11" rx="1" />
    <path d="M8 8V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2" />
  </Stroke>
)
export const WinCloseIcon = (p: IconProps) => (
  <Stroke sw={1.2} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Stroke>
)
export const ClockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Stroke>
)
export const DownloadIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
  </Stroke>
)
export const PrinterIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2" />
    <rect x="7" y="14" width="10" height="6" rx="1" />
  </Stroke>
)
export const CopyIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
    <path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5" />
  </Stroke>
)
export const PencilIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14.5 5.5l4 4M4 20l1-4.5L15.8 4.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L8.5 19z" />
  </Stroke>
)
export const TrashIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 7h16M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 1.8h6a2 2 0 0 0 2-1.8L18 7M10 11v6M14 11v6" />
  </Stroke>
)
export const RevealIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 17V7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2" />
    <path d="M3 17a2 2 0 0 0 2 2h7M15 16h6M18 13l3 3-3 3" />
  </Stroke>
)
export const ClipboardIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
    <path d="M9 4.5V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM8.5 11h7M8.5 14.5h7M8.5 18h4" />
  </Stroke>
)
/** A four-point spark: content written by an AI or coding agent. */
export const SparkIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3.5c.5 4.3 2.7 6.5 7 7-4.3.5-6.5 2.7-7 7-.5-4.3-2.7-6.5-7-7 4.3-.5 6.5-2.7 7-7z" />
    <path d="M18.5 3.5v3M17 5h3" />
  </Stroke>
)
export const RefreshIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4" />
  </Stroke>
)
export const ExternalIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Stroke>
)
export const ShieldIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Stroke>
)
export const LayersIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
    <path d="M3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5L12 21l8.5-4.5" />
  </Stroke>
)
export const TypeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 7V5h16v2M12 5v14M9 19h6" />
  </Stroke>
)
export const PenLineIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 20h8M15.5 4.5l4 4L9 19l-5 1 1-5z" />
  </Stroke>
)
export const InfoIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </Stroke>
)
