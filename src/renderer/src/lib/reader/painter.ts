import type { ResolvedTheme } from '@shared/types'
import { FIX_DIAGRAM, isLargeDocument, planProgressive, renderMarkdown, sameChunk, type RenderChunk } from '@/lib/markdown'
import { decorateCodeBlocks } from './codeBlocks'
import { DiagramScheduler } from './diagrams'
import { assignHeadingIds, headingSlugs, reserveIds, type HeadingSlugs } from './headings'
import { enhanceImages } from './images'
import { tidyTables } from './tables'
import { labelTaskBoxes } from './tasks'

// Builds the article DOM from Markdown. Small documents render in one go; large ones
// (over 1 MB) progressively: the first chunk at once, the rest in idle time. A repaint
// of the same large document keeps the DOM of every leading chunk whose source didn't
// change, so a growing log re-renders only its end instead of the whole file (and the
// part being read doesn't flash).

export interface PaintRequest {
  id: string
  /** Absolute path for resolving relative images; null for untitled documents. */
  path: string | null
  md: string
  theme: ResolvedTheme
  /** Hold back remote images (already false once the user loaded them). */
  blockRemote: boolean
  /** A different document than the last paint: start a new article that fades in. */
  fresh: boolean
}

export interface PaintProgress {
  /** Every chunk of the document is in the article. */
  complete: boolean
  /** First source line that was (re)rendered; Infinity when everything was kept. */
  from: number
}

export interface PainterHooks {
  readImage(docPath: string, src: string): Promise<string | null>
  scroller(): HTMLElement | null
  /** Later chunks of a progressive render landed in the article. */
  onChunks(article: HTMLElement, progress: PaintProgress): void
  /** A diagram was drawn; `fixed` when it needed the quote/dash repair. */
  onDiagram(fixed: boolean): void
}

interface PaintedChunk {
  chunk: RenderChunk
  /** Its top-level nodes in the article. */
  nodes: ChildNode[]
  fixes: readonly string[]
  /** Remote images it holds back (images and diagram images). */
  blocked: number
}

interface Painted {
  id: string
  /** Rendered in chunks (over 1 MB). */
  large: boolean
  theme: ResolvedTheme
  blockRemote: boolean
  article: HTMLElement
  chunks: readonly PaintedChunk[]
}

interface IdleDeadlineLike {
  timeRemaining(): number
}

/** Most work one idle slice of a progressive render may do. */
const SLICE_MS = 40
const EMPTY_SLUGS: HeadingSlugs = { byLine: new Map(), used: new Set(), next: new Map() }

function onIdle(cb: (deadline: IdleDeadlineLike) => void): number {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(cb, { timeout: 50 })
  return window.setTimeout(() => cb({ timeRemaining: () => 16 }), 16)
}

function cancelIdle(handle: number): void {
  if (typeof cancelIdleCallback === 'function') cancelIdleCallback(handle)
  else clearTimeout(handle)
}

/** Most time one idle slot spends taking a replaced article apart. */
const TEARDOWN_MS = 12

/** Remove `old` piece by piece in idle time (it's hidden meanwhile): taking a multi-MB
 *  article out of the document in one go is a long task of its own. */
function dismantle(old: HTMLElement): void {
  onIdle(() => {
    const started = performance.now()
    while (old.lastChild && performance.now() - started < TEARDOWN_MS) old.lastChild.remove()
    if (old.lastChild) dismantle(old)
    else old.remove()
  })
}

/** Empty `el` for a new article. A large previous article is hidden and dismantled
 *  later, so switching away from a big document stays instant. */
function vacate(el: HTMLElement, previous: Painted | null): void {
  const old = previous?.article
  if (!old || old.parentNode !== el || previous.chunks.length < 2) {
    el.replaceChildren()
    return
  }
  Array.from(el.childNodes).forEach((node) => {
    if (node !== old) node.remove()
  })
  old.hidden = true
  old.removeAttribute('class')
  dismantle(old)
}

export class ArticlePainter {
  private painted: Painted | null = null
  private request: PaintRequest | null = null
  private slugs: HeadingSlugs = EMPTY_SLUGS
  private queue: { chunks: RenderChunk[]; handle: number | null } | null = null
  readonly diagrams: DiagramScheduler
  private readonly hooks: PainterHooks

  constructor(hooks: PainterHooks, diagrams?: DiagramScheduler) {
    this.hooks = hooks
    this.diagrams =
      diagrams ?? new DiagramScheduler({ scroller: () => hooks.scroller(), onDrawn: (fixed) => hooks.onDiagram(fixed) })
  }

  /** The article on screen, or null. */
  get article(): HTMLElement | null {
    return this.painted?.article ?? null
  }

  /** True while the rest of a large document is still being rendered. */
  isRendering(): boolean {
    return this.queue !== null
  }

  /** Paint `req` into `el`: the first chunk (or the whole document) now, the rest of
   *  a large document in idle time (reported through onChunks). */
  paint(el: HTMLElement, req: PaintRequest): PaintProgress {
    this.cancel()
    this.diagrams.hold()
    this.request = req
    const chunks = isLargeDocument(req.md) ? planProgressive(req.md) : [{ src: req.md, options: {} }]
    this.slugs = headingSlugs(req.md)
    const previous = this.painted
    const kept = this.keep(el, req, chunks)
    if (!kept) this.slugs = headingSlugs(req.md)
    this.painted = kept ?? this.freshArticle(req)
    const todo = chunks.slice(this.painted.chunks.length)
    if (todo.length) this.renderChunk(todo[0])
    if (!kept) {
      vacate(el, previous)
      el.prepend(this.painted.article)
    }
    const rest = todo.slice(1)
    if (rest.length) this.startQueue(rest)
    else this.diagrams.release()
    return { complete: !rest.length, from: todo[0]?.options.lineOffset ?? (todo.length ? 0 : Infinity) }
  }

