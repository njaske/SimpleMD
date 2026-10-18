// CONTRACT STUB (lane E implements). The slim formatting toolbar shown above the editor
// in Edit and Split modes only (Read stays clean).
import type { Platform } from '@shared/types'
import type { FormatCommand } from '@/lib/editor/types'

export interface FormatBarProps {
  onFormat: (cmd: FormatCommand) => void
  /** For shortcut hints in tooltips (⌘B vs Ctrl+B). */
  platform: Platform
}

export default function FormatBar(_props: FormatBarProps) {
  return null
}
