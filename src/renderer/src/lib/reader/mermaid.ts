import type { MermaidConfig } from 'mermaid'
import type { ResolvedTheme } from '@shared/types'
import { FIX_DIAGRAM, normalizeDiagramSource } from '@/lib/markdown'
import { holdRemoteImages, scrubDiagram } from './diagramImages'

// Mermaid diagrams: lazy-loaded, themed to match the reader, drawn in the UI font.
// A diagram that fails to parse is retried once with typographic quotes and dashes
// straightened (the usual damage from chat apps); if that works it counts as a
// display fix. With "Block remote images" on, nothing a diagram names is fetched.

export interface MermaidJob {
  container: HTMLElement
  source: string
}

export interface DrawOptions {
  theme: ResolvedTheme
  /** Hold back the remote images the diagram names (see diagramImages.ts). */
  blockRemote: boolean
}

/** The part of the Mermaid API we use (tests pass a fake). */
export interface MermaidLike {
  initialize(config: MermaidConfig): void
  parse(text: string, options: { suppressErrors: true }): Promise<unknown>
  render(id: string, text: string): Promise<{ svg: string }>
}

/** What drawing one diagram did. */
export interface DrawResult {
  /** It only parsed after the quote/dash repair. */
  fixed: boolean
  /** Remote images held back (shown as placeholders). */
  held: number
}

let seq = 0

const UI_FONT = "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
/** Mermaid's 16px default makes wide diagrams shrink to unreadable labels; 14px with
 *  tighter spacing fits most of them in the column at a readable scale. */
const FONT_SIZE = '14px'
const LAYOUT = { nodeSpacing: 40, rankSpacing: 44, padding: 12 }

function uiFont(): string {
  const root = document.querySelector('.smd-root')
  const value = root ? getComputedStyle(root).getPropertyValue('--ui-font').trim() : ''
  return value || UI_FONT
}

// Warm paper tones for sepia (mermaid has no sepia theme of its own).
const SEPIA_VARIABLES = {
  background: '#f6efe1',
  primaryColor: '#efe4cf',
  primaryTextColor: '#3b3027',
  primaryBorderColor: '#b9a27f',
  secondaryColor: '#e9dcc3',
  tertiaryColor: '#f3ead9',
  lineColor: '#8a7358',
  textColor: '#3b3027',
  mainBkg: '#efe4cf',
  nodeBorder: '#b9a27f',
  clusterBkg: '#f1e8d6',
  clusterBorder: '#d5c6ab',
  edgeLabelBackground: '#f6efe1',
  noteBkgColor: '#f3e3c0',
  noteTextColor: '#3b3027',
  noteBorderColor: '#c9b48c',
  actorBkg: '#efe4cf',
  actorBorder: '#b9a27f',
  actorTextColor: '#3b3027',
  signalColor: '#5d4c3b',
  signalTextColor: '#3b3027'
}

/** Tags a diagram's HTML labels may not contain while remote images are blocked. */
const HELD_TAGS = ['img', 'image', 'picture', 'source', 'video', 'audio', 'iframe']

export function mermaidConfig(opts: DrawOptions, fontFamily: string): MermaidConfig {
  const base: MermaidConfig = {
    startOnLoad: false,
    securityLevel: 'strict',
    fontFamily,
    logLevel: 'fatal',
    flowchart: LAYOUT,
    ...(opts.blockRemote ? { dompurifyConfig: { FORBID_TAGS: HELD_TAGS, FORBID_ATTR: ['srcset', 'background', 'poster'] } } : {})
  }
  const themeVariables = { fontFamily, fontSize: FONT_SIZE }
  if (opts.theme === 'sepia') return { ...base, theme: 'base', themeVariables: { ...SEPIA_VARIABLES, ...themeVariables } }
  return { ...base, theme: opts.theme === 'dark' ? 'dark' : 'default', themeVariables }
}

// mermaid's configuration is global: set it only when it changes.
const configured = new WeakMap<MermaidLike, string>()

function configure(mermaid: MermaidLike, opts: DrawOptions): void {
  const key = `${opts.theme}:${opts.blockRemote ? 1 : 0}`
  if (configured.get(mermaid) === key) return
  mermaid.initialize(mermaidConfig(opts, uiFont()))
  configured.set(mermaid, key)
}

