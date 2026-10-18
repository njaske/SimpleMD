// Small stroke icons for DOM that CodeMirror builds (the fold gutter, the search panel),
// drawn like the app's React icons: 24-unit grid, round caps, currentColor.

const SVG_NS = 'http://www.w3.org/2000/svg'

export const ICON_PATHS = {
  chevronDown: ['M6 9l6 6 6-6'],
  chevronUp: ['M6 15l6-6 6 6'],
  chevronRight: ['M9 6l6 6-6 6'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  // Dashed corners around lines of text: "select every match".
  selectAll: ['M5 3a2 2 0 0 0-2 2', 'M19 3a2 2 0 0 1 2 2', 'M21 19a2 2 0 0 1-2 2', 'M5 21a2 2 0 0 1-2-2', 'M9 3h1', 'M14 3h1', 'M9 21h1', 'M14 21h1', 'M3 9v1', 'M3 14v1', 'M21 9v1', 'M21 14v1', 'M7 8h8', 'M7 12h10', 'M7 16h6']
} as const

export type IconName = keyof typeof ICON_PATHS

export function strokeIcon(name: IconName, size = 16, weight = 1.8): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const attrs: Record<string, string> = {
    viewBox: '0 0 24 24',
    width: String(size),
    height: String(size),
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': String(weight),
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  }
  Object.entries(attrs).forEach(([key, value]) => svg.setAttribute(key, value))
  ICON_PATHS[name].forEach((d) => {
    const path = document.createElementNS(SVG_NS, 'path')
    path.setAttribute('d', d)
    svg.appendChild(path)
  })
  return svg
}
