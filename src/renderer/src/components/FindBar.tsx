// CONTRACT STUB (lane R implements). Find-in-document bar for the reader (Ctrl/Cmd+F
// while reading). Floats at the top-right of the reader pane.
import type { ReaderController } from '@/lib/reader/ReaderController'

export interface FindBarProps {
  reader: ReaderController
  /** Text to start with (e.g. the current selection). */
  initialQuery?: string
  onClose: () => void
}

export default function FindBar(_props: FindBarProps) {
  return null
}
