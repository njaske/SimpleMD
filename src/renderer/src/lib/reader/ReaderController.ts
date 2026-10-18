import type { ResolvedTheme, ViewMode } from '@shared/types'
import {
  FIX_DIAGRAM,
  isLargeDocument,
  planProgressive,
  prepareMarkdown,
  renderMarkdown,
  type RenderChunk
} from '@/lib/markdown'
import type { LineRange } from '@/lib/ranges'
import { lineAtOffset, measureAnchors, offsetOfLine, type Anchor } from './anchors'
import { markChanges, nextChange, unmarkChanges } from './changes'
import { decorateCodeBlocks } from './codeBlocks'
import { FindState, type FindResult } from './find'
import { activeHeading, assignHeadingIds, headingSlugs, type HeadingSlugs } from './headings'
import { enhanceImages, isLoadImagesControl, loadBlocked } from './images'
import { renderMermaid, type MermaidJob } from './mermaid'
import { labelTaskBoxes } from './tasks'

export type { LineRange, FindResult }

// Owns the rendered-document pane ("reader"): turning Markdown into the article
// DOM, the async work that follows (images, diagrams, the rest of a large file),
// clicks inside it, and the scroll/find/highlight helpers the rest of the app
// drives. The App only tells it what to show; it never touches the article DOM.

/** In split view the preview trails typing by this long (longer for huge docs). */
const LIVE_PREVIEW_DELAY_MS = 150
const LIVE_PREVIEW_DELAY_LARGE_MS = 400
const LARGE_DOC_CHARS = 200_000
/** Breathing room above a block we scroll to (heading, change, footnote). */
const SCROLL_MARGIN = 24
/** How long "follow the end" waits for the repaint it was asked before. */
const STICK_TO_END_MS = 2000
const FLASH_MS = 1200
/** Most work one idle slice of a progressive render may do. */
const SLICE_MS = 40
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
}

export interface RenderInfo {
  /** Display-only repairs ("fixed for display"), as short sentences. */
  fixes: string[]
  /** Remote images held back by "Block remote images" (0 once loaded). */
  blockedImages?: number
}

export interface ReaderCallbacks {
  readImage(docPath: string, src: string): Promise<string | null>
  /** A non-anchor link was clicked (http(s) URL or a relative path); `#anchors` scroll internally. */
  onLink(href: string): void
  /** A task checkbox was clicked. `line` is the 0-based source line of the task item. */
  onToggleTask(line: number, checked: boolean): void
  /** Called after each paint with notes about the document ("fixed for display" repairs). */
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

interface Progressive {
  gen: number
  article: HTMLElement
  queue: RenderChunk[]
  handle: number | null
}

type PendingScroll = { kind: 'end'; until: number } | { kind: 'line'; line: number } | null

interface IdleDeadlineLike {
  timeRemaining(): number
}

function onIdle(cb: (deadline: IdleDeadlineLike) => void): number {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(cb, { timeout: 50 })
  return window.setTimeout(() => cb({ timeRemaining: () => 16 }), 16)
}

function cancelIdle(handle: number): void {
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
  else clearTimeout(handle)
}

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

  private progressive: Progressive | null = null
  private slugs: HeadingSlugs = { byLine: new Map(), used: new Set(), next: new Map() }
  private fixes: string[] = []
  private blockedImages = 0
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
  private diagrams: Promise<void> = Promise.resolve()

  constructor(private readonly cb: ReaderCallbacks) {}

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
    return this.el?.querySelector<HTMLElement>('.smd-article') ?? null
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

  // ---- following a file that grows -------------------------------------------------

