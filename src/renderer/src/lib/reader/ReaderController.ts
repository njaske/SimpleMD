import type { ResolvedTheme, ViewMode } from '@shared/types'
import { parseMarkdown, prepareMarkdown } from '@/lib/markdown'
import { highlightCode } from '@/lib/highlight'
import { computeOutline } from '@/lib/document'
import type { LineRange } from '@/lib/ranges'

export type { LineRange }

// Owns the rendered-document pane ("reader"): turning Markdown into the article
// DOM, the async work that follows (images, diagrams), clicks inside it, and the
// scroll/find/highlight helpers the rest of the app drives. The App only tells it
// what to show; it never touches the article DOM itself.

/** In split view the preview trails typing by this long (longer for huge docs). */
const LIVE_PREVIEW_DELAY_MS = 150
const LIVE_PREVIEW_DELAY_LARGE_MS = 400
const LARGE_DOC_CHARS = 200_000

let mermaidSeq = 0

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


export interface FindResult {
  /** 1-based index of the current match, 0 when there is none. */
  index: number
  total: number
}

export interface ReaderCallbacks {
  readImage(docPath: string, src: string): Promise<string | null>
  /** A non-anchor link was clicked (http(s) URL or a relative path); `#anchors` scroll internally. */
  onLink(href: string): void
  /** A task checkbox was clicked. `line` is the 0-based source line of the task item. */
  onToggleTask(line: number, checked: boolean): void
  /** Called after each paint with notes about the document ("fixed for display" repairs). */
  onRenderInfo?(info: { fixes: string[] }): void
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

  constructor(private readonly cb: ReaderCallbacks) {}

  /** Attach to (or detach from, with null) the scrollable reader element. The next
   *  update() paints it (an empty element always counts as needing a paint). */
  attach(el: HTMLElement | null): void {
    if (el === this.el) return
    if (this.el) this.el.removeEventListener('click', this.onClick)
    this.el = el
    this.renderKey = null
    if (el) el.addEventListener('click', this.onClick)
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
    const myGen = ++this.renderGen
    if (!id) {
      el.innerHTML = ''
      this.lastFile = null
      return
    }
    const changedFile = this.lastFile !== id
    const html = parseMarkdown(md)
    const outline = computeOutline(md)
    // Build the article inside an inert <template> so <img> tags in the document
    // are never fetched (enhanceImages swaps them out); it's attached once ready.
    const tpl = document.createElement('template')
    tpl.innerHTML = '<div class="smd-article' + (changedFile ? ' smd-fade' : '') + '">' + html + '</div>'
    const article = tpl.content.firstElementChild as HTMLElement | null
    if (!article) return

    article.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => {
      if (outline[i]) (h as HTMLElement).id = outline[i].slug
    })
    this.enhanceImages(article, doc.path, myGen)

    // Pull mermaid blocks out before highlighting so hljs/copy buttons skip them.
    const mermaidJobs: { container: HTMLElement; source: string }[] = []
    article.querySelectorAll<HTMLElement>('pre > code.language-mermaid').forEach((code) => {
      const pre = code.parentElement
      if (!pre) return
      const container = document.createElement('div')
      container.className = 'smd-mermaid'
      pre.replaceWith(container)
      mermaidJobs.push({ container, source: code.textContent || '' })
    })

    article.querySelectorAll<HTMLElement>('pre code[class*="language-"]').forEach((code) => {
      try {
        highlightCode(code)
      } catch {
        // unknown language — leave as plain text
      }
    })
    article.querySelectorAll<HTMLElement>('pre').forEach((pre) => this.addCopyButton(pre))

    el.replaceChildren(article)
    if (mermaidJobs.length) void this.renderMermaid(mermaidJobs, myGen)
    this.cb.onRenderInfo?.({ fixes: [] })

