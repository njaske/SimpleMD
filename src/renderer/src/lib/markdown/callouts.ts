import { Lexer, type RendererThis, type Token, type TokenizerAndRendererExtension, type Tokens } from 'marked'
import { calloutIconSvg, type CalloutIcon } from './calloutIcons'
import { escapeAttr, escapeHtml } from './escape'

// Callouts: GitHub alerts (`> [!NOTE]` … `> [!CAUTION]`) and Obsidian callouts
// (`> [!info] Custom title`, foldable `> [!faq]-` collapsed / `> [!faq]+` open).
// A block-level tokenizer claims the blockquote before marked's own one does, so the
// body is lexed as ordinary Markdown with the reference links of the whole document.

/** Colour families; each maps to the --note/--tip/... tokens (neutral uses ink). */
export type CalloutHue = 'note' | 'tip' | 'important' | 'warning' | 'caution' | 'neutral'

interface CalloutKind {
  hue: CalloutHue
  icon: CalloutIcon
  title?: string
}

const NOTE: CalloutKind = { hue: 'note', icon: 'info' }

const KINDS: Record<string, CalloutKind> = {
  note: { hue: 'note', icon: 'info' },
  info: { hue: 'note', icon: 'info' },
  todo: { hue: 'note', icon: 'todo' },
  abstract: { hue: 'note', icon: 'abstract' },
  summary: { hue: 'note', icon: 'abstract' },
  tldr: { hue: 'note', icon: 'abstract', title: 'TL;DR' },
  tip: { hue: 'tip', icon: 'tip' },
  hint: { hue: 'tip', icon: 'tip' },
  success: { hue: 'tip', icon: 'success' },
  check: { hue: 'tip', icon: 'success' },
  done: { hue: 'tip', icon: 'success' },
  important: { hue: 'important', icon: 'important' },
  example: { hue: 'important', icon: 'example' },
  question: { hue: 'warning', icon: 'question' },
  help: { hue: 'warning', icon: 'question' },
  faq: { hue: 'warning', icon: 'question', title: 'FAQ' },
  warning: { hue: 'warning', icon: 'warning' },
  attention: { hue: 'warning', icon: 'warning' },
  caution: { hue: 'caution', icon: 'caution' },
  failure: { hue: 'caution', icon: 'failure' },
  fail: { hue: 'caution', icon: 'failure' },
  missing: { hue: 'caution', icon: 'failure' },
  danger: { hue: 'caution', icon: 'danger' },
  error: { hue: 'caution', icon: 'danger' },
  bug: { hue: 'caution', icon: 'bug' },
  quote: { hue: 'neutral', icon: 'quote' },
  cite: { hue: 'neutral', icon: 'quote' }
}

/** How a callout type looks; unknown types fall back to the note style. */
export function calloutKind(type: string): CalloutKind {
  return KINDS[type.toLowerCase()] ?? NOTE
}

function defaultTitle(type: string): string {
  const kind = KINDS[type.toLowerCase()]
  if (kind?.title) return kind.title
  const words = type.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase()
}

/** The first line of a callout: `> [!type]` plus an optional fold marker and title. */
const HEAD = /^ {0,3}> ?\[!([A-Za-z][\w-]*)\]([+-]?)[ \t]*([^\n]*)(?:\n|$)/
const QUOTE_PREFIX = /^ {0,3}>[ \t]?/

export interface CalloutToken extends Tokens.Generic {
  type: 'callout'
  raw: string
  kind: string
  fold: '' | '+' | '-'
  titleTokens: Token[]
  tokens: Token[]
  /** The body source with the `>` prefixes removed (one line shorter than raw). */
  bodyText: string
}

function tokenizeCallout(lexer: Lexer, src: string): CalloutToken | undefined {
  const head = HEAD.exec(src)
  if (!head) return undefined
  // marked's own blockquote rule gives the full extent, lazy continuation lines included.
  const block = Lexer.rules.block.gfm.blockquote.exec(src)
  if (!block || block.index !== 0) return undefined
  const raw = block[0]
  const lines = raw.replace(/\n$/, '').split('\n')
  const bodyText = lines
    .slice(1)
    .map((line) => line.replace(QUOTE_PREFIX, ''))
    .join('\n')
  const token: CalloutToken = {
    type: 'callout',
    raw,
    kind: head[1],
    fold: head[2] === '+' || head[2] === '-' ? head[2] : '',
    titleTokens: [],
    tokens: [],
    bodyText
  }
  // Deferred inline lexing so reference links defined later in the file still resolve.
  lexer.inline(head[3].trim(), token.titleTokens)
  const top = lexer.state.top
  lexer.state.top = true
  lexer.blockTokens(bodyText, token.tokens)
  lexer.state.top = top
  return token
}

function renderCallout(this: RendererThis, token: Tokens.Generic): string {
  const t = token as CalloutToken
  const kind = calloutKind(t.kind)
  const title = this.parser.parseInline(t.titleTokens).trim() || escapeHtml(defaultTitle(t.kind))
  const bodyHtml = t.tokens.length ? this.parser.parse(t.tokens).trim() : ''
  const body = bodyHtml ? `<div class="smd-callout-body">${bodyHtml}</div>` : ''
  const head = `${calloutIconSvg(kind.icon)}<span class="smd-callout-label">${title}</span>`
  const attrs = `class="smd-callout" data-callout="${escapeAttr(t.kind.toLowerCase())}" data-hue="${kind.hue}"`
  if (t.fold) {
    const chevron = calloutIconSvg('chevron', 'smd-callout-chevron')
    const open = t.fold === '+' ? ' open' : ''
    return `<details ${attrs}${open}><summary class="smd-callout-title">${head}${chevron}</summary>${body}</details>\n`
  }
  return `<div ${attrs} role="note"><div class="smd-callout-title">${head}</div>${body}</div>\n`
}

export const calloutExtension: TokenizerAndRendererExtension = {
  name: 'callout',
  level: 'block',
  childTokens: ['titleTokens', 'tokens'],
  tokenizer(src: string) {
    return tokenizeCallout(this.lexer, src)
  },
  renderer: renderCallout
}

export function isCalloutToken(token: Token): token is CalloutToken {
  return token.type === 'callout'
}
