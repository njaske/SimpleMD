import type { ReadingFont, ResolvedTheme, ViewMode } from '@shared/types'
import { prepareMarkdown } from '@/lib/markdown'
import type { LineRange } from '@/lib/ranges'
import { lineAtOffset, measureAnchors, offsetOfLine, type Anchor } from './anchors'
import { markChanges, nextChange, unmarkChanges } from './changes'
import { FindState, type FindResult } from './find'
import { activeHeading } from './headings'
import { isLoadImagesControl, loadBlocked } from './images'
import { ArticlePainter, type PaintProgress } from './painter'

export type { LineRange, FindResult }

// Owns the rendered-document pane ("reader"): when to paint (painter.ts builds the
// article DOM and the async work that follows), clicks inside it, and the
// scroll/find/highlight helpers the rest of the app drives. The App only tells it
// what to show; it never touches the article DOM.

/** In split view the preview trails typing by this long (longer for huge docs). */
const LIVE_PREVIEW_DELAY_MS = 150
const LIVE_PREVIEW_DELAY_LARGE_MS = 400
const LARGE_DOC_CHARS = 200_000
/** Breathing room above a block we scroll to (heading, change, footnote). */
const SCROLL_MARGIN = 24
/** How long "follow the end" waits for the repaint it was asked before. */
const STICK_TO_END_MS = 2000
const FLASH_MS = 1200
/** Find-as-you-type waits this long after a keystroke in huge documents. */
const FIND_DELAY_LARGE_MS = 120

/** What to render. */
export interface ReaderDoc {
  /** Document id: an absolute path, or `untitled:<n>` for a new document. */
  id: string | null
  /** Absolute file path used to resolve relative images; null for untitled documents. */
  path: string | null
  md: string
}

/** How to render it. */
export interface ReaderView {
  mode: ViewMode
  theme: ResolvedTheme
  blockRemoteImages: boolean
  /** The reading font, so the article can fit details to it (tighter heading
   *  tracking in Sans). Changing it never repaints. */
  readingFont?: ReadingFont
}

export interface RenderInfo {
  /** Display-only repairs ("fixed for display"), as short sentences. */
  fixes: string[]
  /** Remote images held back by "Block remote images" (0 once loaded). */
  blockedImages?: number
  /** The document this describes (null when the reader is empty). */
  id?: string | null
  /** True when this report follows a paint of the document's text: once its first
   *  part is on screen, and again when the rest of a large document has landed.
   *  False for later news about the same paint (images loaded, a diagram repaired). */
  painted?: boolean
  /** False while the rest of a large document is still being rendered. */
  complete?: boolean
}

export interface ReaderCallbacks {
  readImage(docPath: string, src: string): Promise<string | null>
  /** A non-anchor link was clicked (http(s) URL or a relative path); `#anchors` scroll internally. */
  onLink(href: string): void
  /** A task checkbox was clicked. `line` is the 0-based source line of the task item. */
  onToggleTask(line: number, checked: boolean): void
  /** Called after each paint, once the document (or the first part of a large one) is
   *  on screen, with notes about it ("fixed for display" repairs, blocked images).
   *  Change highlights and scrollToEnd() called from here apply to the new text. */
  onRenderInfo?(info: RenderInfo): void
  /** Scroll spy: the heading slug currently at the top of the reader. */
  onActiveHeading?(slug: string | null): void
}

/** Identity of what the reader last painted; a render is skipped while it matches. */
interface RenderKey {
  id: string | null
  mode: ViewMode
  theme: ResolvedTheme
  blockRemoteImages: boolean
  md: string
}

type PendingScroll = { kind: 'end'; until: number } | { kind: 'line'; line: number } | null

export class ReaderController {
  private el: HTMLElement | null = null
  private renderKey: RenderKey | null = null
  // Bumped on every real repaint so async work (images, mermaid) can tell its DOM is stale.
  private renderGen = 0
  private preparing = false
  private renderTimer: ReturnType<typeof setTimeout> | null = null
  private lastFile: string | null = null
  private doc: ReaderDoc = { id: null, path: null, md: '' }
  private view: ReaderView = { mode: 'read', theme: 'light', blockRemoteImages: false }

  private allowRemoteFor: string | null = null
  private anchorCache: { gen: number; height: number; width: number; anchors: Anchor[] } | null = null
  private scrollSubs = new Set<() => void>()
  private programmaticTop: number | null = null
  private pendingScroll: PendingScroll = null
  private spyFrame: number | null = null
  private lastActive: string | null | undefined = undefined
  private changeRanges: LineRange[] | null = null
  private findState = new FindState()
  private findSubs = new Set<(result: FindResult) => void>()
  private lastInfo = ''
  private readonly painter: ArticlePainter
  private readonly cb: ReaderCallbacks

