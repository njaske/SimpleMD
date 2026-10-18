// Images in the article. The article is built inside an inert <template>, so no
// <img> from the document is ever fetched there; each is swapped for a <figure> here:
//  - local files are read through the main process (access-checked) as data: URLs,
//  - remote http(s) images load directly, unless "Block remote images" is on: then a
//    placeholder card offers "Load images" for this document.

export interface ImageContext {
  docPath: string | null
  /** Hold back remote images (placeholder card instead). */
  blockRemote: boolean
  readImage(docPath: string, src: string): Promise<string | null>
  /** True once the DOM these images belong to has been replaced. */
  isStale(): boolean
}

export const LOAD_IMAGES_CLASS = 'smd-imgblocked-load'

// The "load images" controls and blocked placeholders we created, with the image each
// placeholder holds back. Documents can copy our class names and data-* attributes,
// so a click only counts on these and only these placeholders are ever loaded.
const loadControls = new WeakSet<Element>()
const blockedSrc = new WeakMap<Element, string>()

/** True when `target` is (inside) one of our "load images" controls. */
export function isLoadImagesControl(target: Element): boolean {
  const control = target.closest('.' + LOAD_IMAGES_CLASS + ', .smd-imgchip.smd-imgblocked')
  return !!control && loadControls.has(control)
}

const REMOTE = /^(?:https?:)?\/\//i
/** Protocol-relative URLs would resolve against file:// in the packaged app (a UNC
 *  path on Windows); they mean the web, so pin them to https. */
function normalizeRemote(src: string): string {
  return src.startsWith('//') ? 'https:' + src : src
}

/** The image an export may link a blocked placeholder to. Copies lose our WeakMap, so
 *  only the attribute is left: keep it to plain web URLs (a forged card can't smuggle
 *  a javascript: or file: link into the output). */
export function exportableSrc(el: Element): string | null {
  const src = (el.getAttribute('data-src') || '').trim()
  return /^https?:\/\//i.test(src) ? src : null
}

const INLINE = /^data:image\//i

function makeImg(src: string, alt: string, title: string): HTMLImageElement {
  const img = document.createElement('img')
  img.src = src
  img.alt = alt
  if (title) img.title = title
  img.loading = 'lazy'
  img.decoding = 'async'
  return img
}

function hostOf(src: string): string {
  try {
    return new URL(src, 'https://invalid.local').host
  } catch {
    return ''
  }
}

const IMAGE_OFF_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/>' +
  '<circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5-7.5 7.5"/><path d="m3 3 18 18"/></svg>'

function blockedCard(src: string): HTMLElement {
  const card = document.createElement('div')
  card.className = 'smd-imgblocked'
  card.dataset.src = src
  blockedSrc.set(card, src)
  const icon = document.createElement('span')
  icon.className = 'smd-imgblocked-icon'
  icon.innerHTML = IMAGE_OFF_ICON
  const text = document.createElement('span')
  text.className = 'smd-imgblocked-text'
  const title = document.createElement('strong')
  title.textContent = 'Remote image blocked'
  const host = document.createElement('span')
  host.className = 'smd-imgblocked-host'
  host.textContent = hostOf(src)
  text.append(title, host)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = LOAD_IMAGES_CLASS
  button.textContent = 'Load images'
  loadControls.add(button)
  card.append(icon, text, button)
  return card
}

function localPlaceholder(label: string): HTMLElement {
  const placeholder = document.createElement('div')
  placeholder.className = 'smd-imgph'
  const span = document.createElement('span')
  span.textContent = label
  placeholder.appendChild(span)
  return placeholder
}

interface ImageInfo {
  src: string
  alt: string
  title: string
}

function loadLocal(holder: HTMLElement, img: ImageInfo, ctx: ImageContext): void {
  if (!ctx.docPath) return
  ctx
    .readImage(ctx.docPath, img.src)
    .then((dataUrl) => {
      if (ctx.isStale() || !holder.isConnected || !dataUrl) return
      const placeholder = holder.classList.contains('smd-imgph') ? holder : holder.querySelector('.smd-imgph')
      placeholder?.replaceWith(makeImg(dataUrl, img.alt, img.title))
    })
    .catch(() => {
      // unreadable or not allowed: the placeholder with the file name stays
    })
}

