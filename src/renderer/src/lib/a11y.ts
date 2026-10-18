import { useEffect, useLayoutEffect, useRef } from 'react'
import type { KeyboardEvent, RefObject } from 'react'

/** Make a clickable element behave like a button under the keyboard:
 *  Enter or Space activates it. Use together with role="button" + tabIndex={0}. */
export function activateOnKey(handler: () => void) {
  return (e: KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handler()
    }
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement
  )
}

/** Keep Tab / Shift+Tab inside `root` (call from its keydown handler). */
export function trapTab(e: KeyboardEvent, root: HTMLElement | null): void {
  if (e.key !== 'Tab' || !root) return
  const items = focusableIn(root)
  if (!items.length) {
    e.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}

/** While mounted: move focus into `ref` (the `[data-autofocus]` element, else the first
 *  focusable one, or `ref` itself with `focusRoot`) and give it back to whatever had
 *  focus before, on unmount. */
export function useFocusReturn(ref: RefObject<HTMLElement | null>, focusRoot = false): void {
  const previous = useRef<Element | null>(null)
  useLayoutEffect(() => {
    previous.current = document.activeElement
    const root = ref.current
    if (root && !root.contains(document.activeElement)) {
      const target = focusRoot
        ? root
        : (root.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(root)[0] ?? root)
      target.focus({ preventScroll: true })
    }
    return () => {
      const prev = previous.current
      if (prev instanceof HTMLElement && prev.isConnected) prev.focus({ preventScroll: true })
    }
    // Only on mount/unmount: the initial target is decided once.
  }, [ref])
}

/** Call `onOutside` for pointer presses outside `ref` (popovers, menus). */
export function useOutsidePress(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  ignore?: RefObject<HTMLElement | null>
): void {
  useEffect(() => {
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node | null
      if (!t || ref.current?.contains(t) || ignore?.current?.contains(t)) return
      // The button that opened a menu toggles it itself on click.
      if (t instanceof Element && t.closest('[data-menu-anchor]')) return
      onOutside()
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [ref, ignore, onOutside])
}

/** Next index for arrow-key navigation in a list of `count` items (wraps). */
export function stepIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return -1
  if (current < 0) return delta > 0 ? 0 : count - 1
  return (current + delta + count) % count
}
