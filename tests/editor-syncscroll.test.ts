import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { linkScroll, type ScrollSurface } from '../src/renderer/src/lib/editor/syncScroll.ts'

// A scroll surface whose position we control; `echo` makes a programmatic scroll fire its
// own scroll event, like a real scroller does.
interface FakeSurface extends ScrollSurface {
  top: number | null
  calls: number[]
  listeners: number
  userScroll(line: number): void
}

function fakeSurface(start: number | null = 0, echo = true): FakeSurface {
  const subs = new Set<() => void>()
  const surface: FakeSurface = {
    top: start,
    calls: [],
    get listeners() {
      return subs.size
    },
    getTopLine: () => surface.top,
    scrollToLine(line) {
      surface.calls.push(line)
      surface.top = line
      if (echo) subs.forEach((cb) => cb())
    },
    onScroll(cb) {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    userScroll(line) {
      surface.top = line
      subs.forEach((cb) => cb())
    }
  }
  return surface
}

let frames: Map<number, FrameRequestCallback>
let nextId: number
let clock: number
const now = (): number => clock

function runFrames(): void {
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

describe('linkScroll', () => {
  it('moves the other surface to the same source line in the same frame', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    linkScroll(editor, reader, { now })

    editor.userScroll(12.5)

    // No waiting for the next frame: a frame late is exactly the trailing the user sees.
    assert.deepEqual(reader.calls, [12.5])
    assert.equal(frames.size, 0)
  })

  it('works in both directions', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    linkScroll(editor, reader, { now })

    reader.userScroll(40)
    runFrames()

    assert.deepEqual(editor.calls, [40])
  })

  it('follows every scroll as it happens', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    linkScroll(editor, reader, { now })

    editor.userScroll(1)
    editor.userScroll(2)
    editor.userScroll(3)

    assert.deepEqual(reader.calls, [1, 2, 3])
  })

  it('ignores the echo of its own programmatic scroll', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    linkScroll(editor, reader, { now })

    editor.userScroll(10)
    runFrames()
    // The reader's echo must not schedule a scroll back to the editor.
    runFrames()

    assert.deepEqual(editor.calls, [])
    assert.equal(frames.size, 0)
  })

  it('follows the other surface again once the echo window has passed', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    linkScroll(editor, reader, { now })
    editor.userScroll(10)
    runFrames()

    clock += 500
    reader.userScroll(30)
    runFrames()

    assert.deepEqual(editor.calls, [30])
  })

  it('skips the scroll when the follower is already on that line', () => {
    const editor = fakeSurface(5)
    const reader = fakeSurface(5)
    linkScroll(editor, reader, { now })

    editor.userScroll(5)
    runFrames()

    assert.deepEqual(reader.calls, [])
  })

  it('does nothing when the leader has no position yet', () => {
    const editor = fakeSurface(null)
    const reader = fakeSurface()
    linkScroll(editor, reader, { now })

    editor.userScroll(Number.NaN)
    runFrames()

    assert.deepEqual(reader.calls, [])
  })

  it('unsubscribes when stopped', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    const stop = linkScroll(editor, reader, { now })

    stop()
    stop()
    editor.userScroll(8)

    assert.equal(editor.listeners, 0)
    assert.equal(reader.listeners, 0)
    assert.deepEqual(reader.calls, [])
  })

  it('drives wheel scrolling of each surface and follows right after every move', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    const editorEl = {} as HTMLElement
    const readerEl = {} as HTMLElement
    editor.scrollElement = () => editorEl
    reader.scrollElement = () => readerEl
    const moves = new Map<HTMLElement, () => void>()
    const takes = new Map<HTMLElement, () => void>()
    const cancelled: HTMLElement[] = []
    let stopped = 0
    const stop = linkScroll(editor, reader, {
      now,
      driveWheel: (el, afterMove, onTake) => {
        moves.set(el, afterMove)
        takes.set(el, onTake)
        return { stop: () => stopped++, cancel: () => cancelled.push(el) }
      }
    })
    assert.deepEqual([...moves.keys()], [editorEl, readerEl])

    // The driver moved the reader to line 20: the editor follows in that same call.
    reader.top = 20
    moves.get(readerEl)!()
    assert.deepEqual(editor.calls, [20])

    // Wheeling the editor stops the reader's glide, so the two never fight.
    takes.get(editorEl)!()
    assert.deepEqual(cancelled, [readerEl])

    stop()
    assert.equal(stopped, 2)
  })

  it('leaves wheel scrolling alone for surfaces without an element', () => {
    const editor = fakeSurface()
    const reader = fakeSurface()
    let driven = 0
    linkScroll(editor, reader, {
      now,
      driveWheel: () => {
        driven++
        return { stop: () => {}, cancel: () => {} }
      }
    })

    assert.equal(driven, 0)
  })

  it('uses the real clock by default', () => {
    const editor = fakeSurface()
    const reader = fakeSurface(0, false)
    const stop = linkScroll(editor, reader)

    editor.userScroll(3)
    runFrames()
    stop()

    assert.deepEqual(reader.calls, [3])
  })
})