  /** Empty the reader (no document). */
  clear(el: HTMLElement): void {
    this.cancel()
    this.diagrams.reset()
    vacate(el, this.painted)
    this.painted = null
    this.request = null
  }

  /** Display repairs of what's on screen, in document order. */
  fixes(): string[] {
    const out: string[] = []
    for (const chunk of this.painted?.chunks ?? []) for (const fix of chunk.fixes) if (!out.includes(fix)) out.push(fix)
    if (this.diagrams.hasFix() && !out.includes(FIX_DIAGRAM)) out.push(FIX_DIAGRAM)
    return out
  }

  /** Remote images held back in what's on screen. */
  blockedImages(): number {
    return (this.painted?.chunks ?? []).reduce((sum, chunk) => sum + chunk.blocked, 0)
  }

  /** The user loaded this document's remote images (the DOM's images are swapped
   *  by the caller); redraw the diagrams that held some back. */
  imagesLoaded(): void {
    const painted = this.painted
    if (!painted) return
    this.painted = { ...painted, blockRemote: false, chunks: painted.chunks.map((chunk) => ({ ...chunk, blocked: 0 })) }
    if (this.request) this.request = { ...this.request, blockRemote: false }
    this.diagrams.loadHeld()
  }

  /** Render whatever is left of a large document right away (an export needs all of
   *  it). True when that completed a progressive render. */
  finish(): boolean {
    const queue = this.queue
    if (!queue) return false
    this.cancel()
    queue.chunks.forEach((chunk) => this.renderChunk(chunk))
    this.diagrams.release()
    return true
  }

  /** Stop rendering the rest of a large document. */
  cancel(): void {
    if (this.queue?.handle != null) cancelIdle(this.queue.handle)
    this.queue = null
  }

  dispose(): void {
    this.cancel()
    this.diagrams.reset()
    this.painted = null
  }

  /** The previous article with its unchanged leading chunks, when this is a repaint of
   *  the same large document in the same look; null when it must start over. */
  private keep(el: HTMLElement, req: PaintRequest, chunks: readonly RenderChunk[]): Painted | null {
    const p = this.painted
    if (!p || req.fresh || chunks.length < 2 || p.article.parentNode !== el) return null
    if (p.id !== req.id || p.theme !== req.theme || p.blockRemote !== req.blockRemote) return null
    let same = 0
    while (same < p.chunks.length && same < chunks.length && sameChunk(p.chunks[same].chunk, chunks[same])) same++
    if (!same) return null
    p.chunks.slice(same).forEach((chunk) => chunk.nodes.forEach((node) => node.remove()))
    const kept = { ...p, chunks: p.chunks.slice(0, same) }
    return reserveIds(this.slugs, kept.article) ? kept : null
  }

  private freshArticle(req: PaintRequest): Painted {
    this.diagrams.reset()
    const article = document.createElement('div')
    article.className = 'smd-article' + (req.fresh ? ' smd-fade' : '')
    return { id: req.id, large: isLargeDocument(req.md), theme: req.theme, blockRemote: req.blockRemote, article, chunks: [] }
  }

  /** Render one chunk of Markdown and append it to the article. */
  private renderChunk(chunk: RenderChunk): void {
    const painted = this.painted
    const req = this.request
    if (!painted || !req) return
    const { html, fixes } = renderMarkdown(chunk.src, chunk.options)
    const article = painted.article
    // Build inside an inert <template> so <img> tags in the document are never
    // fetched (enhanceImages swaps them out); it's attached once ready.
    const tpl = document.createElement('template')
    tpl.innerHTML = html
    const frag = tpl.content
    assignHeadingIds(frag, this.slugs)
    let blocked = enhanceImages(frag, {
      docPath: req.path,
      blockRemote: req.blockRemote,
      readImage: (docPath, src) => this.hooks.readImage(docPath, src),
      isStale: () => !article.isConnected
    })
    // Pull mermaid blocks out before decorating so they get no copy button.
    blocked += this.diagrams.extract(frag, { theme: req.theme, blockRemote: req.blockRemote, background: !painted.large })
    decorateCodeBlocks(frag)
    labelTaskBoxes(frag)
    tidyTables(frag)
    const nodes = Array.from(frag.childNodes)
    article.appendChild(frag)
    this.painted = { ...painted, chunks: [...painted.chunks, { chunk, nodes, fixes, blocked }] }
  }

  private startQueue(chunks: RenderChunk[]): void {
    const job = { chunks: [...chunks], handle: null as number | null }
    const step = (deadline: IdleDeadlineLike): void => {
      if (this.queue !== job) return
      const from = job.chunks[0].options.lineOffset ?? 0
      // At least one chunk per slice; more while there's idle time, but never long
      // enough to make a click or keystroke wait.
      const started = performance.now()
      do {
        const chunk = job.chunks.shift()
        if (chunk) this.renderChunk(chunk)
      } while (job.chunks.length && deadline.timeRemaining() > 20 && performance.now() - started < SLICE_MS)
      const complete = !job.chunks.length
      if (complete) {
        this.queue = null
        this.diagrams.release()
      } else {
        job.handle = onIdle(step)
      }
      const article = this.painted?.article
      if (article) this.hooks.onChunks(article, { complete, from })
    }
    this.queue = job
    job.handle = onIdle(step)
  }
}
