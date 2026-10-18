// Keeps two scrollable views of the same document in step by source line: the editor and
// the rendered preview in Split view. Each surface maps lines to pixels itself (the reader
// interpolates between its data-line anchors), so this only moves line numbers around.

/** Anything that can report and follow a source-line scroll position. Both EditorHandle
 *  and ReaderController satisfy this. */
export interface ScrollSurface {
  getTopLine(): number | null
  scrollToLine(line: number): void
  onScroll(cb: () => void): () => void
}

export interface LinkScrollOptions {
  /** Clock for echo detection (tests pass a fake one). */
  now?: () => number
}

/** Scroll events from a surface this soon after we moved it are its echo, not the user. */
const ECHO_WINDOW_MS = 150
/** Closer than this (in lines) is already in step; skip the no-op scroll. */
const IN_STEP = 0.01

/** Link `a` and `b`: when the user scrolls one, the other follows to the same source line.
 *  Must not feed back (a programmatic scroll must not bounce back), should coalesce to one
 *  update per animation frame, and must stop cleanly when the returned function is called. */
export function linkScroll(a: ScrollSurface, b: ScrollSurface, options: LinkScrollOptions = {}): () => void {
  const now = options.now ?? (() => performance.now())
  // When each surface was last moved by us; its scroll events until then are echoes.
  let drivenUntil: ReadonlyMap<ScrollSurface, number> = new Map()
  let leader: ScrollSurface | null = null
  let frame: number | null = null
  let stopped = false

  const follow = (): void => {
    frame = null
    const from = leader
    leader = null
    if (stopped || !from) return
    const to = from === a ? b : a
    const line = from.getTopLine()
    if (line === null || !Number.isFinite(line)) return
    const current = to.getTopLine()
    if (current !== null && Math.abs(current - line) < IN_STEP) return
    drivenUntil = new Map(drivenUntil).set(to, now() + ECHO_WINDOW_MS)
    to.scrollToLine(line)
  }

  const listen = (surface: ScrollSurface) => (): void => {
    if (stopped) return
    if (now() < (drivenUntil.get(surface) ?? -Infinity)) return
    leader = surface
    if (frame === null) frame = requestAnimationFrame(follow)
  }

  const offA = a.onScroll(listen(a))
  const offB = b.onScroll(listen(b))

  return () => {
    if (stopped) return
    stopped = true
    offA()
    offB()
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }
}
