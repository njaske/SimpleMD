import { holdRemoteImages } from './diagramImages'
import { imageOffIcon, loadImagesButton } from './images'
import { drawDiagram, loadMermaid, showSource, type DrawOptions, type MermaidJob, type MermaidLike } from './mermaid'

// When diagrams get drawn. Mermaid measures text in the live document, and each
// measurement forces a layout of the whole page, which in a multi-MB article is a long
// task every time. So:
//  - nothing is drawn while the reader holds the queue (a large document still
//    streaming in);
//  - diagrams near the viewport go first;
//  - in ordinary documents the rest follow one per idle slot, so they are all there
//    for export and print; in large ones they wait until they come near the viewport
//    (or drawAll(), before an export), and show their source when printed meanwhile.

export interface DiagramHooks {
  /** The reader's scroll container (decides what "near the viewport" means). */
  scroller(): HTMLElement | null
  /** A diagram was drawn (the article's height changed). `fixed`: it needed the repair. */
  onDrawn(fixed: boolean): void
}

export interface ExtractOptions extends DrawOptions {
  /** Draw these in idle time even when they're far from the viewport. */
  background: boolean
}

interface Entry {
  job: MermaidJob
  opts: DrawOptions
  background: boolean
}

/** Diagrams this close to the viewport (one screen above or below) are drawn first. */
const NEAR_VIEW = '100% 0px'
const IDLE_TIMEOUT_MS = 1500
const LOAD_FAILED = "Diagrams couldn't load, so here is this one's source."
export const PENDING_CLASS = 'is-pending'
/** The diagram's source, kept (hidden) in its container until it's drawn. */
export const SOURCE_CLASS = 'smd-mermaid-src'

function idle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS })
    else setTimeout(resolve, 16)
  })
}

/** "Images in this diagram are blocked · Load images", under a diagram that held some back. */
function heldNote(count: number): HTMLElement {
  const note = document.createElement('div')
  note.className = 'smd-mermaid-held'
  const text = document.createElement('span')
  text.textContent = count === 1 ? 'Remote image in this diagram blocked' : `${count} remote images in this diagram blocked`
  note.append(imageOffIcon(), text, loadImagesButton())
  return note
}

/** An empty diagram container in place of the ```mermaid block `pre`. */
function containerFor(pre: HTMLElement): HTMLElement {
  const container = document.createElement('div')
  container.className = 'smd-mermaid ' + PENDING_CLASS
  for (const name of ['data-line', 'data-line-end']) {
    const value = pre.getAttribute(name)
    if (value !== null) container.setAttribute(name, value)
  }
  pre.replaceWith(container)
  pre.className = SOURCE_CLASS
  pre.hidden = true
  container.appendChild(pre)
  return container
}

export class DiagramScheduler {
  private pending: Entry[] = []
  private urgent = new Set<HTMLElement>()
  private holding = false
  private running = false
  private waiters: Array<() => void> = []
  private observer: IntersectionObserver | null = null
  private observerRoot: HTMLElement | null = null
  /** Drawn diagrams that needed the quote/dash repair. */
  private fixed = new Set<HTMLElement>()
  /** Drawn diagrams that hold remote images back, to redraw on "Load images". */
  private held = new Map<HTMLElement, Entry>()
  private api: Promise<MermaidLike | null> | null = null
  private readonly hooks: DiagramHooks
  private readonly load: () => Promise<MermaidLike | null>

  constructor(hooks: DiagramHooks, load: () => Promise<MermaidLike | null> = loadMermaid) {
    this.hooks = hooks
    this.load = load
  }

  /** Swap the ```mermaid code blocks under `root` for diagram containers and queue
   *  them. Returns how many remote images they will hold back. */
  extract(root: ParentNode, opts: ExtractOptions): number {
    let held = 0
    const { background, ...draw } = opts
    root.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach((code) => {
      const pre = code.parentElement
      if (!pre) return
      const container = containerFor(pre)
      const source = code.textContent || ''
      if (draw.blockRemote) held += holdRemoteImages(source).held
      this.pending = [...this.pending, { job: { container, source }, opts: draw, background }]
      this.observe(container)
    })
    return held
  }

  /** Pause drawing (a large document is still rendering). */
  hold(): void {
    this.holding = true
  }

  /** Resume drawing. */
  release(): void {
    this.holding = false
    void this.run()
  }