  /** True when the reader is scrolled to (or within a screen of) the end. */
  isNearEnd(): boolean {
    const el = this.el
    if (!el) return false
    return el.scrollHeight - el.scrollTop - el.clientHeight <= el.clientHeight
  }

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
    this.findState.invalidate()
    this.blockedImages = 0
    this.reportInfo()
  }

  dispose(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.renderTimer = null
    this.cancelProgressive()
    if (this.spyFrame !== null) cancelAnimationFrame(this.spyFrame)
    this.spyFrame = null
    this.clearFind()
    this.attach(null)
  }

  // ---- painting --------------------------------------------------------------------

  private paint(el: HTMLElement, doc: ReaderDoc): void {
    const changedFile = this.lastFile !== doc.id
    const keepLine = changedFile ? null : this.getTopLine()
    const gen = ++this.renderGen
    this.cancelProgressive()
    this.anchorCache = null
    if (!doc.id) {
      el.innerHTML = ''
      this.lastFile = null
      return
    }
    if (changedFile) this.resetForNewDocument()
    this.slugs = headingSlugs(doc.md)
    this.fixes = []
    this.blockedImages = 0

    const article = document.createElement('div')
    article.className = 'smd-article' + (changedFile ? ' smd-fade' : '')
    const chunks = isLargeDocument(doc.md) ? planProgressive(doc.md) : [{ src: doc.md, options: {} }]
    this.renderChunk(article, chunks[0], gen)
    el.replaceChildren(article)

    if (changedFile) {
      el.scrollTop = 0
      this.lastFile = doc.id
    } else if (keepLine !== null) {
      // Keep the reading position across the repaint (unless following the end).
      if (this.pendingScroll?.kind !== 'end') this.pendingScroll = { kind: 'line', line: keepLine }
    }
    if (chunks.length > 1) this.startProgressive(article, chunks.slice(1), gen)
    this.afterChunks(article, chunks.length === 1)
  }

  private resetForNewDocument(): void {
    this.changeRanges = null
    this.pendingScroll = null
    this.lastActive = undefined
    if (this.allowRemoteFor !== this.doc.id) this.allowRemoteFor = null
  }

  /** Render one chunk of Markdown and append it to `article`. */
  private renderChunk(article: HTMLElement, chunk: RenderChunk, gen: number): void {
    const { html, fixes } = renderMarkdown(chunk.src, chunk.options)
    const doc = this.doc
    // Build inside an inert <template> so <img> tags in the document are never
    // fetched (enhanceImages swaps them out); it's attached once ready.
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    const frag = tpl.content
    assignHeadingIds(frag, this.slugs)
    this.blockedImages += enhanceImages(frag, {
      docPath: doc.path,
      blockRemote: this.view.blockRemoteImages && this.allowRemoteFor !== doc.id,
      readImage: (docPath, src) => this.cb.readImage(docPath, src),
      isStale: () => this.renderGen !== gen
    })
    // Pull mermaid blocks out before decorating so they get no copy button.
    const jobs = extractDiagrams(frag)
    decorateCodeBlocks(frag)
    labelTaskBoxes(frag)
    article.appendChild(frag)
    for (const fix of fixes) if (!this.fixes.includes(fix)) this.fixes.push(fix)
    // One diagram batch at a time: mermaid's renderer is global and not re-entrant.
    if (jobs.length) this.diagrams = this.diagrams.then(() => this.drawDiagrams(jobs, gen)).catch(() => undefined)
  }

  /** Bring marks, find, scroll position and status up to date after chunks land. */
  private afterChunks(article: HTMLElement, complete: boolean): void {
    this.anchorCache = null
    if (this.changeRanges) markChanges(article, this.changeRanges)
    if (this.findState.query) {
      this.findState.refresh(article)
      const result = this.findState.result
      this.findSubs.forEach((cb) => cb(result))
    }
    this.applyPendingScroll(complete)
    this.reportInfo()
    this.scheduleSpy()
  }

  private startProgressive(article: HTMLElement, queue: RenderChunk[], gen: number): void {
    const job: Progressive = { gen, article, queue, handle: null }
    const step = (deadline: IdleDeadlineLike): void => {
      if (this.progressive !== job) return
      // At least one chunk per slice; more while there's idle time, but never long
      // enough to make a click or keystroke wait.
      const started = performance.now()
      do {
        const chunk = job.queue.shift()
        if (chunk) this.renderChunk(article, chunk, gen)
      } while (job.queue.length && deadline.timeRemaining() > 20 && performance.now() - started < SLICE_MS)
      const done = !job.queue.length
      if (done) this.progressive = null
      else job.handle = onIdle(step)
      this.afterChunks(article, done)
    }
    this.progressive = job
    job.handle = onIdle(step)
  }

  private cancelProgressive(): void {
    if (this.progressive?.handle != null) cancelIdle(this.progressive.handle)
    this.progressive = null
  }

  private async drawDiagrams(jobs: MermaidJob[], gen: number): Promise<void> {
    const fixed = await renderMermaid(jobs, this.view.theme, () => this.renderGen !== gen)
    if (this.renderGen !== gen) return
    this.anchorCache = null
    if (fixed && !this.fixes.includes(FIX_DIAGRAM)) {
      this.fixes.push(FIX_DIAGRAM)
      this.reportInfo()
    }
  }

  private reportInfo(): void {
    this.cb.onRenderInfo?.({ fixes: [...this.fixes], blockedImages: this.blockedImages })
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
      if (Date.now() > pending.until) this.pendingScroll = null
      else this.setScrollTop(el.scrollHeight)
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
    if (this.pendingScroll && !this.isNearEnd()) this.pendingScroll = null
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

/** Swap ```mermaid code blocks for empty diagram containers (drawn asynchronously). */
function extractDiagrams(root: ParentNode): MermaidJob[] {
  const jobs: MermaidJob[] = []
  root.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach((code) => {
    const pre = code.parentElement
    if (!pre) return
    const container = document.createElement('div')
    container.className = 'smd-mermaid'
    for (const name of ['data-line', 'data-line-end']) {
      const value = pre.getAttribute(name)
      if (value !== null) container.setAttribute(name, value)
    }
    pre.replaceWith(container)
    jobs.push({ container, source: code.textContent || '' })
  })
  return jobs
}