  constructor(cb: ReaderCallbacks) {
    this.cb = cb
    this.painter = new ArticlePainter({
      readImage: (docPath, src) => this.cb.readImage(docPath, src),
      scroller: () => this.el,
      onChunks: (article, progress) => this.afterChunks(article, progress, false),
      onDiagram: () => this.afterDiagram()
    })
  }

  /** Attach to (or detach from, with null) the scrollable reader element. The next
   *  update() paints it (an empty element always counts as needing a paint). */
  attach(el: HTMLElement | null): void {
    if (el === this.el) return
    if (this.el) {
      this.el.removeEventListener('click', this.onClick)
      this.el.removeEventListener('keydown', this.onKeyDown)
      this.el.removeEventListener('scroll', this.onScrollEvent)
    }
    this.el = el
    this.renderKey = null
    this.anchorCache = null
    if (el) {
      el.addEventListener('click', this.onClick)
      el.addEventListener('keydown', this.onKeyDown)
      el.addEventListener('scroll', this.onScrollEvent, { passive: true })
    }
  }

  /** Show `doc` with `view`. Cheap when nothing changed; debounced while typing in split view. */
  update(doc: ReaderDoc, view: ReaderView, force = false): void {
    this.doc = doc
    this.view = view
    const el = this.el
    if (!el) return
    if (view.readingFont) el.setAttribute('data-read-font', view.readingFont.toLowerCase())
    const { id, md } = doc
    const { mode, theme, blockRemoteImages } = view
    const last = this.renderKey
    const sameView =
      !!last &&
      last.id === id &&
      last.mode === mode &&
      last.theme === theme &&
      last.blockRemoteImages === blockRemoteImages
    const needsFill = el.childElementCount === 0
    if (!force && !needsFill && sameView && last.md === md) return

    // While typing in split view, let the preview trail the keystrokes instead
    // of re-parsing the whole document on each one.
    if (!force && !needsFill && sameView && mode === 'split') {
      if (this.renderTimer) clearTimeout(this.renderTimer)
      const delay = md.length > LARGE_DOC_CHARS ? LIVE_PREVIEW_DELAY_LARGE_MS : LIVE_PREVIEW_DELAY_MS
      this.renderTimer = setTimeout(() => {
        this.renderTimer = null
        this.update(this.doc, this.view, true)
      }, delay)
      return
    }

    // KaTeX / highlight.js load on demand; wait for them so the first paint of
    // a document that needs them is already correct.
    const pending = id ? prepareMarkdown(md) : null
    if (pending) {
      // One re-render once the chunks arrive, however many updates came meanwhile.
      if (!this.preparing) {
        this.preparing = true
        void pending.then(() => {
          this.preparing = false
          this.update(this.doc, this.view, true)
        })
      }
      return
    }

    if (this.renderTimer) {
      clearTimeout(this.renderTimer)
      this.renderTimer = null
    }
    this.renderKey = { id, mode, theme, blockRemoteImages, md }
    this.paint(el, doc)
  }

  /** Scroll so the element with this id (heading slug, footnote) is at the top. */
  scrollToId(id: string): void {
    const el = this.el
    if (!el) return
    let target: HTMLElement | null = null
    try {
      target = el.querySelector<HTMLElement>('#' + CSS.escape(id))
    } catch {
      return // invalid selector
    }
    if (!target) return
    target.closest('details:not([open])')?.setAttribute('open', '')
    el.scrollTo({ top: Math.max(0, this.offsetOf(target) - SCROLL_MARGIN), behavior: this.scrollBehavior() })
    // Footnotes and back-links are small; show where we landed.
    if (target.closest('.smd-footnotes') || target.matches('[data-footnote-ref]')) this.flash(target)
  }

  /** The rendered article, for export and copy. Null when nothing is shown. */
  getArticle(): HTMLElement | null {
    const article = this.painter.article
    return article && this.el?.contains(article) ? article : null
  }

  // ---- synced scrolling ------------------------------------------------------------

  /** The 0-based source line at the top of the reader (fractional between blocks), or null. */
  getTopLine(): number | null {
    const el = this.el
    if (!el) return null
    return lineAtOffset(this.anchors(), el.scrollTop)
  }