  /** Draw every queued diagram now (before an export or print). */
  drawAll(): Promise<void> {
    this.pending.forEach((entry) => this.urgent.add(entry.job.container))
    const done = new Promise<void>((resolve) => this.waiters.push(resolve))
    this.holding = false
    void this.run()
    if (!this.running && !this.pending.length) this.settle()
    return done
  }

  /** Forget every queued diagram (the article was replaced). */
  reset(): void {
    this.pending = []
    this.urgent.clear()
    this.fixed.clear()
    this.held.clear()
    this.observer?.disconnect()
    this.observer = null
    this.observerRoot = null
    this.settle()
  }

  /** True when a diagram on screen only drew after the quote/dash repair. */
  hasFix(): boolean {
    return Array.from(this.fixed).some((container) => container.isConnected)
  }

  /** True while diagrams are queued or being drawn. */
  isBusy(): boolean {
    return this.running || this.pending.length > 0
  }

  /** Redraw the diagrams that held images back, this time with their images. */
  loadHeld(): void {
    const again = Array.from(this.held.values())
      .filter((entry) => entry.job.container.isConnected)
      .map((entry) => ({ ...entry, opts: { ...entry.opts, blockRemote: false } }))
    this.held.clear()
    again.forEach((entry) => this.urgent.add(entry.job.container))
    this.pending = [...again, ...this.pending]
    void this.run()
  }

  private observe(container: HTMLElement): void {
    if (typeof IntersectionObserver !== 'function') return
    const root = this.hooks.scroller()
    if (!root) return
    if (!this.observer || this.observerRoot !== root) {
      this.observer?.disconnect()
      this.observer = new IntersectionObserver(this.onIntersect, { root, rootMargin: NEAR_VIEW })
      this.observerRoot = root
    }
    this.observer.observe(container)
  }

  private onIntersect = (entries: IntersectionObserverEntry[]): void => {
    let any = false
    for (const entry of entries) {
      if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue
      this.urgent.add(entry.target)
      this.observer?.unobserve(entry.target)
      any = true
    }
    if (any) void this.run()
  }

  private async run(): Promise<void> {
    if (this.running || this.holding || !this.pending.length) return
    this.running = true
    try {
      const api = await (this.api ??= this.load())
      while (!this.holding) {
        const entry = this.takeUrgent() ?? (await this.takeWhenIdle())
        if (!entry) break
        await this.draw(api, entry)
      }
    } finally {
      this.running = false
      this.settle()
    }
  }

  /** Resolve drawAll() once nothing it asked for is left. */
  private settle(): void {
    const asked = (entry: Entry): boolean => this.urgent.has(entry.job.container) && entry.job.container.isConnected
    if (this.running || this.pending.some(asked)) return
    const waiters = this.waiters
    this.waiters = []
    waiters.forEach((resolve) => resolve())
  }

  /** Take `pick` out of the queue, dropping diagrams that left the article. */
  private take(pick: (entry: Entry) => boolean): Entry | null {
    this.pending = this.pending.filter((entry) => entry.job.container.isConnected)
    const entry = this.pending.find(pick) ?? null
    if (entry) this.pending = this.pending.filter((other) => other !== entry)
    return entry
  }

  private takeUrgent(): Entry | null {
    if (!this.urgent.size) return null
    const entry = this.take((e) => this.urgent.has(e.job.container))
    if (entry) this.urgent.delete(entry.job.container)
    else this.urgent.clear()
    return entry
  }

  private async takeWhenIdle(): Promise<Entry | null> {
    if (!this.pending.some((entry) => entry.background)) return null
    await idle()
    if (this.holding) return null
    return this.takeUrgent() ?? this.take((entry) => entry.background)
  }

  private async draw(api: MermaidLike | null, entry: Entry): Promise<void> {
    const { job, opts } = entry
    const container = job.container
    this.observer?.unobserve(container)
    if (!api) {
      showSource(job, LOAD_FAILED)
      this.hooks.onDrawn(false)
      return
    }
    let result = { fixed: false, held: 0 }
    try {
      result = await drawDiagram(api, job, opts, () => !container.isConnected)
    } catch {
      showSource(job)
    }
    if (!container.isConnected) return
    if (result.fixed) this.fixed.add(container)
    else this.fixed.delete(container)
    if (result.held) {
      this.held.set(container, entry)
      container.classList.add('has-held')
      container.append(heldNote(result.held))
    }
    this.hooks.onDrawn(result.fixed)
  }
}