/** The source to draw: the original, or its straightened form when only that parses. */
export async function pickSource(mermaid: MermaidLike, source: string): Promise<{ source: string; fixed: boolean } | null> {
  if (await mermaid.parse(source, { suppressErrors: true })) return { source, fixed: false }
  const plain = normalizeDiagramSource(source)
  if (plain !== source && (await mermaid.parse(plain, { suppressErrors: true }))) return { source: plain, fixed: true }
  return null
}

const SYNTAX_NOTE = 'This diagram has a syntax error, so here is its source.'

/** Show the diagram's source with a short note instead of a drawing. */
export function showSource(job: MermaidJob, note = SYNTAX_NOTE): void {
  job.container.className = 'smd-mermaid smd-mermaid-error'
  const text = document.createElement('div')
  text.className = 'smd-mermaid-note'
  text.textContent = note
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = job.source
  pre.appendChild(code)
  job.container.replaceChildren(text, pre)
}

/** Below this a wide diagram's labels get too small to read (14px × 0.8 ≈ 11px, the
 *  smallest UI text); it scrolls sideways instead. */
const MIN_DIAGRAM_SCALE = 0.8

/** Tell the stylesheet the diagram's natural width: it fits the column by shrinking,
 *  but never past MIN_DIAGRAM_SCALE (see .smd-mermaid in article.css). */
function sizeDiagram(container: HTMLElement): void {
  const svg = container.querySelector<SVGSVGElement>(':scope > svg')
  const natural = svg?.viewBox?.baseVal?.width || 0
  if (!svg || !natural) return
  svg.style.setProperty('--smd-diagram-width', `${Math.ceil(natural)}px`)
  svg.style.setProperty('--smd-diagram-min', `${Math.ceil(natural * MIN_DIAGRAM_SCALE)}px`)
}

/** Put the drawn SVG in place. It's parsed inert first, so while images are blocked
 *  it can be scrubbed before anything in it could load. */
function insertSvg(container: HTMLElement, svg: string, blockRemote: boolean): void {
  const tpl = document.createElement('template')
  tpl.innerHTML = svg
  if (blockRemote) scrubDiagram(tpl.content)
  container.className = 'smd-mermaid'
  container.replaceChildren(tpl.content)
  sizeDiagram(container)
  container.setAttribute('role', 'img')
  container.setAttribute('aria-label', 'Diagram')
}

const NOTHING: DrawResult = { fixed: false, held: 0 }

/** Draw one diagram into its container (unless it went stale meanwhile). */
export async function drawDiagram(
  mermaid: MermaidLike,
  job: MermaidJob,
  opts: DrawOptions,
  isStale: () => boolean
): Promise<DrawResult> {
  configure(mermaid, opts)
  const { source, held } = opts.blockRemote ? holdRemoteImages(job.source) : { source: job.source, held: 0 }
  const picked = await pickSource(mermaid, source)
  if (isStale()) return NOTHING
  if (!picked) {
    showSource(job)
    return NOTHING
  }
  const svg = (await renderSvg(mermaid, picked.source)) ?? (await renderWithoutImages(mermaid, picked.source))
  if (isStale()) return NOTHING
  if (svg === null) {
    showSource(job)
    return NOTHING
  }
  insertSvg(job.container, svg, opts.blockRemote)
  return { fixed: picked.fixed, held }
}

async function renderSvg(mermaid: MermaidLike, source: string): Promise<string | null> {
  const id = 'smd-mmd-' + ++seq
  try {
    return (await mermaid.render(id, source)).svg
  } catch {
    // mermaid leaves its scratch element behind when rendering throws
    document.getElementById('d' + id)?.remove()
    return null
  }
}

/** Mermaid fails the whole diagram when an image shape's picture can't be loaded
 *  (offline, a dead link); draw it once more with placeholders in their place. */
async function renderWithoutImages(mermaid: MermaidLike, source: string): Promise<string | null> {
  const fallback = holdRemoteImages(source)
  return fallback.held ? renderSvg(mermaid, fallback.source) : null
}

/** The Mermaid API, loaded on first use; null when its chunk can't be loaded. */
export async function loadMermaid(): Promise<MermaidLike | null> {
  try {
    const api: MermaidLike = (await import('mermaid')).default
    await document.fonts?.ready
    return api
  } catch {
    return null
  }
}

export { FIX_DIAGRAM }
