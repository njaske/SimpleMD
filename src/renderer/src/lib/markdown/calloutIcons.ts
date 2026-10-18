// Inline SVG icons for callouts: same grammar as lib/icons.tsx (24-unit viewBox,
// 1.6 stroke, round caps) so they sit naturally next to the app's own icons. They
// inherit the callout hue through currentColor.

const PATHS = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><path d="M12 7.6v.1"/>',
  tip:
    '<path d="M9 18h6"/><path d="M10 21h4"/>' +
    '<path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  important:
    '<path d="M20 15.5a2 2 0 0 1-2 2H8.5L4 21V5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>' +
    '<path d="M12 7.5v4"/><path d="M12 14.4v.1"/>',
  warning:
    '<path d="M10.3 4.3 2.6 17.6A2 2 0 0 0 4.3 20.6h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>' +
    '<path d="M12 9.5v4"/><path d="M12 16.9v.1"/>',
  caution:
    '<path d="M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3z"/><path d="M12 8v4.5"/><path d="M12 15.9v.1"/>',
  question:
    '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6"/>' +
    '<path d="M12 16.9v.1"/>',
  success: '<circle cx="12" cy="12" r="9"/><path d="m8.2 12.3 2.6 2.6 5-5.4"/>',
  failure: '<circle cx="12" cy="12" r="9"/><path d="m9.2 9.2 5.6 5.6"/><path d="m14.8 9.2-5.6 5.6"/>',
  danger: '<path d="M13 2.8 4.5 13.4h6.4L10 21.2l8.5-10.6h-6.4z"/>',
  bug:
    '<rect x="7.5" y="7" width="9" height="13" rx="4.5"/><path d="M12 11v9"/>' +
    '<path d="M9.5 4.5 11 7"/><path d="M14.5 4.5 13 7"/><path d="M7.5 11H4"/><path d="M20 11h-3.5"/>' +
    '<path d="M7.5 16H4.5"/><path d="M19.5 16h-3"/>',
  example: '<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><path d="M4.5 6h.1"/><path d="M4.5 12h.1"/><path d="M4.5 18h.1"/>',
  quote:
    '<path d="M6 17.5c-1.5-1-2.2-2.6-2.2-4.7 0-3.3 2-5.9 5.2-6.8"/><path d="M4 12.5h4.3v5H4z"/>' +
    '<path d="M15.2 17.5c-1.5-1-2.2-2.6-2.2-4.7 0-3.3 2-5.9 5.2-6.8"/><path d="M13.2 12.5h4.3v5h-4.3z"/>',
  abstract:
    '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1"/>' +
    '<path d="M8.5 10h7"/><path d="M8.5 14h7"/><path d="M8.5 18h4"/>',
  todo: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.2 12.2 2.6 2.6 5-5.4"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>'
} as const

export type CalloutIcon = keyof typeof PATHS

export function calloutIconSvg(icon: CalloutIcon, className = 'smd-callout-icon'): string {
  return (
    `<svg class="${className}" viewBox="0 0 24 24" width="16" height="16" fill="none" ` +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ' +
    `aria-hidden="true" focusable="false">${PATHS[icon]}</svg>`
  )
}
