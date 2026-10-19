import type { ResolvedTheme } from '@shared/types'

// Styles for exports, which carry no app stylesheet: the self-contained HTML file
// (a <style> block, per theme) and rich clipboard HTML (inline style attributes).

export interface Palette {
  bg: string
  fg: string
  muted: string
  faint: string
  border: string
  sunken: string
  link: string
  note: string
  tip: string
  important: string
  warning: string
  caution: string
}

export const PALETTES: Record<ResolvedTheme, Palette> = {
  light: {
    bg: '#fefdfb', fg: '#1f1e1c', muted: '#5c5852', faint: '#6e6962', border: '#e4e0d8', sunken: '#f3f1ec',
    link: '#a8321f', note: '#2d6ac7', tip: '#2b7a38', important: '#7445c2', warning: '#8f5e00', caution: '#be3329'
  },
  dark: {
    bg: '#1c1b19', fg: '#ece9e4', muted: '#aba59c', faint: '#948e85', border: '#33312d', sunken: '#141312',
    link: '#f0a294', note: '#7aaef5', tip: '#6cc07a', important: '#b394f2', warning: '#ddaa48', caution: '#f08174'
  },
  sepia: {
    bg: '#f6efe1', fg: '#3b3027', muted: '#665646', faint: '#705d4a', border: '#e3d7c0', sunken: '#ede3cf',
    link: '#9a3324', note: '#2a5faf', tip: '#2a6e33', important: '#6b3fb2', warning: '#7f5300', caution: '#ad2f25'
  }
}

export interface ReadingMetrics {
  font: string
  size: string
  leading: string
  width: string
}

export const DEFAULT_METRICS: ReadingMetrics = {
  font: "'Literata Variable', Literata, Georgia, 'Times New Roman', serif",
  size: '17px',
  leading: '1.7',
  width: '720px'
}

const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
const SANS = "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
const HUES = ['note', 'tip', 'important', 'warning', 'caution'] as const

function calloutRules(p: Palette): string {
  const hues = HUES.map(
    (hue) =>
      `.smd-callout[data-hue="${hue}"]{border-left-color:${p[hue]};background:color-mix(in srgb,${p[hue]} 8%,transparent)}` +
      `.smd-callout[data-hue="${hue}"] .smd-callout-title{color:${p[hue]}}`
  ).join('')
  return (
    `.smd-callout{margin:1.4em 0;padding:.7em 1em;border-left:3px solid ${p.border};border-radius:0 10px 10px 0}` +
    `.smd-callout-title{display:flex;align-items:center;gap:.5em;font:600 .92em/1.4 ${SANS};list-style:none;cursor:pointer}` +
    '.smd-callout-title::-webkit-details-marker{display:none}.smd-callout-icon,.smd-callout-chevron{flex:none}' +
    '.smd-callout-body{margin-top:.4em}.smd-callout-body>:last-child{margin-bottom:0}' +
    'details.smd-callout[open] .smd-callout-chevron{transform:rotate(90deg)}' +
    hues
  )
}

