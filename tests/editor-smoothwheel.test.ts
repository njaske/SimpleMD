import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { driveWheel, wheelPixels } from '../src/renderer/src/lib/editor/smoothWheel.ts'

function settle(max = 200): number {
  let n = 0
  while (frames.size && n < max) {
    frame()
    n++
  }
  return n
}

// A scroller we control: wheel listeners, a clamped scrollTop, and a record of every
// position set, like the real element.
interface FakeScroller {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  sets: number[]
  listeners: number
  wheel(init: Partial<WheelInit>): { prevented: boolean }
}
interface WheelInit {
  deltaY: number
  deltaX: number
  deltaMode: number
  ctrlKey: boolean
  shiftKey: boolean
}

function fakeScroller(height = 10_000, client = 800, opts: { dpr?: number; maxTop?: number } = {}): FakeScroller & HTMLElement {
  const subs = new Set<(e: WheelEvent) => void>()
  const dpr = opts.dpr ?? 0
  const max = opts.maxTop ?? height - client
  let top = 0
  const el = {
    scrollHeight: height,
    clientHeight: client,
    sets: [] as number[],
    get scrollTop() {
      return top
    },
    set scrollTop(v: number) {
      const clamped = Math.min(Math.max(v, 0), max)
      top = dpr ? Math.round(clamped * dpr) / dpr : clamped
      el.sets.push(top)
    },
    get listeners() {
      return subs.size
    },
    addEventListener: (_: string, cb: (e: WheelEvent) => void) => subs.add(cb),
    removeEventListener: (_: string, cb: (e: WheelEvent) => void) => subs.delete(cb),
    contains: () => true,
    wheel(init: Partial<WheelInit>) {
      let prevented = false
      const e = {
        deltaY: 0,
        deltaX: 0,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        defaultPrevented: false,
        target: el,
        preventDefault: () => {
          prevented = true
        },
        ...init
      } as unknown as WheelEvent
      subs.forEach((cb) => cb(e))
      return { prevented }
    }
  }
  return el as unknown as FakeScroller & HTMLElement
}

let frames: Map<number, FrameRequestCallback>
let nextId: number
let clock: number

function frame(ms = 16): void {
  clock += ms
  const pending = [...frames.values()]
  frames.clear()
  pending.forEach((cb) => cb(clock))
}

beforeEach(() => {
  frames = new Map()
  nextId = 1
  clock = 1000
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++
    frames.set(id, cb)
    return id
  }
  globalThis.cancelAnimationFrame = (id: number): void => {
    frames.delete(id)
  }
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
  Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
})

describe('wheelPixels', () => {
  it('converts pixel, line and page deltas to pixels', () => {
    assert.equal(wheelPixels({ deltaY: 100, deltaMode: 0 }, 800), 100)
    assert.equal(wheelPixels({ deltaY: 3, deltaMode: 1 }, 800), 120)
    assert.equal(wheelPixels({ deltaY: -1, deltaMode: 2 }, 800), -800)
  })
})

