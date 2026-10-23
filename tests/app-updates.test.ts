import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import './support/aliases.ts'
import { fakeHost, type FakeHost } from './support/fakeHost.ts'
import type * as UpdatesModule from '../src/renderer/src/app/updates.ts'
import type { UpdateResult } from '../src/shared/types.ts'

let updates: typeof UpdatesModule
before(async () => {
  updates = await import('../src/renderer/src/app/updates.ts')
})

const DAY = 24 * 60 * 60 * 1000
const NEWER: UpdateResult = {
  ok: true,
  info: { current: '1.1.1', latest: '1.2.0', available: true, url: 'https://github.com/njaske/SimpleMD/releases/tag/v1.2.0' }
}
const SAME: UpdateResult = {
  ok: true,
  info: { current: '1.1.1', latest: '1.1.1', available: false, url: 'https://github.com/njaske/SimpleMD/releases/tag/v1.1.1' }
}

/** A controllable clock and timer queue, the GitHub check and the opened links. */
function rig(fake: FakeHost, results: UpdateResult[] = [NEWER]) {
  let time = 100 * DAY
  let timers: { at: number; run: () => void; id: number }[] = []
  let seq = 0
  const checks: number[] = []
  const opened: string[] = []
  const actions = updates.createUpdateActions(fake.host, {
    check: async () => {
      checks.push(time)
      return results.length > 1 ? results.shift()! : results[0]
    },
    openUrl: (url) => void opened.push(url),
    now: () => time,
    later: (run, ms) => {
      const id = ++seq
      timers.push({ at: time + ms, run, id })
      return () => {
        timers = timers.filter((t) => t.id !== id)
      }
    }
  })
  /** Move the clock on, running every timer that falls due, then let promises settle. */
  const advance = async (ms: number): Promise<void> => {
    const end = time + ms
    for (;;) {
      const next = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0]
      if (!next) break
      timers = timers.filter((t) => t !== next)
      time = next.at
      next.run()
      await settle()
    }
    time = end
    await settle()
  }
  return { actions, checks, opened, advance, time: () => time }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

