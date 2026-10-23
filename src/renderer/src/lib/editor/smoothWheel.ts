// Wheel scrolling done by the page instead of the browser, for the two panes of Split view.
// The browser scrolls the pane under the mouse on its own compositor thread, ahead of the
// page, so whatever follows it is always drawn a frame or two behind. Moving the pane here,
// on an animation frame, lets the other pane move in that same frame.

/** Pixels per wheel "line" (deltaMode 1), as Chromium scrolls them. */
const LINE_PX = 40
/** Deltas this big come from a mouse wheel notch and glide; smaller ones (touchpads,
 *  which already send smooth streams) are followed exactly. */
const NOTCH_PX = 50
/** Time constant of the glide: about 95% of the way after three of these. */
const GLIDE_MS = 45
/** Within this many pixels the glide is done (more than a device pixel at 150% scaling). */
const SETTLE_PX = 0.75
/** A scrollTop this far from where we put it means something else moved the scroller. */
const TAKEN_OVER_PX = 2

export interface WheelDelta {
  deltaY: number
  deltaMode: number
}

/** A wheel event's vertical movement in pixels. */
export function wheelPixels(e: WheelDelta, pageHeight: number): number {
  if (e.deltaMode === 1) return e.deltaY * LINE_PX
  if (e.deltaMode === 2) return e.deltaY * pageHeight
  return e.deltaY
}

export interface DriveWheelOptions {
  /** True to jump instead of glide (the app's Reduce motion setting or the system's). */
  reduceMotion?: () => boolean
  /** Called for each wheel event taken over, before the move (Split view uses it to stop
   *  the other pane's glide, so a wheel on one pane never fights a glide on the other). */
  onTake?: () => void
}

export interface WheelDriver {
  /** Stop the current glide where it is; wheel input is still taken over. */
  cancel(): void
  /** Stop for good and hand wheel scrolling back to the browser. */
  stop(): void
}

const maxTop = (el: HTMLElement): number => Math.max(0, el.scrollHeight - el.clientHeight)

/** True when something between the event's target and `root` can still scroll the way the
 *  wheel is going (a tall code block, CodeMirror's search panel, or a wide table for the
 *  sideways part of a diagonal swipe): that one gets the event, from the browser. */
function innerScrollerTakes(target: EventTarget | null, root: HTMLElement, dx: number, dy: number): boolean {
  if (typeof getComputedStyle !== 'function') return false
  const scrolls = (overflow: string): boolean => overflow === 'auto' || overflow === 'scroll'
  for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
    const style = getComputedStyle(node)
    if (dy !== 0 && scrolls(style.overflowY)) {
      const room = dy > 0 ? node.scrollHeight - node.clientHeight - node.scrollTop : node.scrollTop
      if (room > 1) return true
    }
    if (dx !== 0 && scrolls(style.overflowX)) {
      const room = dx > 0 ? node.scrollWidth - node.clientWidth - node.scrollLeft : node.scrollLeft
      if (room > 1) return true
    }
  }
  return false
}

const systemReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** Take over vertical wheel scrolling of `el`: notches glide, touchpad deltas are followed
 *  exactly, and `afterMove` runs right after each move, in the same frame. Zoom (Ctrl),
 *  sideways and Shift scrolling stay with the browser. */
export function driveWheel(el: HTMLElement, afterMove: () => void, options: DriveWheelOptions = {}): WheelDriver {
  const reduce = (): boolean =>
    options.reduceMotion ? options.reduceMotion() : !!el.closest?.('.smd-reduce-motion') || systemReducedMotion()
  let target = 0
  let pos = 0
  let glide = false
  let frame: number | null = null
  let last = 0

  const cancel = (): void => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
  }

  const tick = (time: number): void => {
    frame = null
    // Something else moved it (scrollbar, keyboard, find): let that win.
    if (Math.abs(el.scrollTop - pos) > TAKEN_OVER_PX) return
    const dt = last ? Math.min(time - last, 100) : 16
    last = time
    const end = Math.min(Math.max(target, 0), maxTop(el))
    let next = glide ? pos + (end - pos) * (1 - Math.exp(-dt / GLIDE_MS)) : end
    // The last sub-pixel steps would round away to nothing: land instead.
    if (Math.abs(end - next) < 1) next = end
    const before = el.scrollTop
    el.scrollTop = next
    // Read back: the browser rounds to device pixels and clamps at the real bottom.
    pos = el.scrollTop
    afterMove()
    // Done when there (to within the rounding), or when it was asked for the end and
    // would not move (the real bottom is a fraction short of the reported one).
    const arrived = Math.abs(end - pos) < SETTLE_PX || (next === end && pos === before)
    if (!arrived) frame = requestAnimationFrame(tick)
  }

  const onWheel = (e: WheelEvent): void => {
    if (e.defaultPrevented || e.ctrlKey || e.shiftKey || e.deltaY === 0) return
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
    const dy = wheelPixels(e, el.clientHeight)
    if (innerScrollerTakes(e.target, el, e.deltaX, dy)) return
    const gliding = frame !== null
    const from = gliding ? target : el.scrollTop
    const next = Math.min(Math.max(from + dy, 0), maxTop(el))
    // At an end with nothing to do: leave the event alone.
    if (next === from && !gliding) return
    e.preventDefault()
    options.onTake?.()
    if (!gliding) {
      pos = el.scrollTop
      last = 0
      // One mode per gesture: a touchpad swipe that spikes past a notch's size mid-stream
      // must not switch to gliding and back (a visible jolt). Motion is checked once too.
      glide = Math.abs(dy) >= NOTCH_PX && !reduce()
    }
    target = next
    if (frame === null) frame = requestAnimationFrame(tick)
  }

  el.addEventListener('wheel', onWheel, { passive: false })
  return {
    cancel,
    stop() {
      cancel()
      el.removeEventListener('wheel', onWheel)
    }
  }
}
