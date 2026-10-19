// Editor contract shared by CodeEditor (lane E) and the App shell. Lane E may add
// members but must not change or remove these.

export type FormatCommand =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'code'
  | 'link'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  /** Turns heading lines back into plain paragraphs (the heading dropdown's last row). */
  | 'paragraph'
  | 'quote'
  | 'bulletList'
  | 'numberedList'
  | 'taskList'
  | 'codeBlock'
  | 'table'
  | 'divider'
  | 'image'

/** Imperative handle to the mounted editor, passed to the App through `onReady`. */
export interface EditorHandle {
  /** Apply a formatting command to the selection (toggles where that makes sense). */
  format(cmd: FormatCommand): void
  focus(): void
  /** Replace the selection with `text` (one undo step). */
  insertText(text: string): void
  /** 0-based source line at the top of the viewport (fractional within a line). */
  getTopLine(): number | null
  /** Scroll so source line `line` (fractional allowed) is at the top of the viewport. */
  scrollToLine(line: number): void
  /** Subscribe to user scrolling. Returns an unsubscribe function. */
  onScroll(cb: () => void): () => void
  /** Open the find and replace panel (prefilled from the selection) and focus its field. */
  openSearch(): void
}
