// HTML escaping shared by the rendering modules.

/** Escape text for use between tags. */
export function escapeHtml(input: string): string {
  return (input || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape text for use inside a double-quoted attribute value. */
export function escapeAttr(input: string): string {
  return escapeHtml(input).replace(/"/g, '&quot;')
}