/** The stylesheet of a standalone HTML export. */
export function standaloneCss(theme: ResolvedTheme, m: ReadingMetrics): string {
  const p = PALETTES[theme]
  return (
    `:root{color-scheme:${theme === 'dark' ? 'dark' : 'light'}}*{box-sizing:border-box}` +
    `html{background:${p.bg}}body{margin:0;background:${p.bg};color:${p.fg}}` +
    `.smd-article{max-width:${m.width};margin:0 auto;padding:56px 28px 96px;font-family:${m.font};font-size:${m.size};` +
    `line-height:${m.leading};overflow-wrap:break-word;-webkit-font-smoothing:antialiased}` +
    `h1,h2,h3,h4,h5,h6{line-height:1.25;font-weight:650;margin:1.8em 0 .6em;letter-spacing:-.01em}` +
    `h1{font-size:2em;line-height:1.2;letter-spacing:-.015em;margin-top:0}h2{font-size:1.45em}h3{font-size:1.2em}h4{font-size:1em}` +
    `p,ul,ol,dl,table,pre,blockquote,figure{margin:0 0 1em}ul,ol{padding-left:1.5em}li{margin:.3em 0}` +
    `li::marker{color:${p.faint}}.smd-task-item{list-style:none;margin-left:-1.4em}input[type=checkbox]{margin:0 .5em 0 0}` +
    `a{color:${p.link};text-underline-offset:.18em;text-decoration-thickness:1px}` +
    `blockquote{margin-left:0;padding-left:1em;border-left:3px solid ${p.border};color:${p.muted}}` +
    `hr{border:0;border-top:1px solid ${p.border};margin:2.2em 0}img,svg{max-width:100%;height:auto}` +
    `code{font-family:${MONO};font-size:.86em;background:${p.sunken};border-radius:5px;padding:.12em .36em}` +
    `pre{background:${p.sunken};border:1px solid ${p.border};border-radius:10px;padding:14px 18px;overflow:auto}` +
    `pre code{background:none;padding:0;font-size:13.5px;line-height:1.6}` +
    `table{border-collapse:separate;border-spacing:0;border:1px solid ${p.border};border-radius:10px;display:block;` +
    `overflow-x:auto;font-size:.92em}th,td{padding:.55em .9em;border-bottom:1px solid ${p.border};text-align:left}` +
    `th{background:${p.sunken};font-weight:600}tr:last-child td{border-bottom:0}.smd-nowrap{white-space:nowrap}` +
    `figure{text-align:center}figcaption{font-size:.85em;color:${p.faint};margin-top:.5em}` +
    `.smd-math{overflow-x:auto;overflow-y:hidden;margin:1.2em 0;padding:.2em 0}math[display=block]{margin:0}` +
    `sup{line-height:0}[data-footnote-ref]{text-decoration:none;font:600 .72em/1 ${SANS};padding:0 .1em}[data-footnote-backref]{text-decoration:none}.smd-mermaid{display:flex;justify-content:center;margin:1.4em 0}` +
    `.smd-footnotes{margin-top:3em;padding-top:1em;border-top:1px solid ${p.border};font-size:.88em;color:${p.muted}}` +
    `.smd-footnotes-title{font:600 .8em/1.4 ${SANS};text-transform:uppercase;letter-spacing:.06em;color:${p.faint};margin:0 0 .8em}` +
    `.smd-frontmatter{margin:0 0 2em;padding:.8em 1em;border:1px solid ${p.border};border-radius:10px;font:13px/1.5 ${SANS}}` +
    `.smd-fm-list{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:.3em 1.2em}.smd-fm-row{display:contents}` +
    `.smd-fm-key{color:${p.faint}}.smd-fm-value{margin:0}.smd-fm-chip{display:inline-block;margin:0 .3em .2em 0;` +
    `padding:0 .55em;border:1px solid ${p.border};border-radius:99px}` +
    calloutRules(p) +
    `@media print{html,body{background:#fff;color:#000}.smd-article{padding:0;max-width:none}pre,table,figure{break-inside:avoid}}`
  )
}

/** Inline styles for rich clipboard HTML (always the light palette: it lands in
 *  documents and emails). Keyed by tag name, plus a few classes. */
export function clipboardStyles(m: ReadingMetrics): Record<string, string> {
  const p = PALETTES.light
  return {
    root: `font-family:${m.font};font-size:15px;line-height:1.6;color:${p.fg}`,
    h1: 'font-size:26px;line-height:1.25;font-weight:650;margin:0 0 12px',
    h2: 'font-size:21px;line-height:1.3;font-weight:650;margin:20px 0 10px',
    h3: 'font-size:17px;line-height:1.35;font-weight:650;margin:18px 0 8px',
    h4: 'font-size:15px;font-weight:650;margin:16px 0 6px',
    p: 'margin:0 0 12px',
    ul: 'margin:0 0 12px;padding-left:24px',
    ol: 'margin:0 0 12px;padding-left:24px',
    li: 'margin:3px 0',
    a: `color:${p.link};text-decoration:underline`,
    blockquote: `margin:0 0 12px;padding:2px 0 2px 12px;border-left:3px solid ${p.border};color:${p.muted}`,
    code: `font-family:${MONO};font-size:13px;background:${p.sunken};border-radius:4px;padding:1px 4px`,
    pre: `font-family:${MONO};font-size:13px;line-height:1.55;background:${p.sunken};border:1px solid ${p.border};border-radius:8px;padding:10px 14px;white-space:pre-wrap;margin:0 0 12px`,
    table: `border-collapse:collapse;margin:0 0 12px;font-size:14px`,
    th: `border:1px solid ${p.border};background:${p.sunken};padding:6px 10px;text-align:left;font-weight:600`,
    td: `border:1px solid ${p.border};padding:6px 10px;text-align:left`,
    hr: `border:0;border-top:1px solid ${p.border};margin:18px 0`,
    img: 'max-width:100%;height:auto',
    figcaption: `font-size:13px;color:${p.faint};text-align:center`,
    callout: 'margin:0 0 12px;padding:8px 12px;border-left-style:solid;border-left-width:3px',
    calloutTitle: 'font-weight:600;margin:0 0 4px',
    footnotes: `margin-top:20px;padding-top:8px;border-top:1px solid ${p.border};font-size:13px;color:${p.muted}`
  }
}