  /** Scroll so source line `line` (fractional allowed) sits at the top of the reader. */
  scrollToLine(line: number): void {
    const top = offsetOfLine(this.anchors(), line)
    if (top !== null) this.setScrollTop(top)
  }

  /** Subscribe to user scrolling of the reader. Returns an unsubscribe function. */
  onScroll(cb: () => void): () => void {
    this.scrollSubs.add(cb)
    return () => {
      this.scrollSubs.delete(cb)
    }
  }

  /** The reader's scrolling element, for synced wheel scrolling in Split view. */
  scrollElement(): HTMLElement | null {
    return this.el
  }

  // ---- following a file that grows -------------------------------------------------

  /** True when the reader is scrolled to (or within a screen of) the end. While the
   *  rest of a large document is still rendering, its end isn't on screen yet: only a
   *  reader that is already following the end counts as near it. */
  isNearEnd(): boolean {
    const el = this.el
    if (!el) return false
    if (this.painter.isRendering()) return this.pendingScroll?.kind === 'end'
    return nearEnd(el)
  }

  /** Scroll to the end and keep following it through the repaint in progress (or
   *  about to start) and the rest of a large document as it lands. */
  scrollToEnd(): void {
    const el = this.el
    if (!el) return
    // The growth that prompted this may paint after this call (debounce, KaTeX
    // load, idle chunks), so keep following the end through the next repaint.
    this.pendingScroll = { kind: 'end', until: Date.now() + STICK_TO_END_MS }
    this.setScrollTop(el.scrollHeight)
  }

  // ---- "what changed" highlights ---------------------------------------------------

  /** Mark the blocks covering these source line ranges as changed (cleared on the next
   *  document switch or by clearChanges). Returns how many blocks were marked. */
  showChanges(ranges: LineRange[]): number {
    this.changeRanges = ranges.length ? [...ranges] : null
    // Mark the new text, not the old one, when its repaint is merely debounced.
    if (this.renderTimer && !this.preparing) this.update(this.doc, this.view, true)
    const article = this.getArticle()
    if (!article || !this.changeRanges) return 0
    return markChanges(article, this.changeRanges)
  }

  clearChanges(): void {
    this.changeRanges = null
    const article = this.getArticle()
    if (article) unmarkChanges(article)
  }

  /** Scroll to the next marked block after the current position (wraps). False if none. */
  revealNextChange(): boolean {
    const el = this.el
    const article = this.getArticle()
    if (!el || !article) return false
    // A block we revealed sits SCROLL_MARGIN * 2 below the top; look past it.
    const target = nextChange(article, el, el.scrollTop + SCROLL_MARGIN * 2 + 2)
    if (!target) return false
    el.scrollTo({ top: Math.max(0, this.offsetOf(target) - SCROLL_MARGIN * 2), behavior: this.scrollBehavior() })
    return true
  }

  // ---- find in document ----------------------------------------------------------

  /** Highlight every match of `query` (case-insensitive) and move to the next (or
   *  previous) one. An empty query clears the highlights. */
  find(query: string, opts: { backwards?: boolean } = {}): FindResult {
    const article = this.getArticle()
    const el = this.el
    if (!article || !el || !query) {
      this.clearFind()
      return { index: 0, total: 0 }
    }
    if (query !== this.findState.query) {
      const top = el.getBoundingClientRect().top
      this.findState.search(article, query, (range) => range.getBoundingClientRect().top >= top)
    } else {
      this.findState.step(!!opts.backwards)
    }
    this.revealMatch()
    return this.findState.result
  }

  clearFind(): void {
    this.findState.clear()
  }

  /** How long the find bar should wait after a keystroke before searching: nothing for
   *  ordinary notes, a beat for huge ones so typing a word costs one search, not five. */
  findDelay(): number {
    return this.doc.md.length > LARGE_DOC_CHARS ? FIND_DELAY_LARGE_MS : 0
  }

  /** Find results changed on their own (the document repainted under an open find bar). */
  onFindResult(cb: (result: FindResult) => void): () => void {
    this.findSubs.add(cb)
    return () => {
      this.findSubs.delete(cb)
    }
  }

  // ---- remote images -------------------------------------------------------------

  /** Load the remote images that `blockRemoteImages` held back, for the current document only. */
  loadBlockedImages(): void {
    this.allowRemoteFor = this.doc.id
    const article = this.getArticle()
    if (article) loadBlocked(article)
    this.painter.imagesLoaded()
    this.findState.invalidate()
    this.reportInfo(false)
  }

