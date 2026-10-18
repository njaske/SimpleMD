// How much of the format bar fits: whole groups drop off the end into a "More" menu as
// the editor pane narrows. Sizes mirror styles/editor-ui.css.

export interface BarMetrics {
  /** Icon button width. */
  readonly button: number
  /** Flex gap between controls. */
  readonly gap: number
  /** A divider with its margins and the gaps on both sides. */
  readonly divider: number
  /** The heading menu trigger. */
  readonly heading: number
  /** Horizontal padding of the bar, both sides. */
  readonly padding: number
}

export const BAR_METRICS: BarMetrics = { button: 28, gap: 2, divider: 15, heading: 46, padding: 20 }

const groupWidth = (buttons: number, m: BarMetrics): number => buttons * m.button + Math.max(0, buttons - 1) * m.gap

/** Width the bar needs to show the first `count` groups (plus "More" when some are hidden). */
export function barWidth(groupSizes: readonly number[], count: number, m: BarMetrics = BAR_METRICS): number {
  const shown = groupSizes.slice(0, count).reduce((sum, n) => sum + m.divider + groupWidth(n, m), 0)
  const more = count < groupSizes.length ? m.divider + m.button : 0
  return m.padding + m.heading + shown + more
}

/** The most leading groups that fit in `available` px (0 = everything in "More"). */
export function visibleGroupCount(available: number, groupSizes: readonly number[], m: BarMetrics = BAR_METRICS): number {
  for (let count = groupSizes.length; count > 0; count--) {
    if (barWidth(groupSizes, count, m) <= available) return count
  }
  return 0
}