describe('driveWheel', () => {
  it('glides a mouse-wheel notch over a few frames and reports every step', () => {
    const el = fakeScroller()
    const moves: number[] = []
    driveWheel(el, () => moves.push(el.scrollTop))

    const { prevented } = el.wheel({ deltaY: 100 })
    assert.equal(prevented, true)
    for (let i = 0; i < 30; i++) frame()

    assert.equal(el.scrollTop, 100)
    assert.ok(moves.length >= 4, `glided in ${moves.length} steps`)
    // Always moving forward, and each step reported after the scroller moved.
    moves.slice(1).forEach((v, i) => assert.ok(v >= moves[i]))
    assert.deepEqual(moves, el.sets)
  })

  it('adds notches that arrive mid-glide to the same target', () => {
    const el = fakeScroller()
    driveWheel(el, () => {})

    el.wheel({ deltaY: 100 })
    frame()
    el.wheel({ deltaY: 100 })
    for (let i = 0; i < 40; i++) frame()

    assert.equal(el.scrollTop, 200)
  })

  it('follows small touchpad deltas exactly, on the next frame', () => {
    const el = fakeScroller()
    driveWheel(el, () => {})

    el.wheel({ deltaY: 7.5 })
    el.wheel({ deltaY: 4 })
    frame()

    assert.equal(el.scrollTop, 11.5)
    assert.equal(frames.size, 0)
  })

  it('jumps straight to the target when motion is reduced', () => {
    const el = fakeScroller()
    driveWheel(el, () => {}, { reduceMotion: () => true })

    el.wheel({ deltaY: 100 })
    frame()

    assert.equal(el.scrollTop, 100)
  })

  it('leaves zoom, sideways and Shift scrolling to the browser', () => {
    const el = fakeScroller()
    driveWheel(el, () => {})

    assert.equal(el.wheel({ deltaY: 100, ctrlKey: true }).prevented, false)
    assert.equal(el.wheel({ deltaY: 100, shiftKey: true }).prevented, false)
    assert.equal(el.wheel({ deltaY: 5, deltaX: 40 }).prevented, false)
    assert.equal(frames.size, 0)
  })

  it('stops at the ends without holding on to the wheel', () => {
    const el = fakeScroller(1000, 800)
    driveWheel(el, () => {})

    assert.equal(el.wheel({ deltaY: -100 }).prevented, false)
    el.wheel({ deltaY: 500 })
    for (let i = 0; i < 40; i++) frame()

    assert.equal(el.scrollTop, 200)
    assert.equal(el.wheel({ deltaY: 100 }).prevented, false)
  })

  it('gives way when something else moves the scroller mid-glide', () => {
    const el = fakeScroller()
    const moves: number[] = []
    driveWheel(el, () => moves.push(el.scrollTop))

    el.wheel({ deltaY: 300 })
    frame()
    el.scrollTop = 5000 // the user grabbed the scrollbar
    const before = moves.length
    frame()

    assert.equal(el.scrollTop, 5000)
    assert.equal(moves.length, before)
    assert.equal(frames.size, 0)
  })

  it('finishes the glide when the browser rounds scrollTop to device pixels', () => {
    // 125% display scaling: positions snap to 0.8 px steps.
    const el = fakeScroller(10_000, 800, { dpr: 1.25 })
    driveWheel(el, () => {})

    el.wheel({ deltaY: 3.3 })
    el.wheel({ deltaY: 100 })
    const ran = settle()

    assert.ok(ran < 60, `still running after ${ran} frames`)
    assert.equal(frames.size, 0)
    assert.ok(Math.abs(el.scrollTop - 103.3) < 1)
  })

  it('finishes at the bottom when the real maximum is a fraction below the reported one', () => {
    // scrollHeight - clientHeight says 9200, but the content really stops at 9199.6.
    const el = fakeScroller(10_000, 800, { dpr: 1.5, maxTop: 9199.6 })
    driveWheel(el, () => {})
    el.scrollTop = 9150

    el.wheel({ deltaY: 300 })
    const ran = settle()

    assert.ok(ran < 60, `still running after ${ran} frames`)
    assert.equal(frames.size, 0)
  })

  it('reports each wheel it takes, and a glide can be cancelled from outside', () => {
    const el = fakeScroller()
    let took = 0
    const driver = driveWheel(el, () => {}, { onTake: () => took++ })

    el.wheel({ deltaY: 100 })
    frame()
    driver.cancel()
    const at = el.scrollTop
    settle()

    assert.equal(took, 1)
    assert.equal(el.scrollTop, at)
    assert.equal(frames.size, 0)
    // Still listening after a cancel.
    assert.equal(el.wheel({ deltaY: 100 }).prevented, true)
  })

  it('removes its listener and stops gliding when stopped', () => {
    const el = fakeScroller()
    const { stop } = driveWheel(el, () => {})
    el.wheel({ deltaY: 100 })

    stop()
    frame()

    assert.equal(el.listeners, 0)
    assert.equal(el.scrollTop, 0)
  })
})
