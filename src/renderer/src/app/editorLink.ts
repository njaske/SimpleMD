// The App's side of the mounted editor: its handle (null while Read view or while
// the lazy chunk loads), focus requests made before it mounted, CodeMirror's own
// search panel, and synced scrolling with the reader in Split view.
import type { Platform } from '@shared/types'
import type { EditorHandle } from '@/lib/editor/types'
import { linkScroll, type ScrollSurface } from '@/lib/editor/syncScroll'

export class EditorLink {
  private handle: EditorHandle | null = null
  private want: 'focus' | 'search' | null = null
  private linked: EditorHandle | null = null
  private unlink: (() => void) | null = null
  private readonly reader: ScrollSurface
  private readonly platform: Platform

  constructor(reader: ScrollSurface, platform: Platform) {
    this.reader = reader
    this.platform = platform
  }

  get current(): EditorHandle | null {
    return this.handle
  }

  /** CodeEditor's onReady: a new handle on mount, null on unmount. */
  ready(handle: EditorHandle | null): void {
    this.handle = handle
    if (!handle || !this.want) return
    const want = this.want
    this.want = null
    if (want === 'search') this.openSearch()
    else handle.focus()
  }

  /** Focus the editor now, or as soon as it mounts. */
  focus(): void {
    if (this.handle) this.handle.focus()
    else this.want = 'focus'
  }

  /** CodeMirror's search panel (Mod+F in Edit view). The editor owns that key, so
   *  focus it and hand it the shortcut through its own keymap. */
  openSearch(): void {
    const handle = this.handle
    if (!handle) {
      this.want = 'search'
      return
    }
    handle.focus()
    const target = document.activeElement
    if (!target?.closest('.cm-editor')) return
    const mac = this.platform === 'darwin'
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'f',
        code: 'KeyF',
        ctrlKey: !mac,
        metaKey: mac,
        bubbles: true,
        cancelable: true
      })
    )
  }

  /** Link editor and reader scrolling while `on` (Split view with synced scrolling);
   *  re-links when the editor remounts (document switch), unlinks otherwise. */
  sync(on: boolean): void {
    const target = on ? this.handle : null
    if (target === this.linked) return
    this.unlink?.()
    this.unlink = null
    this.linked = target
    if (!target) return
    this.unlink = linkScroll(target, this.reader)
    // Start in step: the editor joins at the line the reader was showing.
    requestAnimationFrame(() => {
      const line = this.reader.getTopLine()
      if (this.linked === target && line !== null && line > 0) target.scrollToLine(line)
    })
  }

  dispose(): void {
    this.sync(false)
    this.handle = null
  }
}
