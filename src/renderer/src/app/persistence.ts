// Settings persistence: the snapshot of state the main process stores, written
// coalesced after changes and flushed on close so nothing is lost.
import type { Settings } from '@shared/types'
import type { AppState } from './types'
import { isUntitled } from './model'

/** Settings writes are coalesced for this long after the last change. */
const PERSIST_DELAY_MS = 400

export function settingsSnapshot(s: AppState): Partial<Settings> {
  const tabs = s.openTabs.filter((id) => !isUntitled(id))
  return {
    theme: s.theme,
    accent: s.accent,
    readingFont: s.readingFont,
    readingWidth: s.readingWidth,
    readingSize: s.readingSize,
    lineHeight: s.lineHeight,
    uiScale: s.uiScale,
    reduceMotion: s.reduceMotion,
    syncScroll: s.syncScroll,
    blockRemoteImages: s.blockRemoteImages,
    showStatusBar: s.showStatusBar,
    activity: s.activity,
    sidebarOpen: s.sidebarOpen,
    outlineOpen: s.outlineOpen,
    viewMode: s.viewMode,
    pinned: s.pinned,
    recents: s.recents,
    openTabs: tabs,
    // Untitled documents live in crash recovery, never in settings.
    activeId: s.activeId && !isUntitled(s.activeId) ? s.activeId : (tabs[0] ?? null),
    looseFiles: s.looseFiles.map((f) => f.path)
  }
}

export class SettingsWriter {
  private timer: ReturnType<typeof setTimeout> | null = null
  private last = ''
  private pending: Partial<Settings> | null = null

  constructor(private readonly write: (s: Partial<Settings>) => Promise<unknown>) {}

  /** Queue a write when the snapshot differs from the last one written. */
  persist(snapshot: Partial<Settings>): void {
    const key = JSON.stringify(snapshot)
    if (key === this.last) return
    this.last = key
    this.pending = snapshot
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), PERSIST_DELAY_MS)
  }

  flush = (): void => {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const s = this.pending
    this.pending = null
    // A failed write is retried with the next change; nothing to tell the user.
    if (s) void this.write(s).catch(() => undefined)
  }
}
