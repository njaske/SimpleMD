// Shared timing helper for the logic speed checks.

/** Median wall time of `runs` calls after a warm-up, so one GC pause or a machine busy
 *  with the other test files can't fail a speed check. */
export function medianMs(fn: () => void, runs = 5): number {
  fn()
  const times = Array.from({ length: runs }, () => {
    const started = performance.now()
    fn()
    return performance.now() - started
  })
  return times.sort((a, b) => a - b)[runs >> 1]
}
