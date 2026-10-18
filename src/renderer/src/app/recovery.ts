// Crash recovery: unsaved buffers are written (debounced) while anything is
// unsaved and cleared once everything is saved. On launch the App offers to
// restore what a previous session left behind.
import type { RecoveryEntry } from '@shared/types'
import { recoveryEntries, type BufferState } from '@/lib/logic/recovery'
import type { AppHost, Patch } from './host'
import type { AppState } from './types'
import { insertTab, isDirtyIn, isUntitled, untitledId } from './model'

const RECOVERY_DELAY_MS = 5000
/** Clearing is cheap and should land quickly once the last edit is saved. */
const CLEAR_DELAY_MS = 600

export function buffersOf(s: AppState, nameOf: (id: string) => string): BufferState[] {
  return Object.keys(s.contents)
    .filter((id) => isDirtyIn(s.contents, s.saved, id))
    .map((id) => ({
      id,
      path: isUntitled(id) ? null : id,
      title: nameOf(id),
      content: s.contents[id],
      saved: s.saved[id]
    }))
}

export class RecoveryKeeper {
  private timer: ReturnType<typeof setTimeout> | null = null
  private enabled = false
  private stored = false
  private lastWrite = ''

  constructor(private readonly host: AppHost) {}

  /** Start writing (only after the launch prompt was answered, so the previous
   *  session's buffers aren't overwritten before the user decides). */
  enable(): void {
    this.enabled = true
    this.schedule()
  }

  /** Call after any change to contents/saved. */
  schedule(): void {
    if (!this.enabled) return
    const dirty = buffersOf(this.host.state(), this.host.nameOf).length > 0
    if (!dirty && !this.stored) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.write(), dirty ? RECOVERY_DELAY_MS : CLEAR_DELAY_MS)
  }

  /** Write now (window closing). */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.enabled) await this.write()
  }

  /** Forget stored buffers now (the user chose not to keep them). */
  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.lastWrite = ''
    this.stored = false
    await window.api.saveRecovery([]).catch(() => undefined)
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
  }

  private async write(): Promise<void> {
    this.timer = null
    const entries = recoveryEntries(buffersOf(this.host.state(), this.host.nameOf), Date.now())
    const key = JSON.stringify(entries.map((e) => [e.id, e.content]))
    if (key === this.lastWrite) return
    try {
      await window.api.saveRecovery(entries)
      this.lastWrite = key
      this.stored = entries.length > 0
    } catch {
      // Recovery is a safety net; the edits are still in memory. Try again on the next change.
      this.lastWrite = ''
    }
  }
}

/** State patch that reopens recovered buffers as unsaved tabs. Files keep their path
 *  (the disk text, when known, stays the saved baseline); untitled buffers get new ids. */
export function restorePatch(
  s: AppState,
  entries: readonly RecoveryEntry[],
  diskText: Record<string, string | null>
): Patch {
  let seq = s.untitledSeq
  let openTabs = s.openTabs
  const contents = { ...s.contents }
  const saved = { ...s.saved }
  for (const e of entries) {
    const disk = e.path ? (diskText[e.path] ?? null) : null
    const id = e.path && disk !== null ? e.path : untitledId(++seq)
    contents[id] = e.content
    saved[id] = e.path && disk !== null ? disk : ''
    openTabs = insertTab(openTabs, id, openTabs.length)
  }
  const first = openTabs.find((t) => contents[t] !== undefined && entries.some((e) => e.content === contents[t]))
  return { contents, saved, openTabs, untitledSeq: seq, activeId: first ?? s.activeId, recovery: null }
}
