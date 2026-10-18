// The editor's look, from the app's design tokens (with fallbacks, so it reads well even
// before the tokens load). One theme serves light, sepia and dark: the vars do the work.
import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

const v = (name: string, fallback: string): string => `var(--${name}, ${fallback})`

const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
const UI = "'Inter Variable', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif"

const c = {
  bg: v('bg', '#fefdfb'),
  elev: v('bg-elev', "var(--bg, #ffffff)"),
  sunken: v('bg-sunken', 'color-mix(in oklch, var(--fg, #1f1e1c) 4%, var(--bg, #fefdfb))'),
  hover: v('bg-hover', 'color-mix(in oklch, var(--fg, #1f1e1c) 6%, transparent)'),
  active: v('bg-active', 'color-mix(in oklch, var(--fg, #1f1e1c) 10%, transparent)'),
  fg: v('fg', '#1f1e1c'),
  muted: v('fg-muted', '#5c5852'),
  faint: v('fg-faint', '#76716a'),
  border: v('border', '#ece9e3'),
  borderStrong: v('border-strong', '#dcd8d0'),
  accent: v('accent', '#c0392b'),
  accentFg: v('accent-fg', '#b0352a'),
  accentSoft: v('accent-soft', 'rgba(192, 57, 43, 0.12)'),
  sel: v('sel', 'rgba(192, 57, 43, 0.17)'),
  focus: v('focus', 'rgba(192, 57, 43, 0.55)'),
  mark: v('mark-soft', 'rgba(234, 179, 8, 0.3)'),
  // The bundled face leads so the editor never depends on what --mono happens to list.
  mono: `'JetBrains Mono Variable', ${v('mono', MONO)}`,
  ui: v('ui-font', UI),
  radiusS: v('radius-s', '6px'),
  radiusM: v('radius-m', '10px'),
  shadow: v('shadow-2', '0 10px 30px rgba(0, 0, 0, 0.12)'),
  fast: v('dur-fast', '120ms')
}

/** Width of the text column (gutter included) in Edit view; wider panes centre it. */
export const EDITOR_MEASURE = '880px'

const field = {
  height: '26px',
  padding: '0 9px',
  border: `1px solid ${c.borderStrong}`,
  borderRadius: c.radiusS,
  backgroundColor: c.sunken,
  color: c.fg,
  font: 'inherit',
  outline: 'none',
  transition: `border-color ${c.fast}, box-shadow ${c.fast}`
}

const searchPanel = {
  '.cm-panels': { backgroundColor: c.bg, color: c.fg, fontFamily: c.ui },
  '.cm-panels.cm-panels-top': { borderBottom: `1px solid ${c.border}` },
  '.cm-panels.cm-panels-bottom': { borderTop: `1px solid ${c.border}` },
  '.cm-panel.cm-search': {
    position: 'relative',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 44px 8px 12px',
    fontSize: '12.5px'
  },
  '.cm-panel.cm-search br': { display: 'block', content: '""', flexBasis: '100%', height: 0 },
  '.cm-panel.cm-search label': { display: 'inline-flex', alignItems: 'center', gap: '5px', color: c.muted, fontSize: '12px', margin: '0 4px', cursor: 'pointer' },
  '.cm-panel.cm-search input[type=checkbox]': { accentColor: c.accent, margin: 0, width: '13px', height: '13px' },
  '.cm-textfield': { ...field, minWidth: '200px', margin: 0, fontSize: '12.5px' },
  '.cm-textfield:focus': { borderColor: c.accent, boxShadow: `0 0 0 3px ${c.accentSoft}` },
  '.cm-button': {
    ...field,
    backgroundColor: c.elev,
    backgroundImage: 'none',
    margin: 0,
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer'
  },
  '.cm-button:hover': { backgroundColor: c.hover },
  '.cm-button:active': { backgroundImage: 'none', backgroundColor: c.active },
  '.cm-button:focus-visible, .cm-panel.cm-search [name=close]:focus-visible': { outline: `2px solid ${c.focus}`, outlineOffset: '1px' },
  '.cm-panel.cm-search [name=close]': {
    position: 'absolute',
    top: '8px',
    right: '10px',
    width: '26px',
    height: '26px',
    padding: 0,
    border: 'none',
    borderRadius: c.radiusS,
    background: 'transparent',
    color: c.muted,
    fontSize: '17px',
    lineHeight: '26px',
    cursor: 'pointer'
  },
  '.cm-panel.cm-search [name=close]:hover': { backgroundColor: c.hover, color: c.fg },
  '.cm-searchMatch': { backgroundColor: c.mark, borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: c.sel, outline: `1px solid ${c.accent}` },
  '.cm-selectionMatch': { backgroundColor: c.accentSoft }
}

