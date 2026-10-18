// Stroke icons for the format bar, drawn in the same style as lib/icons.tsx: 24-unit grid,
// 1.6 stroke, round caps and joins, currentColor.
import type { ReactNode } from 'react'

export interface FormatIconProps {
  size?: number
}

function Stroke({ size = 16, sw = 1.6, children }: FormatIconProps & { sw?: number; children: ReactNode }) {
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
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

const DOT = 2.6

export const HeadingIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M6 5v14M16 5v14M6 12h10" />
    <path d="M19.5 19v-5l-1.5 1" strokeWidth={1.4} />
  </Stroke>
)

// A touch heavier than the rest so the glyph itself reads as bold.
export const BoldIcon = (p: FormatIconProps) => (
  <Stroke {...p} sw={2.1}>
    <path d="M7.5 5h5.25a3.5 3.5 0 0 1 0 7H7.5zM7.5 12h6.25a3.5 3.5 0 0 1 0 7H7.5z" />
  </Stroke>
)

export const ItalicIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M18 5h-7.5M13.5 19H6M14.5 5l-5 14" />
  </Stroke>
)

export const StrikeIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M16.5 7.2C15.8 5.8 14.2 5 12 5c-2.8 0-4.5 1.4-4.5 3.3 0 1.2.6 2.1 1.9 2.7" />
    <path d="M4 12h16" />
    <path d="M16 14.6c.3.5.5 1 .5 1.6 0 1.9-1.9 3.3-4.6 3.3-2.4 0-4.2-.9-4.9-2.6" />
  </Stroke>
)

export const InlineCodeIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M9 7.5 4.5 12 9 16.5M15 7.5l4.5 4.5-4.5 4.5" />
  </Stroke>
)

export const LinkIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M10.2 13.8a4 4 0 0 0 5.66 0l3.18-3.18a4 4 0 0 0-5.66-5.66l-1.06 1.06" />
    <path d="M13.8 10.2a4 4 0 0 0-5.66 0l-3.18 3.18a4 4 0 0 0 5.66 5.66l1.06-1.06" />
  </Stroke>
)

export const ImageIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m20.5 15.5-4.3-4.3a1.5 1.5 0 0 0-2.1 0L5.5 19.5" />
  </Stroke>
)

export const QuoteIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M4.5 5.5v13" strokeWidth={2.2} />
    <path d="M9 7h10.5M9 12h10.5M9 17h7" />
  </Stroke>
)

export const BulletListIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10" />
    <path d="M4.75 6.5h.01M4.75 12h.01M4.75 17.5h.01" strokeWidth={DOT} />
  </Stroke>
)

export const NumberedListIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M10.5 6.5h9M10.5 12h9M10.5 17.5h9" />
    <path d="M4 5.5 5.3 4.8v4.4M4 9.2h2.6" strokeWidth={1.3} />
    <path d="M4.1 14.9c.2-.6.7-.9 1.3-.9.7 0 1.2.4 1.2 1.1 0 .9-1.2 1.6-2.5 2.9h2.6" strokeWidth={1.3} />
  </Stroke>
)

export const TaskListIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="4" width="5.5" height="5.5" rx="1.4" />
    <path d="m3.8 16.6 1.9 1.9 3.3-3.6" />
    <path d="M12.5 6.75h7M12.5 17h7" />
  </Stroke>
)

export const CodeBlockIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
    <path d="m10 9.5-2.5 2.5 2.5 2.5M14 9.5l2.5 2.5-2.5 2.5" />
  </Stroke>
)

export const TableIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
  </Stroke>
)

export const DividerIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M3.5 12h17" />
    <path d="M7 6.5h10M7 17.5h10" opacity={0.45} />
  </Stroke>
)

export const ChevronDownIcon = (p: FormatIconProps) => (
  <Stroke {...p} sw={1.8}>
    <path d="m7 10 5 5 5-5" />
  </Stroke>
)

export const MoreIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M6 12h.01M12 12h.01M18 12h.01" strokeWidth={DOT} />
  </Stroke>
)

export const ParagraphIcon = (p: FormatIconProps) => (
  <Stroke {...p}>
    <path d="M13 4.5v15M17 4.5v15M19 4.5h-8.5a4 4 0 0 0 0 8H13" />
  </Stroke>
)
