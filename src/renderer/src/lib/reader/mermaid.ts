import type { ResolvedTheme } from '@shared/types'
import { FIX_DIAGRAM, normalizeDiagramSource } from '@/lib/markdown'

// Mermaid diagrams: lazy-loaded, themed to match the reader, drawn in the UI font.
// A diagram that fails to parse is retried once with typographic quotes and dashes
// straightened (the usual damage from chat apps); if that works it counts as a
// display fix.

export interface MermaidJob {
  container: HTMLElement
  source: string
}

type MermaidApi = (typeof import('mermaid'))['default']

let seq = 0

const UI_FONT = "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"

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

function initialize(mermaid: MermaidApi, theme: ResolvedTheme): void {
  const fontFamily = uiFont()
  const base = { startOnLoad: false, securityLevel: 'strict' as const, fontFamily, logLevel: 'fatal' as const }
  if (theme === 'sepia') {
    mermaid.initialize({ ...base, theme: 'base', themeVariables: { ...SEPIA_VARIABLES, fontFamily } })
  } else {
    mermaid.initialize({ ...base, theme: theme === 'dark' ? 'dark' : 'default', themeVariables: { fontFamily } })
  }
}

/** The source to draw: the original, or its straightened form when only that parses. */
async function pickSource(mermaid: MermaidApi, source: string): Promise<{ source: string; fixed: boolean } | null> {
  if (await mermaid.parse(source, { suppressErrors: true })) return { source, fixed: false }
  const plain = normalizeDiagramSource(source)
  if (plain !== source && (await mermaid.parse(plain, { suppressErrors: true }))) return { source: plain, fixed: true }
  return null
}

function showError(job: MermaidJob): void {
  job.container.className = 'smd-mermaid smd-mermaid-error'
  const note = document.createElement('div')
  note.className = 'smd-mermaid-note'
  note.textContent = 'This diagram has a syntax error, so here is its source.'
  const pre = document.createElement('pre')
  const code = document.createElement('code')
  code.textContent = job.source
  pre.appendChild(code)
  job.container.replaceChildren(note, pre)
}

async function renderOne(mermaid: MermaidApi, job: MermaidJob, isStale: () => boolean): Promise<boolean> {
  const picked = await pickSource(mermaid, job.source)
  if (isStale() || !job.container.isConnected) return false
  if (!picked) {
    showError(job)
    return false
  }
  const id = 'smd-mmd-' + ++seq
  try {
    const { svg } = await mermaid.render(id, picked.source)
    if (isStale() || !job.container.isConnected) return false
    job.container.innerHTML = svg
    job.container.setAttribute('role', 'img')
    job.container.setAttribute('aria-label', 'Diagram')
    return picked.fixed
  } catch {
    // mermaid leaves its scratch element behind when rendering throws
    document.getElementById('d' + id)?.remove()
    showError(job)
    return false
  }
}

/** Draw the diagrams in order. Resolves to true when one needed the quote/dash repair. */
export async function renderMermaid(jobs: readonly MermaidJob[], theme: ResolvedTheme, isStale: () => boolean): Promise<boolean> {
  let mermaid: MermaidApi
  try {
    mermaid = (await import('mermaid')).default
    await document.fonts?.ready
  } catch {
    return false // mermaid chunk failed to load; leave the placeholders empty
  }
  if (isStale()) return false
  initialize(mermaid, theme)
  let fixed = false
  for (const job of jobs) {
    if (isStale()) return fixed
    if (job.container.isConnected && (await renderOne(mermaid, job, isStale))) fixed = true
  }
  return fixed
}

export { FIX_DIAGRAM }
