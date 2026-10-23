// Optional update checks. Nothing goes online unless the user turned checks on (then at
// most about once a day) or asked right now. SimpleMD asks once, a few seconds after
// launch, whether to turn them on. A newer version shows a notice in the corner and a dot
// on Settings; Download opens the release page. Nothing is downloaded or installed here.
import type { UpdateResult } from '@shared/types'
import type { AppHost } from './host'

/** Wait this long after launch before asking about update checks. */
const ASK_DELAY_MS = 6_000
/** And this long before the first automatic check, so it never slows startup. */
const FIRST_CHECK_DELAY_MS = 15_000
/** Automatic checks happen once this much time has passed since the last one. */
const CHECK_EVERY_MS = 24 * 60 * 60 * 1000
/** How often a running app looks at whether a check is due. */
const LOOK_EVERY_MS = 60 * 60 * 1000

export interface UpdateDeps {
  check: () => Promise<UpdateResult>
  openUrl: (url: string) => void
  now: () => number
  /** Run `fn` after `ms`; returns a cancel function. */
  later: (fn: () => void, ms: number) => () => void
}

export type UpdateActions = ReturnType<typeof createUpdateActions>

export function createUpdateActions(host: AppHost, deps: UpdateDeps) {
  const timers = new Set<() => void>()
  let looking = false

  const after = (fn: () => void, ms: number): void => {
    const cancel = deps.later(() => {
      timers.delete(cancel)
      fn()
    }, ms)
    timers.add(cancel)
  }

  const due = (): boolean => {
    const s = host.state()
    const age = deps.now() - s.lastUpdateCheck
    // A last check "in the future" means the clock was wrong then: check, don't wait years.
    return s.updateChecks === 'on' && (age >= CHECK_EVERY_MS || age < 0)
  }

  /** Ask GitHub. `manual`: the user asked, so say what happened either way, and show a
   *  version they chose Later for. Automatic checks stay quiet unless there's news. */
  const run = async (manual: boolean): Promise<void> => {
    if (host.state().updateChecking) return
    host.update({ updateChecking: true })
    const result = await deps.check().catch((): UpdateResult => ({ ok: false, error: 'offline' }))
    if (!result.ok) {
      host.update({ updateChecking: false })
      if (manual) {
        host.toast(
          result.error === 'offline'
            ? "Couldn't reach GitHub to check for updates. Check your connection and try again."
            : "GitHub didn't answer the update check just now. Try again in a little while."
        )
      }
      return
    }
    const { info } = result
    host.update((s) => ({
      updateChecking: false,
      updateInfo: info,
      lastUpdateCheck: deps.now(),
      updateNotice:
        info.available && (manual || info.latest !== s.skippedUpdate)
          ? 'available'
          : s.updateNotice === 'available'
            ? null
            : s.updateNotice
    }))
    if (manual && !info.available) host.toast(`You're on the latest version (${info.current}).`)
  }

  /** While checks are on, look every hour whether a day has passed since the last one. */
  const look = (): void => {
    if (host.state().updateChecks !== 'on') {
      looking = false
      return
    }
    if (due()) void run(false)
    after(look, LOOK_EVERY_MS)
  }

  const startLooking = (delay: number): void => {
    if (looking) return
    looking = true
    after(look, delay)
  }

  return {
    /** Call once settings have loaded. */
    start(): void {
      const checks = host.state().updateChecks
      if (checks === 'ask') after(() => host.update((s) => (s.updateChecks === 'ask' ? { updateNotice: 'ask' } : null)), ASK_DELAY_MS)
      else if (checks === 'on') startLooking(FIRST_CHECK_DELAY_MS)
    },
    /** "Turn on" in the first-run notice. */
    enable(): void {
      host.update({ updateChecks: 'on', updateNotice: null })
      void run(false)
      startLooking(LOOK_EVERY_MS)
    },
    /** "No thanks": never ask again, never check on its own. */
    decline(): void {
      host.update({ updateChecks: 'off', updateNotice: null })
    },
    /** The switch in Settings. */
    setAuto(on: boolean): void {
      if (!on) {
        host.update((s) => ({ updateChecks: 'off', updateNotice: s.updateNotice === 'ask' ? null : s.updateNotice }))
        return
      }
      host.update((s) => ({ updateChecks: 'on', updateNotice: s.updateNotice === 'ask' ? null : s.updateNotice }))
      if (due()) void run(false)
      startLooking(LOOK_EVERY_MS)
    },
    /** "Check for updates" (command palette, Settings). */
    checkNow(): Promise<void> {
      return run(true)
    },
    /** Open the release page for the version found. */
    download(): void {
      const info = host.state().updateInfo
      if (info?.available) deps.openUrl(info.url)
      host.update({ updateNotice: null })
    },
    /** "Later" (or closing the notice): no notice for this version again; the dot stays.
     *  Closing the first-run question counts as No thanks, so it is asked only once. */
    later(): void {
      host.update((s) =>
        s.updateNotice === 'ask'
          ? { updateNotice: null, updateChecks: 'off' }
          : { updateNotice: null, skippedUpdate: s.updateInfo?.latest ?? s.skippedUpdate }
      )
    },
    stop(): void {
      timers.forEach((cancel) => cancel())
      timers.clear()
      looking = false
    }
  }
}