  /** Get the article ready to be exported, copied or printed: the rest of a large
   *  document rendered and every diagram drawn. Resolves when it's done. */
  async prepareForExport(): Promise<void> {
    const article = this.getArticle()
    if (!article) return
    const from = this.painter.isRendering() ? 0 : Infinity
    if (this.painter.finish()) this.afterChunks(article, { complete: true, from }, false)
    await this.painter.diagrams.drawAll()
  }

  dispose(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.renderTimer = null
    this.painter.dispose()
    if (this.spyFrame !== null) cancelAnimationFrame(this.spyFrame)
    this.spyFrame = null
    this.clearFind()
    this.attach(null)
  }

  // ---- painting --------------------------------------------------------------------

  private paint(el: HTMLElement, doc: ReaderDoc): void {
    const changedFile = this.lastFile !== doc.id
    // Following the end needs no position; otherwise keep the line being read.
    const keepLine = changedFile || this.pendingScroll?.kind === 'end' ? null : this.getTopLine()
    this.renderGen++
    this.anchorCache = null
    if (!doc.id) {
      this.painter.clear(el)
      this.lastFile = null
      this.reportInfo(true)
      return
    }
    if (changedFile) this.resetForNewDocument()
    const progress = this.painter.paint(el, {
      id: doc.id,
      path: doc.path,
      md: doc.md,
      theme: this.view.theme,
      blockRemote: this.view.blockRemoteImages && this.allowRemoteFor !== doc.id,
      fresh: changedFile
    })
    if (changedFile) {
      el.scrollTop = 0
      this.lastFile = doc.id
    } else if (keepLine !== null && keepLine >= progress.from) {
      // The line being read was re-rendered: bring it back once it's there again.
      // (Above `from` the article kept its DOM, so the position never moved.)
      this.pendingScroll = { kind: 'line', line: keepLine }
    }
    const article = this.painter.article
    if (article) this.afterChunks(article, progress, true)
  }

  private resetForNewDocument(): void {
    this.changeRanges = null
    this.pendingScroll = null
    this.lastActive = undefined
    if (this.allowRemoteFor !== this.doc.id) this.allowRemoteFor = null
  }

  /** Bring marks, find, scroll position and status up to date after chunks land. */
  private afterChunks(article: HTMLElement, { complete }: PaintProgress, first: boolean): void {
    this.anchorCache = null
    if (this.changeRanges) markChanges(article, this.changeRanges)
    // Re-searching a multi-MB article on every idle slice would cost more than the
    // slice itself; the results catch up once the document is complete.
    if (this.findState.query && (first || complete)) {
      this.findState.refresh(article)
      const result = this.findState.result
      this.findSubs.forEach((cb) => cb(result))
    }
    this.applyPendingScroll(complete)
    this.scheduleSpy()
    // Last, so the App's handler (change highlights, follow the end) sees the new text.
    this.reportInfo(first || complete)
  }

  private afterDiagram(): void {
    this.anchorCache = null
    this.applyPendingScroll(!this.painter.isRendering())
    this.reportInfo(false)
  }

  /** Tell the App about the document on screen. Reports that don't follow a paint
   *  are only sent when something in them changed. */
  private reportInfo(painted: boolean): void {
    const info: RenderInfo = {
      fixes: this.painter.fixes(),
      blockedImages: this.painter.blockedImages(),
      id: this.renderKey?.id ?? null,
      painted,
      complete: !this.painter.isRendering()
    }
    const key = JSON.stringify([info.id, info.fixes, info.blockedImages, info.complete])
    if (!painted && key === this.lastInfo) return
    this.lastInfo = key
    this.cb.onRenderInfo?.(info)
  }

  // ---- scrolling -------------------------------------------------------------------

  private anchors(): Anchor[] {
    const el = this.el
    const article = this.getArticle()
    if (!el || !article) return []
    const cache = this.anchorCache
    // Layout only moves when the content height or width changes (images, diagrams,
    // window resizes), so the measured anchors stay valid until then.
    if (cache && cache.gen === this.renderGen && cache.height === el.scrollHeight && cache.width === el.clientWidth) {
      return cache.anchors
    }
    const anchors = measureAnchors(article, el)
    this.anchorCache = { gen: this.renderGen, height: el.scrollHeight, width: el.clientWidth, anchors }
    return anchors
  }

  /** Scroll without notifying onScroll subscribers (no feedback into synced scrolling). */
  private setScrollTop(top: number): void {
    const el = this.el
    if (!el) return
    const before = el.scrollTop
    el.scrollTop = Math.max(0, top)
    if (el.scrollTop !== before) this.programmaticTop = el.scrollTop
  }

