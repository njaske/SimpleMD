// CONTRACT STUB (lane E implements). Keeps two scrollable views of the same document in
// step by source line: the editor and the rendered preview in Split view.

/** Anything that can report and follow a source-line scroll position. Both EditorHandle
 *  and ReaderController satisfy this. */
export interface ScrollSurface {
  getTopLine(): number | null
  scrollToLine(line: number): void
  onScroll(cb: () => void): () => void
}

/** Link `a` and `b`: when the user scrolls one, the other follows to the same source line.
 *  Must not feed back (a programmatic scroll must not bounce back), should coalesce to one
 *  update per animation frame, and must stop cleanly when the returned function is called. */
export function linkScroll(_a: ScrollSurface, _b: ScrollSurface): () => void {
  return () => {}
}
