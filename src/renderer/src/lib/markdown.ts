import { mayContainCode } from './document'
import { TextCache } from './lru'
import { isHighlighterSettled, loadHighlighter } from './highlight'
import { escapeHtml } from './markdown/escape'
import { isKatexReady, isKatexSettled, loadKatex, needsKatex } from './markdown/math'
import { renderSource } from './markdown/pipeline'
import type { ChunkFootnotes } from './markdown/footnotes'
import { planDocument, PROGRESSIVE_CHARS } from './markdown/progressive'
import { sanitizeHtml } from './markdown/sanitize'

// Public entry to the Markdown renderer. The pipeline lives in lib/markdown/:
// math, callouts, footnotes, front matter, display repairs, source line mapping and
// sanitizing. Everything returned here is sanitized HTML.

export { escapeHtml }
export { headingLines } from './markdown/sourceMap'
export { normalizeDiagramSource, FIX_DIAGRAM } from './markdown/repairs'
export { PROGRESSIVE_CHARS }

export interface RenderOptions {
  /** Added to every data-line (progressive chunks after the first). Default 0. */
  lineOffset?: number
  /** Show leading YAML front matter as a properties card. Default true. */
  frontMatter?: boolean
  /** Markdown parsed after the text but not shown or mapped (shared reference links
   *  and footnote definitions). */
  appendix?: string
  /** Footnote numbering of the whole document (progressive chunks). */
  footnotes?: ChunkFootnotes | null
  /** One chunk of a progressive render: cached separately from whole documents. */
  chunk?: boolean
}

export interface RenderResult {
  /** Sanitized HTML; top-level blocks carry data-line / data-line-end. */
  html: string
  /** Display-only repairs that were applied, as short sentences ("fixed for display"). */
  fixes: string[]
}

/** Beyond this even progressive rendering is pointless; show the escaped source. */
const MAX_RENDER_CHARS = 16_000_000

// Re-parsing is the dominant cost of switching back to a document, so keep the
// sanitized HTML of a few recently viewed ones (bounded by size). Chunks of large
// documents get their own cache so one big file can't flush every small one, and so
// a growing log only re-parses its last chunk.
const docCache = new TextCache(6, 6_000_000)
const chunkCache = new TextCache(48, 8_000_000)
const FIX_SEP = '\u0001'
const HTML_SEP = '\u0000'

function cacheKey(md: string, opts: Required<RenderOptions>): string {
  // Everything that changes the output: KaTeX availability (math renders as source
  // before it loads), the line offset, front matter handling, the appendix and the
  // footnote numbering.
  const notes = opts.footnotes ? JSON.stringify(opts.footnotes) : ''
  const flags = `${isKatexReady() ? 1 : 0}${opts.frontMatter ? 1 : 0}:${opts.lineOffset}:${opts.appendix.length}:${notes.length}:`
  return flags + notes + opts.appendix + HTML_SEP + md
}

function encode(result: RenderResult): string {
  return result.fixes.join(FIX_SEP) + HTML_SEP + result.html
}

function decode(value: string): RenderResult {
  const at = value.indexOf(HTML_SEP)
  const fixes = value.slice(0, at)
  return { html: value.slice(at + 1), fixes: fixes ? fixes.split(FIX_SEP) : [] }
}

function plainSource(md: string): RenderResult {
  return { html: '<pre class="smd-source">' + escapeHtml(md) + '</pre>', fixes: [] }
}

function renderUncached(md: string, opts: Required<RenderOptions>): RenderResult {
  if (md.length > MAX_RENDER_CHARS) return plainSource(md)
  try {
    const out = renderSource(md, opts)
    return { html: sanitizeHtml(out.html), fixes: out.fixes }
  } catch {
    return { html: sanitizeHtml(plainSource(md).html), fixes: [] }
  }
}

/** Render Markdown to sanitized HTML plus the display repairs that were applied. */
export function renderMarkdown(md: string, options: RenderOptions = {}): RenderResult {
  const opts: Required<RenderOptions> = {
    lineOffset: options.lineOffset ?? 0,
    frontMatter: options.frontMatter ?? true,
    appendix: options.appendix ?? '',
    footnotes: options.footnotes ?? null,
    chunk: options.chunk ?? false
  }
  const source = md ?? ''
  const cache = opts.chunk ? chunkCache : docCache
  const key = cacheKey(source, opts)
  const cached = cache.get(key)
  if (cached !== undefined) return decode(cached)
  const result = renderUncached(source, opts)
  cache.set(key, encode(result))
  return result
}

/** Parse Markdown to sanitized HTML. Sanitizing protects against malicious content in
 *  files the user opens from disk. */
export function parseMarkdown(md: string): string {
  return renderMarkdown(md).html
}

export interface RenderChunk {
  src: string
  options: RenderOptions
}

/** True when `md` should render progressively (see planProgressive). */
export function isLargeDocument(md: string): boolean {
  return md.length > PROGRESSIVE_CHARS && md.length <= MAX_RENDER_CHARS
}

// Repaints of the same text (theme switch, "Load images", coming back to the tab)
// reuse the last plan instead of scanning a multi-MB file again.
let lastPlan: { md: string; chunks: readonly RenderChunk[] } | null = null

/** The chunks of a large document, in order; render each with renderMarkdown. */
export function planProgressive(md: string): readonly RenderChunk[] {
  if (lastPlan?.md === md) return lastPlan.chunks
  const { chunks, refDefs, footnotes } = planDocument(md)
  const appendix = [refDefs, footnotes?.defs ?? ''].filter(Boolean).join('\n\n')
  const planned = chunks.map((chunk, i) => ({
    src: chunk.src,
    options: { lineOffset: chunk.lineOffset, frontMatter: i === 0, appendix, footnotes: footnotes?.chunks[i] ?? null, chunk: true }
  }))
  lastPlan = { md, chunks: planned }
  return planned
}

/** True when two planned chunks render to the same HTML, so a repaint can keep the
 *  DOM it already built for that chunk. */
export function sameChunk(a: RenderChunk, b: RenderChunk): boolean {
  if (a === b) return true
  const x = a.options
  const y = b.options
  return (
    a.src === b.src &&
    x.lineOffset === y.lineOffset &&
    x.frontMatter === y.frontMatter &&
    x.appendix === y.appendix &&
    JSON.stringify(x.footnotes ?? null) === JSON.stringify(y.footnotes ?? null)
  )
}

/** Load whatever optional renderers (KaTeX, highlight.js) this document needs.
 *  Returns null when everything needed is already available, so the common path
 *  stays synchronous. */
export function prepareMarkdown(md: string): Promise<void> | null {
  if (md.length > MAX_RENDER_CHARS) return null
  const loads: Promise<void>[] = []
  if (!isKatexSettled() && needsKatex(md)) loads.push(loadKatex())
  if (!isHighlighterSettled() && mayContainCode(md)) loads.push(loadHighlighter())
  return loads.length ? Promise.all(loads).then(() => undefined) : null
}