  private applyPendingScroll(complete: boolean): void {
    const el = this.el
    const pending = this.pendingScroll
    if (!el || !pending) return
    if (pending.kind === 'end') {
      const now = Date.now()
      if (complete && now > pending.until) {
        this.pendingScroll = null
        return
      }
      // Keep following while the rest of the document streams in, and a moment after.
      if (!complete) this.pendingScroll = { kind: 'end', until: Math.max(pending.until, now + STICK_TO_END_MS) }
      this.setScrollTop(el.scrollHeight)
      return
    }
    const anchors = this.anchors()
    const last = anchors[anchors.length - 1]
    // A line in a chunk that hasn't rendered yet waits for it.
    if (!complete && (!last || last.end <= pending.line)) return
    this.pendingScroll = null
    this.scrollToLine(pending.line)
  }

  private onScrollEvent = (): void => {
    const el = this.el
    if (!el) return
    this.scheduleSpy()
    if (this.programmaticTop !== null && Math.abs(el.scrollTop - this.programmaticTop) <= 1) {
      this.programmaticTop = null
      return
    }
    this.programmaticTop = null
    // The user took over: stop pinning to the end or restoring a line.
    if (this.pendingScroll && !nearEnd(el)) this.pendingScroll = null
    this.scrollSubs.forEach((cb) => cb())
  }

  private scheduleSpy(): void {
    if (!this.cb.onActiveHeading || this.spyFrame !== null) return
    this.spyFrame = requestAnimationFrame(() => {
      this.spyFrame = null
      const el = this.el
      const article = this.getArticle()
      const slug = el && article ? activeHeading(article, el) : null
      if (slug === this.lastActive) return
      this.lastActive = slug
      this.cb.onActiveHeading?.(slug)
    })
  }

  private offsetOf(target: HTMLElement): number {
    const el = this.el
    if (!el) return 0
    return target.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop
  }

  private scrollBehavior(): ScrollBehavior {
    const reduce =
      !!this.el?.closest('.smd-reduce-motion') || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    return reduce ? 'auto' : 'smooth'
  }

  private flash(target: HTMLElement): void {
    target.classList.remove('smd-flash')
    // Restart the animation when the same element is flashed twice in a row.
    void target.offsetWidth
    target.classList.add('smd-flash')
    setTimeout(() => target.classList.remove('smd-flash'), FLASH_MS)
  }

  /** Bring the current find match into view (opening a folded callout around it). */
  private revealMatch(): void {
    const el = this.el
    const range = this.findState.currentRange
    if (!el || !range) return
    const holder = range.startContainer.parentElement
    let closed = holder?.closest('details:not([open])')
    while (closed) {
      closed.setAttribute('open', '')
      closed = closed.parentElement?.closest('details:not([open])') ?? null
    }
    const rect = range.getBoundingClientRect()
    const view = el.getBoundingClientRect()
    if (rect.top >= view.top + 56 && rect.bottom <= view.bottom - 32) return
    const top = el.scrollTop + rect.top - view.top - el.clientHeight / 3
    el.scrollTo({ top: Math.max(0, top), behavior: this.scrollBehavior() })
  }

  // ---- input -----------------------------------------------------------------------

  private onClick = (e: MouseEvent): void => {
    const target = e.target
    if (!(target instanceof Element)) return
    if (target instanceof HTMLInputElement && target.type === 'checkbox') {
      const line = target.getAttribute('data-task-line')
      if (line !== null && !target.disabled) this.cb.onToggleTask(Number(line), target.checked)
      return
    }
    if (isLoadImagesControl(target)) {
      e.preventDefault()
      this.loadBlockedImages()
      return
    }
    const anchor = target.closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (!href) return
    e.preventDefault()
    if (href.startsWith('#')) {
      // Footnote ids keep their percent-encoding; heading links may be encoded or not.
      const id = href.slice(1)
      const article = this.getArticle()
      const exists = !!article && Array.from(article.querySelectorAll('[id]')).some((el) => el.id === id)
      this.scrollToId(exists ? id : decodeURIComponentSafe(id))
      return
    }
    this.cb.onLink(href)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target
    if (!(target instanceof Element) || (e.key !== 'Enter' && e.key !== ' ')) return
    if (target.getAttribute('role') === 'button' && isLoadImagesControl(target)) {
      e.preventDefault()
      this.loadBlockedImages()
    }
  }
}

function decodeURIComponentSafe(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/** Within a screen of the end of what's rendered. */
function nearEnd(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= el.clientHeight
}
