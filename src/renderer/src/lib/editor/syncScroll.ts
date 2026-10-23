// Keeps two scrollable views of the same document in step by source line: the editor and
// the rendered preview in Split view. Each surface maps lines to pixels itself (the reader
// interpolates between its data-line anchors), so this only moves line numbers around.

/** Anything that can report and follow a source-line scroll position. Both EditorHandle
 *  and ReaderController satisfy this. */
export interface ScrollSurface {
  getTopLine(): number | null
  scrollToLine(line: number): void
  onScroll(cb: () => void): () => void
  /** The element that scrolls. When given, wheel input over it is driven by the page so
   *  the other surface can move in the very same frame (see smoothWheel). */
  scrollElement?(): HTMLElement | null
}

export interface LinkScrollOptions {
  /** Clock for echo detection (tests pass a fake one). */
  now?: () => number
  /** Takes over wheel scrolling of a surface's element, calls `afterMove` right after each
   *  move and `onTake` for each wheel it takes (the app passes smoothWheel's driveWheel). */
  driveWheel?: (el: HTMLElement, afterMove: () => void, onTake: () => void) => WheelControl
}

/** What a wheel driver hands back: cancel its current glide, or stop it for good. */
export interface WheelControl {
  cancel(): void
  stop(): void
}

/** Scroll events from a surface this soon after we moved it are its echo, not the user. */
const ECHO_WINDOW_MS = 150
/** Closer than this (in lines) is already in step; skip the no-op scroll. */
const IN_STEP = 0.01

/** Link `a` and `b`: when the user scrolls one, the other follows to the same source line
 *  at once, in the same frame (waiting a frame is exactly the trailing people notice). Must
 *  not feed back (a programmatic scroll must not bounce back) and must stop cleanly when
 *  the returned function is called. */
export function linkScroll(a: ScrollSurface, b: ScrollSurface, options: LinkScrollOptions = {}): () => void {
  const now = options.now ?? (() => performance.now())
  // When each surface was last moved by us; its scroll events until then are echoes.
  let drivenUntil: ReadonlyMap<ScrollSurface, number> = new Map()
  let stopped = false

  const follow = (from: ScrollSurface): void => {
    if (stopped) return
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
    follow(surface)
  }

  // Wheel input over either surface: moved by the page, and the other follows straight after.
  // A wheel on one surface stops a glide still running on the other, so they never fight.
  const drivers = new Map<ScrollSurface, WheelControl>()
  const wheel = (surface: ScrollSurface): (() => void) => {
    const el = surface.scrollElement?.()
    if (!el || !options.driveWheel) return () => {}
    const other = surface === a ? b : a
    const driver = options.driveWheel(el, () => follow(surface), () => drivers.get(other)?.cancel())
    drivers.set(surface, driver)
    return () => driver.stop()
  }

  const offs = [a.onScroll(listen(a)), b.onScroll(listen(b)), wheel(a), wheel(b)]

  return () => {
    if (stopped) return
    stopped = true
    offs.forEach((off) => off())
  }
}
