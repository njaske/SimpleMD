import type { CSSProperties, ReactNode } from 'react'

export interface IconProps {
  size?: number
  sw?: number
  style?: CSSProperties
  className?: string
}

function Stroke({
  size = 16,
  sw = 1.6,
  style,
  className,
  children
}: IconProps & { children: ReactNode }) {
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
    >
      {children}
    </svg>
  )
}

function Fill({
  size = 16,
  style,
  className,
  children
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      style={style}
      className={className}
    >
      {children}
    </svg>
  )
}

export const FileIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Stroke>
)
export const SearchIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </Stroke>
)
export const BookmarkIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Stroke>
)
export const BookmarkFill = (p: IconProps) => (
  <Fill {...p}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Fill>
)
export const SunIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </Stroke>
)
export const MoonIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M20.5 14.5A8.3 8.3 0 0 1 9.5 3.5a8.3 8.3 0 1 0 11 11z" />
  </Stroke>
)
export const FolderPlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <path d="M12 11v5M9.5 13.5h5" />
  </Stroke>
)
export const FolderIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Stroke>
)
export const FilePlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 12v5M9.5 14.5h5" />
  </Stroke>
)
export const ChevronRight = (p: IconProps) => (
  <Stroke sw={2} {...p}>
    <path d="M9 6l6 6-6 6" />
  </Stroke>
)
export const OpenAllIcon = (p: IconProps) => (
  <Stroke sw={1.7} {...p}>
    <path d="M4 12h11M11 7l5 5-5 5M20 5v14" />
  </Stroke>
)
export const CloseIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Stroke>
)
export const MinimizeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 12h14" />
  </Stroke>
)
export const MaximizeIcon = (p: IconProps) => (
  <Stroke sw={1.7} {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1.5" />
  </Stroke>
)
export const RestoreIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="8" y="8" width="11" height="11" rx="1.5" />
    <path d="M5.5 15.5V6.5A1.5 1.5 0 0 1 7 5h9" />
  </Stroke>
)
export const ClockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Stroke>
)
export const DownloadIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 4v10M8 11l4 3 4-3M5 19h14" />
  </Stroke>
)
export const OutlineIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M8 6h12M8 12h12M8 18h8M4 6h.01M4 12h.01M4 18h.01" />
  </Stroke>
)
export const SlidersIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 6h8M16 6h4M4 12h2M10 12h10M4 18h7M15 18h5" />
    <circle cx="14" cy="6" r="2" />
    <circle cx="8" cy="12" r="2" />
    <circle cx="13" cy="18" r="2" />
  </Stroke>
)
