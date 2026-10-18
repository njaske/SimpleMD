// What the App does with the reader's callbacks and disk reloads: clickable task
// boxes (saved right away when nothing else is unsaved), the "fixed for display"
// list, "what changed" marks after a reload and following the end of a file an
// agent is writing. The diff module loads on first use so `diff` stays out of the
// startup chunk.
import type { LineRange } from '@/lib/ranges'
import type { RenderInfo } from '@/lib/reader/ReaderController'
import { toggleTaskAt } from '@/lib/reader/tasks'
import type { AppHost, DiskReload } from './host'
import { reason } from './host'
import { baseName, isUntitled, without } from './model'

export type DiffLines = (before: string, after: string) => LineRange[]

const loadChanges = (): Promise<DiffLines> => import('@/lib/logic/changes').then((m) => m.changedLineRanges)

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}

export class ReaderBridge {
  private readonly host: AppHost
  private readonly load: () => Promise<DiffLines>
  private diff: Promise<DiffLines> | null = null
  /** Text each document had when the user last saw it, while it has changes. */
  private baselines = new Map<string, string>()
  /** Latest disk text per tracked document (state may not have caught up yet). */
  private latest = new Map<string, string>()
  private ranges = new Map<string, LineRange[]>()
  /** Documents whose changes the reader has shown; they clear when the user leaves. */
  private seen = new Set<string>()
  /** Text a task-box save is about to write, per document. */
  private taskTarget = new Map<string, string>()
  private saving: Promise<void> = Promise.resolve()

  // Plain fields (no parameter properties) keep this module loadable by node:test.
  constructor(host: AppHost, load: () => Promise<DiffLines> = loadChanges) {
    this.host = host
    this.load = load
  }

  /** Warm the diff chunk (idle prefetch). */
  prefetch(): void {
    void this.diffFn().catch(() => undefined)
  }

  // ---- reader callbacks ------------------------------------------------------------

  /** After each paint of the active document. */
  onRenderInfo = (info: RenderInfo): void => {
    const s = this.host.state()
    const id = s.activeId
    if (!id || s.viewMode === 'edit') return
    if (!sameList(s.renderFixes, info.fixes)) this.host.update({ renderFixes: [...info.fixes] })
    const blocked = info.blockedImages ?? 0
    if (s.blockedImages !== blocked) this.host.update({ blockedImages: blocked })
    this.mark(id)
  }

  /** A task box was clicked in the reader. */
  onToggleTask = (line: number, checked: boolean): void => {
    const id = this.host.state().activeId
    if (!id) return
    // Decided on the freshest state: quick clicks on several boxes must all land.
    let result: { next: string; clean: boolean } | null = null
    this.host.update(
      (s) => {
        const text = s.contents[id]
        const next = text === undefined ? null : toggleTaskAt(text, line, checked)
        if (next === null || next === text) return null
        const clean = !isUntitled(id) && (text === s.saved[id] || text === this.taskTarget.get(id))
        // Claimed right away so a second click in the same batch still counts as clean.
        if (clean) this.taskTarget.set(id, next)
        result = { next, clean }
        return { contents: { ...s.contents, [id]: next } }
      },
      () => this.afterToggle(id, result)
    )
  }

  private afterToggle(id: string, result: { next: string; clean: boolean } | null): void {
    // A stale click: repaint so the box shows what the file really says.
    if (!result) return this.host.renderDoc(true)
    if (result.clean) this.queueTaskSave(id, result.next)
  }

  // ---- disk reloads ----------------------------------------------------------------

  /** Before clean documents take their disk text: measure "near the end" now, track
   *  the changes, and return what to do once the new text is in state. */
  beforeReload = (reloads: readonly DiskReload[]): (() => void) => {
    const s = this.host.state()
    const active = s.activeId
    const follow =
      !!active && s.viewMode !== 'edit' && reloads.some((r) => r.id === active) && this.host.reader.isNearEnd()
    for (const r of reloads) if (r.before !== r.after) void this.track(r)
    return () => {
      if (follow) this.host.reader.scrollToEnd()
    }
  }