    if (changedFile) {
      el.scrollTop = 0
      this.lastFile = id
    }
  }

  /** Scroll so the element with this id (heading slug, footnote) is at the top. */
  scrollToId(id: string): void {
    const el = this.el
    if (!el) return
    try {
      const target = el.querySelector<HTMLElement>('#' + CSS.escape(id))
      if (target) el.scrollTo({ top: Math.max(0, target.offsetTop - 16), behavior: 'smooth' })
    } catch {
      // invalid selector — ignore
    }
  }

  /** The rendered article, for export and copy. Null when nothing is shown. */
  getArticle(): HTMLElement | null {
    return this.el?.querySelector<HTMLElement>('.smd-article') ?? null
  }

  // ---- synced scrolling (CONTRACT STUBS: lane R implements) ---------------------

  /** The 0-based source line at the top of the reader (fractional between blocks), or null. */
  getTopLine(): number | null {
    return null
  }

  /** Scroll so source line `line` (fractional allowed) sits at the top of the reader. */
  scrollToLine(_line: number): void {}

  /** Subscribe to user scrolling of the reader. Returns an unsubscribe function. */
  onScroll(_cb: () => void): () => void {
    return () => {}
  }

  // ---- following a file that grows (CONTRACT STUBS: lane R implements) ----------

  /** True when the reader is scrolled to (or within a screen of) the end. */
  isNearEnd(): boolean {
    return false
  }

  scrollToEnd(): void {}

  // ---- "what changed" highlights (CONTRACT STUBS: lane R implements) ------------

  /** Mark the blocks covering these source line ranges as changed (cleared on the next
   *  document switch or by clearChanges). Returns how many blocks were marked. */
  showChanges(_ranges: LineRange[]): number {
    return 0
  }

  clearChanges(): void {}

  /** Scroll to the next marked block after the current position (wraps). False if none. */
  revealNextChange(): boolean {
    return false
  }

  // ---- find in document (CONTRACT STUBS: lane R implements) ---------------------

  /** Highlight every match of `query` (case-insensitive) and move to the next (or
   *  previous) one. An empty query clears the highlights. */
  find(_query: string, _opts: { backwards?: boolean } = {}): FindResult {
    return { index: 0, total: 0 }
  }

  clearFind(): void {}

  // ---- remote images (CONTRACT STUB: lane R implements) -------------------------

  /** Load the remote images that `blockRemoteImages` held back, for the current document only. */
  loadBlockedImages(): void {}

  dispose(): void {
    if (this.renderTimer) clearTimeout(this.renderTimer)
    this.renderTimer = null
    this.attach(null)
  }

  // ---- internals ------------------------------------------------------------------

  private onClick = (e: MouseEvent): void => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (!href) return
    e.preventDefault()
    if (href.startsWith('#')) {
      this.scrollToId(href.slice(1))
      return
    }
    this.cb.onLink(href)
  }

  private enhanceImages(article: HTMLElement, docPath: string | null, myGen: number): void {
    article.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || ''
      const alt = img.getAttribute('alt') || ''
      const remote = /^(https?:|data:)/i.test(src)
      const figure = document.createElement('figure')
      figure.className = 'smd-img'

      if (remote) {
        const real = document.createElement('img')
        real.src = src
        real.alt = alt
        figure.appendChild(real)
      } else {
        const placeholder = document.createElement('div')
        placeholder.className = 'smd-imgph'
        const span = document.createElement('span')
        span.textContent = alt || src || 'image'
        placeholder.appendChild(span)
        figure.appendChild(placeholder)
      }
      if (alt) {
        const caption = document.createElement('figcaption')
        caption.textContent = alt
        figure.appendChild(caption)
      }
      img.replaceWith(figure)

      if (!remote && docPath) {
        this.cb
          .readImage(docPath, src)
          .then((dataUrl) => {
            if (this.renderGen !== myGen || !figure.isConnected || !dataUrl) return
            const real = document.createElement('img')
            real.src = dataUrl
            real.alt = alt
            const placeholder = figure.querySelector('.smd-imgph')
            if (placeholder) placeholder.replaceWith(real)
          })
          .catch(() => {})
      }
    })
  }

  private addCopyButton(pre: HTMLElement): void {
    const button = document.createElement('button')
    button.className = 'smd-copy'
    button.type = 'button'
    button.textContent = 'Copy'
    button.addEventListener('click', () => {
      const code = pre.querySelector('code')
      const text = code ? code.innerText : ''
      navigator.clipboard?.writeText(text).catch(() => {})
      button.textContent = 'Copied'
      setTimeout(() => {
        button.textContent = 'Copy'
      }, 1200)
    })
    pre.appendChild(button)
  }

  private async renderMermaid(
    jobs: { container: HTMLElement; source: string }[],
    myGen: number
  ): Promise<void> {
    let mermaid
    try {
      mermaid = (await import('mermaid')).default
    } catch {
      return // mermaid chunk failed to load; leave placeholders empty
    }
    if (this.renderGen !== myGen) return
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: this.view.theme === 'dark' ? 'dark' : 'default',
      fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif"
    })
    for (const job of jobs) {
      if (this.renderGen !== myGen) return
      if (!job.container.isConnected) continue
      try {
        const { svg } = await mermaid.render('smd-mmd-' + ++mermaidSeq, job.source)
        if (this.renderGen !== myGen || !job.container.isConnected) return
        job.container.innerHTML = svg
      } catch {
        // Invalid diagram — fall back to showing the source with a small note.
        job.container.className = 'smd-mermaid smd-mermaid-error'
        const note = document.createElement('div')
        note.className = 'smd-mermaid-note'
        note.textContent = 'Could not render this diagram'
        const pre = document.createElement('pre')
        const code = document.createElement('code')
        code.textContent = job.source
        pre.appendChild(code)
        job.container.replaceChildren(note, pre)
      }
    }
  }
}