/** An image that shares its line with text or other images (badges, icons) stays
 *  inline; one standing alone in its paragraph becomes a figure with a caption. */
function isInline(el: Element): boolean {
  let node: Element = el
  let host = el.parentElement
  if (host?.tagName === 'A' && host.childNodes.length === 1) {
    node = host
    host = host.parentElement
  }
  if (!host || !/^(P|LI|TD|TH|SPAN|A|STRONG|EM)$/.test(host.tagName)) return false
  return Array.from(host.childNodes).some(
    (child) => child !== node && (child.nodeType === 1 || (child.textContent || '').trim() !== '')
  )
}

function inlineImage(img: ImageInfo, ctx: ImageContext, remote: boolean): { el: HTMLElement; blocked: boolean } {
  if (INLINE.test(img.src) || (remote && !ctx.blockRemote)) return { el: makeImg(img.src, img.alt, img.title), blocked: false }
  const chip = document.createElement('span')
  chip.className = remote ? 'smd-imgchip smd-imgblocked' : 'smd-imgchip smd-imgph'
  chip.textContent = img.alt || (remote ? hostOf(img.src) : img.src) || 'image'
  if (remote) {
    chip.dataset.src = img.src
    blockedSrc.set(chip, img.src)
    chip.title = 'Remote image blocked. Click to load images'
    chip.setAttribute('role', 'button')
    chip.tabIndex = 0
    loadControls.add(chip)
  } else {
    loadLocal(chip, img, ctx)
  }
  return { el: chip, blocked: remote }
}

function figureImage(img: ImageInfo, ctx: ImageContext, remote: boolean): { el: HTMLElement; blocked: boolean } {
  const figure = document.createElement('figure')
  figure.className = 'smd-img'
  let blocked = false
  if (INLINE.test(img.src) || (remote && !ctx.blockRemote)) {
    figure.appendChild(makeImg(img.src, img.alt, img.title))
  } else if (remote) {
    figure.classList.add('is-blocked')
    figure.appendChild(blockedCard(img.src))
    blocked = true
  } else {
    // The caption already shows the alt text; the placeholder names the file.
    figure.appendChild(localPlaceholder(img.src.split(/[\\/]/).pop() || img.alt || 'image'))
    loadLocal(figure, img, ctx)
  }
  const caption = img.title || img.alt
  if (caption) {
    const figcaption = document.createElement('figcaption')
    figcaption.textContent = caption
    figure.appendChild(figcaption)
  }
  return { el: figure, blocked }
}

/** Replace every <img> under `root`. Returns how many remote images were held back. */
export function enhanceImages(root: ParentNode, ctx: ImageContext): number {
  let blocked = 0
  root.querySelectorAll('img').forEach((el) => {
    const raw = el.getAttribute('src') || ''
    const img = { src: normalizeRemote(raw.trim()), alt: el.getAttribute('alt') || '', title: el.getAttribute('title') || '' }
    const remote = REMOTE.test(img.src)
    const out = isInline(el) ? inlineImage(img, ctx, remote) : figureImage(img, ctx, remote)
    if (out.blocked) blocked++
    el.replaceWith(out.el)
  })
  return blocked
}

/** Swap every blocked placeholder we made under `root` for the real image. */
export function loadBlocked(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.smd-imgblocked').forEach((card) => {
    const src = blockedSrc.get(card)
    if (!src) return
    const figure = card.closest('figure.smd-img')
    const alt = card.classList.contains('smd-imgchip')
      ? card.textContent || ''
      : figure?.querySelector('figcaption')?.textContent || ''
    figure?.classList.remove('is-blocked')
    card.replaceWith(makeImg(src, alt, ''))
  })
}
