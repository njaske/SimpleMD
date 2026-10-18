// Small UI hooks for the format bar: delayed tooltips, how many groups fit, and roving
// focus with the arrow keys.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { visibleGroupCount } from './formatLayout'

export interface Tip {
  readonly label: string
  readonly hint: string | null
  /** Horizontal centre of the control, relative to the bar. */
  readonly center: number
}

// First tooltip waits a beat; moving along the bar right after shows the next at once.
const TIP_DELAY_MS = 450
const TIP_WARM_MS = 500

export function useTooltip(bar: RefObject<HTMLElement | null>) {
  const [tip, setTip] = useState<Tip | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const shown = useRef(false)
  const hiddenAt = useRef(0)

  const show = useCallback(
    (el: HTMLElement, label: string, hint: string | null) => {
      window.clearTimeout(timer.current)
      const place = (): void => {
        const box = bar.current?.getBoundingClientRect()
        if (!box || !el.isConnected) return
        const r = el.getBoundingClientRect()
        shown.current = true
        setTip({ label, hint, center: r.left - box.left + r.width / 2 })
      }
      const warm = shown.current || performance.now() - hiddenAt.current < TIP_WARM_MS
      if (warm) place()
      else timer.current = window.setTimeout(place, TIP_DELAY_MS)
    },
    [bar]
  )

  const hide = useCallback(() => {
    window.clearTimeout(timer.current)
    if (shown.current) hiddenAt.current = performance.now()
    shown.current = false
    setTip(null)
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])
  return { tip, show, hide }
}

/** Keep the tooltip inside the bar: centred on its control, clamped to the edges. */
export function useClampedLeft(el: RefObject<HTMLElement | null>, tip: Tip, barWidth: () => number): void {
  useLayoutEffect(() => {
    const node = el.current
    if (!node) return
    const w = node.offsetWidth
    const left = Math.min(Math.max(tip.center - w / 2, 6), Math.max(6, barWidth() - w - 6))
    node.style.left = `${left}px`
  }, [el, tip, barWidth])
}

/** How many leading groups fit in the bar, tracked as it resizes. */
export function useVisibleGroups(bar: RefObject<HTMLElement | null>, groupSizes: readonly number[]): number {
  const [count, setCount] = useState(groupSizes.length)
  useLayoutEffect(() => {
    const el = bar.current
    if (!el) return
    const measure = (): void => setCount(visibleGroupCount(el.clientWidth, groupSizes))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [bar, groupSizes])
  return count
}

const ROVING_KEYS: Record<string, (at: number, count: number) => number> = {
  ArrowRight: (at, n) => (at + 1) % n,
  ArrowLeft: (at, n) => (at - 1 + n) % n,
  Home: () => 0,
  End: (_at, n) => n - 1
}

/** Arrow keys, Home and End move focus between `[data-roving]` controls in the toolbar. */
export function onRovingKey(e: KeyboardEvent<HTMLElement>): void {
  const step = ROVING_KEYS[e.key]
  if (!step) return
  const controls = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-roving]'))
  const at = controls.findIndex((c) => c === document.activeElement)
  if (at < 0 || !controls.length) return
  e.preventDefault()
  controls[step(at, controls.length)].focus()
}
