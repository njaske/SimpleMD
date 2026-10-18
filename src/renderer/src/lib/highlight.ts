import type { HLJSApi } from 'highlight.js'

// highlight.js is large and only needed once a document actually has a fenced
// code block, so it lives in its own lazily-loaded chunk.

let hljs: HLJSApi | null = null
let loading: Promise<void> | null = null
let settled = false

/** Resolves once highlight.js is available (or has failed to load — code then
 *  simply stays unhighlighted). */
export function loadHighlighter(): Promise<void> {
  if (!loading) {
    loading = import('highlight.js/lib/common')
      .then((m) => {
        hljs = m.default
        // Our code blocks hold escaped text only; don't let hljs warn about markup.
        hljs.configure({ ignoreUnescapedHTML: true })
      })
      .catch(() => {
        // chunk failed to load; render code blocks as plain text
      })
      .finally(() => {
        settled = true
      })
  }
  return loading
}

export function isHighlighterSettled(): boolean {
  return settled
}

/** The highlight.js language named by a `language-x` class, if it knows it. */
function knownLanguage(code: HTMLElement): string | null {
  const m = /(?:^|\s)language-([\w+#.-]+)/.exec(code.className)
  return m && hljs?.getLanguage(m[1]) ? m[1] : null
}

export function highlightCode(code: HTMLElement): void {
  // Unknown languages stay plain: hljs would log an error for each of them.
  if (!hljs || !knownLanguage(code)) return
  try {
    hljs.highlightElement(code)
  } catch {
    // unknown language — leave as plain text
  }
}
