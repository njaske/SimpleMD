// "Block remote images" for Mermaid. Mermaid fetches the images a diagram names while
// it lays the diagram out (image shapes `A@{ img: "https://…" }`, <img> in HTML labels,
// url() in styles), in the live document and before our sanitizer sees anything. So
// the source is rewritten first: image shapes keep their place with a local
// "image blocked" picture, other references are dropped. The drawn SVG is scrubbed as
// well, in case some other syntax slipped a reference through.

const URL_BODY = String.raw`(?:https?:)?\/\/[^\s"'<>(),}]*`
/** `img: "https://…"` (quoted or not) inside a node's `@{ … }` metadata. */
const IMG_KEY = new RegExp(String.raw`(@\{[^}]*?\bimg\s*:\s*)(["']?)${URL_BODY}\2`, 'gi')
/** An HTML <img>/<image> tag in a label that points at the web. */
const IMG_TAG = new RegExp(String.raw`<(?:img|image)\b[^>]*?\b(?:src|srcset|href)\s*=\s*(["']?)${URL_BODY}[^>]*>`, 'gi')
/** url(…), image-set(…) and @import in a style, classDef or label. */
const CSS_REF = new RegExp(
  String.raw`url\(\s*(["']?)${URL_BODY}\1\s*\)|(?:-webkit-)?(?:image-set|cross-fade|image)\(\s*(["'])${URL_BODY}|@import\s*(["'])${URL_BODY}\3`,
  'gi'
)

const GREY = '#8e887f'
/** Shown where a blocked image shape would be: a dashed frame with a crossed-out
 *  picture, in a grey that reads on every theme's diagram background. */
export const HELD_IMAGE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48" viewBox="0 0 64 48">' +
      `<rect x="1" y="1" width="62" height="46" rx="7" fill="${GREY}" fill-opacity=".12" stroke="${GREY}" stroke-dasharray="4 3"/>` +
      `<g fill="none" stroke="${GREY}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
      '<rect x="22.5" y="15.5" width="19" height="17" rx="2.5"/><path d="m41.5 28-4.5-4.5-8 8"/><path d="m20 13 24 22"/></g></svg>'
  )

export interface HeldSource {
  source: string
  /** Remote image references taken out. */
  held: number
}

/** `source` with every remote image reference replaced or removed. */
export function holdRemoteImages(source: string): HeldSource {
  let held = 0
  const out = source
    .replace(IMG_KEY, (_m, head: string, quote: string) => {
      held++
      const q = quote || '"'
      return head + q + HELD_IMAGE + q
    })
    .replace(IMG_TAG, () => {
      held++
      return ''
    })
    .replace(CSS_REF, () => {
      held++
      return 'none'
    })
  return { source: out, held }
}

/** Elements that load what their src/href names. */
const REFERRING = new Set(['img', 'image', 'feimage', 'use', 'source', 'picture'])
/** A reference into the diagram itself or to inline data: never a fetch. */
const LOCAL_REF = /^\s*(?:#|data:)/i
const FETCHING_CSS = /url\(\s*(?!["']?\s*(?:#|data:))[^)]*\)|@import[^;]*;?|(?:image-set|cross-fade|image)\(/gi

function cleanCss(css: string): string {
  return css.replace(FETCHING_CSS, 'none')
}

/** Remove anything left in a drawn diagram that would fetch: images and references
 *  that don't point into the diagram (or at a data: URL), and url()s or @imports in
 *  its styles. Returns how many elements were removed. */
export function scrubDiagram(root: ParentNode): number {
  let removed = 0
  // By local name: SVG names are case-sensitive (feImage), selectors aren't reliable there.
  Array.from(root.querySelectorAll('*')).forEach((el) => {
    if (!REFERRING.has(el.localName.toLowerCase())) return
    const ref = el.getAttribute('src') ?? el.getAttribute('href') ?? el.getAttribute('xlink:href') ?? ''
    if (LOCAL_REF.test(ref) && !el.hasAttribute('srcset')) return
    el.remove()
    removed++
  })
  root.querySelectorAll('style').forEach((el) => {
    const css = el.textContent || ''
    const clean = cleanCss(css)
    if (clean !== css) el.textContent = clean
  })
  root.querySelectorAll('[style]').forEach((el) => {
    const css = el.getAttribute('style') || ''
    const clean = cleanCss(css)
    if (clean !== css) el.setAttribute('style', clean)
  })
  return removed
}
