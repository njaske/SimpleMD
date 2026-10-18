import DOMPurify, { type Config, type DOMPurify as Purifier } from 'dompurify'

// Every rendered document goes through DOMPurify: files opened from disk may be
// hostile. We use a private instance so our hooks (task checkboxes, style filter)
// don't leak into other users of DOMPurify (the editor's smart paste).

// Inline styles that would let a document escape its own column: cover the app
// with a fake prompt (fixed/sticky, z-index, inset) or fetch remote resources
// (url(), @import). KaTeX itself relies on relative/absolute positioning, top,
// left and sizes, so those stay allowed.
const UNSAFE_STYLE = /position\s*:\s*(fixed|sticky)|z-index|inset|url\s*\(|@import|expression\s*\(|behavior/i

// <style> would restyle the whole reader; forms and interactive elements are a
// phishing surface; media and embeds fetch or run things. <input> is handled below.
const FORBID_TAGS = [
  'style', 'form', 'button', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'label',
  'legend', 'datalist', 'output', 'meter', 'progress', 'dialog', 'video', 'audio', 'source',
  'track', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'link', 'meta',
  'template', 'slot', 'portal'
]

const CONFIG: Config = {
  // KaTeX's MathML keeps the TeX source in <semantics><annotation> (copy and export
  // use it); <annotation-xml>, which can carry HTML, stays forbidden.
  ADD_TAGS: ['semantics', 'annotation'],
  ADD_ATTR: ['target', 'rel', 'encoding'],
  FORBID_TAGS,
  FORBID_ATTR: ['autofocus', 'formaction', 'form', 'srcset', 'ping']
}

const TASK_LINE = /^\d{1,9}$/

/** Task checkboxes are the only inputs a document may contain: enabled when the
 *  renderer tagged them with their source line, disabled otherwise; every other
 *  attribute is dropped. Anything that isn't a checkbox goes. */
function cleanInput(node: Element): void {
  if ((node.getAttribute('type') || '').toLowerCase() !== 'checkbox') {
    node.remove()
    return
  }
  const line = node.getAttribute('data-task-line')
  const checked = node.hasAttribute('checked')
  for (const name of node.getAttributeNames()) node.removeAttribute(name)
  node.setAttribute('type', 'checkbox')
  node.setAttribute('class', 'smd-task')
  if (checked) node.setAttribute('checked', '')
  if (line && TASK_LINE.test(line)) node.setAttribute('data-task-line', line)
  else node.setAttribute('disabled', '')
}

let purifier: Purifier | null = null

function getPurifier(): Purifier {
  if (purifier) return purifier
  const instance = DOMPurify(window)
  instance.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'INPUT') {
      cleanInput(node)
      return
    }
    const style = node.getAttribute('style')
    if (style && UNSAFE_STYLE.test(style)) node.removeAttribute('style')
  })
  purifier = instance
  return instance
}

/** Sanitized HTML for a rendered document fragment. */
export function sanitizeHtml(html: string): string {
  return getPurifier().sanitize(html, CONFIG) as string
}