  // ---- "what changed" --------------------------------------------------------------

  /** The user moved away from `id`: changes it has shown are done with. */
  left(id: string | null): void {
    if (id && this.seen.has(id)) this.forget(id)
  }

  /** The user edited `id`: line marks no longer line up, so drop them. */
  edited(id: string): void {
    if (!this.ranges.has(id) && !this.baselines.has(id)) return
    if (this.host.state().activeId === id) this.host.reader.clearChanges()
    this.forget(id)
  }

  hasChanges(id: string | null): boolean {
    return !!id && (this.host.state().changes[id] ?? 0) > 0
  }

  nextChange = (): void => {
    if (!this.host.reader.revealNextChange()) this.host.toast('No changes to show.')
  }

  dismiss = (): void => {
    const id = this.host.state().activeId
    if (!id) return
    this.host.reader.clearChanges()
    this.forget(id)
  }

  /** Scroll to the end; a growing file then keeps the reader pinned there. */
  followEnd = (): void => {
    this.host.reader.scrollToEnd()
    this.host.toast('Following the end of this file')
  }

  private diffFn(): Promise<DiffLines> {
    if (this.diff) return this.diff
    const loading = this.load()
    this.diff = loading
    // A failed chunk load can be retried with the next reload.
    loading.catch(() => {
      if (this.diff === loading) this.diff = null
    })
    return loading
  }

  private async track(r: DiskReload): Promise<void> {
    const baseline = this.baselines.get(r.id) ?? r.before
    this.baselines.set(r.id, baseline)
    this.latest.set(r.id, r.after)
    let diff: DiffLines
    try {
      diff = await this.diffFn()
    } catch {
      return // Change marks are a nicety; the reload itself already happened.
    }
    // Dismissed, or the user left the document, while the diff module loaded.
    if (this.baselines.get(r.id) !== baseline) return
    const ranges = diff(baseline, this.latest.get(r.id) ?? r.after)
    if (!ranges.length) return this.forget(r.id)
    this.ranges.set(r.id, ranges)
    this.host.update(
      (s) => ({ changes: { ...s.changes, [r.id]: ranges.length } }),
      () => {
        const s = this.host.state()
        if (s.activeId === r.id && s.viewMode !== 'edit') this.mark(r.id)
      }
    )
  }

  /** Mark the tracked ranges in the painted article and record how many blocks. */
  private mark(id: string): void {
    const ranges = this.ranges.get(id)
    if (!ranges) return
    const count = this.host.reader.showChanges(ranges)
    if (!count) return
    this.seen.add(id)
    if (this.host.state().changes[id] !== count) this.host.update((s) => ({ changes: { ...s.changes, [id]: count } }))
  }

  private forget(id: string): void {
    this.baselines.delete(id)
    this.latest.delete(id)
    this.ranges.delete(id)
    this.seen.delete(id)
    if (this.host.state().changes[id] !== undefined) this.host.update((s) => ({ changes: without(s.changes, id) }))
  }

  // ---- task saves ------------------------------------------------------------------

  /** Saves run one at a time; a newer toggle of the same file (it already claimed
   *  taskTarget) supersedes a queued one. */
  private queueTaskSave(id: string, text: string): void {
    this.saving = this.saving.then(() => this.saveTask(id, text))
  }

  private async saveTask(id: string, text: string): Promise<void> {
    if (this.taskTarget.get(id) !== text) return
    try {
      await window.api.saveFile(id, text)
      this.host.update((s) => ({ saved: { ...s.saved, [id]: text } }))
      this.host.toast('Saved')
    } catch (err) {
      const why = reason(err)
      this.host.toast(
        `Couldn't save ${baseName(id)}${why ? ` (${why})` : ''}. The change is kept as an unsaved edit.`
      )
    } finally {
      if (this.taskTarget.get(id) === text) this.taskTarget.delete(id)
    }
  }
}