export const editorTheme = EditorView.theme({
  '&': { height: '100%', color: c.fg, backgroundColor: c.bg, fontSize: 'var(--smd-editor-size, 14px)' },
  // The caret and active line show focus; the app's global focus ring would outline the page.
  '&.cm-focused, .cm-content:focus-visible': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: c.mono,
    lineHeight: '1.7',
    overflow: 'auto',
    fontVariantLigatures: 'none',
    // Centre the column in wide panes so lines stay a readable length.
    paddingInline: `max(0px, calc((100% - ${EDITOR_MEASURE}) / 2))`
  },
  '.cm-content': { padding: '22px 0 40vh', caretColor: c.accent },
  '.cm-line': { padding: '0 28px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: `2px solid ${c.accent}`, marginLeft: '-1px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: c.sel
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklch, currentColor 3.5%, transparent)', borderRadius: '3px' },
  '&:not(.cm-focused) .cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: c.bg, color: c.faint, border: 'none', fontVariantNumeric: 'tabular-nums' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3ch', padding: '0 8px 0 18px', opacity: 0.7, fontSize: '0.86em' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: c.muted },
  '.cm-activeLineGutter.cm-gutterElement': { opacity: 1 },
  '&:not(.cm-focused) .cm-activeLineGutter': { color: c.faint },
  '.cm-foldGutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '16px', color: c.faint, opacity: 0, transition: `opacity ${c.fast}` },
  '.cm-gutters:hover .cm-foldGutter .cm-gutterElement, .cm-foldGutter .cm-gutterElement:has(.is-folded)': { opacity: 1 },
  '.cm-foldGutter .cm-gutterElement:hover': { color: c.fg },
  '.cm-foldPlaceholder': { backgroundColor: c.sunken, border: `1px solid ${c.border}`, color: c.muted, borderRadius: '4px', padding: '0 6px', margin: '0 4px' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: c.accentSoft, outline: 'none', borderRadius: '2px' },
  '.cm-nonmatchingBracket': { backgroundColor: 'transparent', color: c.accent },
  '.cm-specialChar': { color: c.accent },
  '.cm-tooltip': { backgroundColor: c.elev, color: c.fg, border: `1px solid ${c.border}`, borderRadius: c.radiusS, boxShadow: c.shadow, fontFamily: c.ui },
  ...searchPanel
})

// Code colours mixed toward the text colour so they stay readable on paper and ink alike.
const hue = (color: string): string => `color-mix(in oklch, ${color} 72%, ${c.fg})`

// Markdown structure reads through weight and quiet markers rather than colour.
export const editorHighlight = HighlightStyle.define([
  { tag: [t.heading1, t.heading2], color: c.fg, fontWeight: '700' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6, t.heading], color: c.fg, fontWeight: '650' },
  { tag: t.processingInstruction, color: c.faint, fontWeight: '400' },
  { tag: t.strong, color: c.fg, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through', textDecorationColor: c.faint, color: c.muted },
  { tag: t.link, color: c.accentFg },
  { tag: t.url, color: c.muted, textDecoration: 'underline', textDecorationColor: c.borderStrong, textUnderlineOffset: '3px' },
  { tag: t.labelName, color: c.muted },
  { tag: t.quote, color: c.muted },
  { tag: t.contentSeparator, color: c.faint, fontWeight: '700' },
  { tag: t.atom, color: c.accentFg },
  { tag: [t.escape, t.character], color: c.muted },
  { tag: t.monospace, color: v('code-fg', 'inherit') },
  { tag: [t.comment, t.lineComment, t.blockComment], color: v('tok-com', c.faint), fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword], color: v('tok-kw', hue('#7c4ddb')), fontWeight: '500' },
  { tag: [t.string, t.special(t.string), t.regexp], color: v('tok-str', hue('#2f8a57')) },
  { tag: [t.number, t.bool, t.null], color: v('tok-num', hue('#c0620c')) },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.function(t.variableName))], color: v('tok-fn', hue('#2f66d0')) },
  { tag: [t.typeName, t.className, t.tagName, t.namespace], color: v('tok-type', hue('#b03f74')) },
  { tag: [t.attributeName, t.propertyName], color: v('tok-attr', c.muted) },
  { tag: [t.variableName, t.definition(t.variableName)], color: c.fg },
  { tag: [t.operator, t.punctuation, t.bracket, t.separator], color: v('tok-punc', c.muted) },
  { tag: t.meta, color: c.faint }
])
