import { highlightCode } from '@/lib/highlight'

// Code blocks: syntax colours (highlight.js, when loaded) and a small toolbar with the
// language label and a copy button, shown on hover/focus. The <pre> is wrapped so the
// toolbar stays put while the code scrolls sideways; the wrapper takes over the
// block's source line attributes so it remains a line anchor.

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/>' +
  '<path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2"/></svg>'
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5.5 12.5 4 4 9-9.5"/></svg>'
const COPIED_MS = 1400

const LABELS: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  jsx: 'JSX', py: 'Python', python: 'Python', sh: 'Shell', bash: 'Bash', zsh: 'Zsh', shell: 'Shell',
  console: 'Console', ps1: 'PowerShell', powershell: 'PowerShell', json: 'JSON', yaml: 'YAML', yml: 'YAML',
  toml: 'TOML', html: 'HTML', xml: 'XML', css: 'CSS', scss: 'SCSS', sql: 'SQL', go: 'Go', rs: 'Rust',
  rust: 'Rust', java: 'Java', kt: 'Kotlin', kotlin: 'Kotlin', swift: 'Swift', c: 'C', cpp: 'C++',
  'c++': 'C++', cs: 'C#', csharp: 'C#', rb: 'Ruby', ruby: 'Ruby', php: 'PHP', md: 'Markdown',
  markdown: 'Markdown', diff: 'Diff', dockerfile: 'Dockerfile', graphql: 'GraphQL', lua: 'Lua',
  r: 'R', text: 'Text', txt: 'Text', plaintext: 'Text', math: 'Math'
}

export function languageOf(code: Element | null): string {
  const m = code ? /(?:^|\s)language-([\w+#.-]+)/.exec(code.className) : null
  return m ? m[1].toLowerCase() : ''
}

function languageLabel(lang: string): string {
  return LABELS[lang] ?? lang
}

function copyButton(pre: HTMLElement): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'smd-copy'
  button.title = 'Copy code'
  const label = document.createElement('span')
  label.textContent = 'Copy'
  const reset = (): void => {
    button.classList.remove('is-copied')
    button.setAttribute('aria-label', 'Copy code')
    button.innerHTML = COPY_ICON
    label.textContent = 'Copy'
    button.appendChild(label)
  }
  reset()
  button.addEventListener('click', () => {
    const text = pre.querySelector('code')?.textContent ?? ''
    navigator.clipboard?.writeText(text).catch(() => undefined)
    button.classList.add('is-copied')
    // The name changes with the label, so screen readers confirm the copy too.
    button.setAttribute('aria-label', 'Copied')
    button.innerHTML = CHECK_ICON
    label.textContent = 'Copied'
    button.appendChild(label)
    setTimeout(reset, COPIED_MS)
  })
  return button
}

function moveLineAttrs(from: HTMLElement, to: HTMLElement): void {
  for (const name of ['data-line', 'data-line-end']) {
    const value = from.getAttribute(name)
    if (value === null) continue
    to.setAttribute(name, value)
    from.removeAttribute(name)
  }
}

/** Code is plain text. Raw HTML inside a block (a span styled to be invisible, say)
 *  could hide part of a command from the reader while Copy still copies it, so a block
 *  keeps only its text and shows every character it will copy. */
function flattenToText(el: HTMLElement): void {
  if (el.firstElementChild) el.textContent = el.textContent ?? ''
}

/** Highlight and decorate every code block under `root`. */
export function decorateCodeBlocks(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    if (pre.parentElement?.classList.contains('smd-code')) return
    const code = pre.querySelector<HTMLElement>(':scope > code')
    flattenToText(code ?? pre)
    if (code) {
      Array.from(pre.childNodes).forEach((node) => {
        if (node !== code) node.remove()
      })
      highlightCode(code)
    }
    const lang = languageOf(code)
    const wrap = document.createElement('div')
    wrap.className = 'smd-code'
    moveLineAttrs(pre, wrap)
    const tools = document.createElement('div')
    tools.className = 'smd-code-tools'
    if (lang) {
      const tag = document.createElement('span')
      tag.className = 'smd-code-lang'
      tag.textContent = languageLabel(lang)
      tools.appendChild(tag)
    }
    tools.appendChild(copyButton(pre))
    pre.replaceWith(wrap)
    wrap.append(pre, tools)
  })
}