describe('update checks', () => {
  it('asks once, a few seconds after launch, before checking anything', async () => {
    const fake = await fakeHost({ updateChecks: 'ask' })
    const r = rig(fake)
    r.actions.start()

    assert.equal(fake.state().updateNotice, null)
    await r.advance(10_000)

    assert.equal(fake.state().updateNotice, 'ask')
    assert.deepEqual(r.checks, [])
  })

  it('never contacts GitHub on its own while turned off', async () => {
    const fake = await fakeHost({ updateChecks: 'off' })
    const r = rig(fake)
    r.actions.start()
    await r.advance(10 * DAY)

    assert.deepEqual(r.checks, [])
    assert.equal(fake.state().updateNotice, null)
  })

  it('turning it on checks straight away and then about once a day', async () => {
    const fake = await fakeHost({ updateChecks: 'ask' })
    const r = rig(fake, [SAME])
    r.actions.start()
    await r.advance(10_000)

    r.actions.enable()
    await settle()
    assert.equal(fake.state().updateChecks, 'on')
    assert.equal(fake.state().updateNotice, null)
    assert.equal(r.checks.length, 1)
    assert.equal(fake.state().lastUpdateCheck, r.checks[0])

    await r.advance(23 * 60 * 60 * 1000)
    assert.equal(r.checks.length, 1)
    await r.advance(2 * 60 * 60 * 1000)
    assert.equal(r.checks.length, 2)
  })

  it('checks soon after launch only when the last check is a day old', async () => {
    const recent = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 100 * DAY - 2 * 60 * 60 * 1000 })
    const a = rig(recent, [SAME])
    a.actions.start()
    await a.advance(60_000)
    assert.deepEqual(a.checks, [])

    const stale = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 100 * DAY - 2 * DAY })
    const b = rig(stale, [SAME])
    b.actions.start()
    await b.advance(60_000)
    assert.equal(b.checks.length, 1)
  })

  it('shows the notice and the gear dot when a newer version is out', async () => {
    const fake = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 0 })
    const r = rig(fake)
    r.actions.start()
    await r.advance(60_000)

    assert.equal(fake.state().updateNotice, 'available')
    assert.equal(fake.state().updateInfo?.latest, '1.2.0')
  })

  it('Later hides the notice for that version but keeps the dot; the next version shows again', async () => {
    const fake = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 0 })
    const newest: UpdateResult = { ok: true, info: { ...(NEWER as { info: object }).info, latest: '1.3.0' } as never }
    const r = rig(fake, [NEWER, NEWER, newest])
    r.actions.start()
    await r.advance(60_000)

    r.actions.later()
    assert.equal(fake.state().updateNotice, null)
    assert.equal(fake.state().skippedUpdate, '1.2.0')
    assert.equal(fake.state().updateInfo?.latest, '1.2.0')

    await r.advance(DAY + 60 * 60 * 1000)
    assert.equal(fake.state().updateNotice, null)

    await r.advance(DAY + 60 * 60 * 1000)
    assert.equal(fake.state().updateNotice, 'available')
    assert.equal(fake.state().updateInfo?.latest, '1.3.0')
  })

  it('Download opens the release page and closes the notice', async () => {
    const fake = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 0 })
    const r = rig(fake)
    r.actions.start()
    await r.advance(60_000)

    r.actions.download()

    assert.deepEqual(r.opened, ['https://github.com/njaske/SimpleMD/releases/tag/v1.2.0'])
    assert.equal(fake.state().updateNotice, null)
  })

  it('No thanks turns checks off and never asks again', async () => {
    const fake = await fakeHost({ updateChecks: 'ask' })
    const r = rig(fake)
    r.actions.start()
    await r.advance(10_000)

    r.actions.decline()
    await r.advance(5 * DAY)

    assert.equal(fake.state().updateChecks, 'off')
    assert.equal(fake.state().updateNotice, null)
    assert.deepEqual(r.checks, [])
  })

  it('a manual check works with checks off, and says when you are up to date', async () => {
    const fake = await fakeHost({ updateChecks: 'off' })
    const r = rig(fake, [SAME])

    await r.actions.checkNow()

    assert.equal(r.checks.length, 1)
    assert.deepEqual(fake.toasts, ["You're on the latest version (1.1.1)."])
    assert.equal(fake.state().updateChecking, false)
  })

  it('a manual check shows a version you chose Later for', async () => {
    const fake = await fakeHost({ updateChecks: 'on', skippedUpdate: '1.2.0', lastUpdateCheck: 100 * DAY })
    const r = rig(fake)

    await r.actions.checkNow()

    assert.equal(fake.state().updateNotice, 'available')
  })

  it('says plainly when GitHub could not be reached, and keeps the last check time', async () => {
    const fake = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 5 })
    const r = rig(fake, [{ ok: false, error: 'offline' }])

    await r.actions.checkNow()

    assert.equal(fake.toasts.length, 1)
    assert.match(fake.toasts[0], /Couldn't reach GitHub/)
    assert.equal(fake.state().lastUpdateCheck, 5)
  })

  it('an automatic check that fails stays quiet', async () => {
    const fake = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 0 })
    const r = rig(fake, [{ ok: false, error: 'unavailable' }])
    r.actions.start()
    await r.advance(60_000)

    assert.equal(r.checks.length, 1)
    assert.deepEqual(fake.toasts, [])
  })

  it('turning it off in Settings stops the daily checks', async () => {
    const fake = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 100 * DAY })
    const r = rig(fake, [SAME])
    r.actions.start()

    r.actions.setAuto(false)
    await r.advance(5 * DAY)

    assert.equal(fake.state().updateChecks, 'off')
    assert.deepEqual(r.checks, [])
  })

  it('closing the question counts as No thanks, so it really asks only once', async () => {
    const fake = await fakeHost({ updateChecks: 'ask' })
    const r = rig(fake)
    r.actions.start()
    await r.advance(10_000)

    r.actions.later()

    assert.equal(fake.state().updateChecks, 'off')
    assert.equal(fake.state().updateNotice, null)
  })

  it('a last check in the future (a clock that was wrong) counts as due', async () => {
    const fake = await fakeHost({ updateChecks: 'on', lastUpdateCheck: 100 * DAY + 365 * DAY })
    const r = rig(fake, [SAME])
    r.actions.start()
    await r.advance(60_000)

    assert.equal(r.checks.length, 1)
  })

  it('stop cancels everything pending', async () => {
    const fake = await fakeHost({ updateChecks: 'ask' })
    const r = rig(fake)
    r.actions.start()

    r.actions.stop()
    await r.advance(DAY)

    assert.equal(fake.state().updateNotice, null)
  })
})
