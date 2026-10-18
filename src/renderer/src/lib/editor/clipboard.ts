// Reading the clipboard from editor commands (plain paste, link picking up a copied URL).
// The renderer's permission handler denies navigator.clipboard, so go through the bridge.

const CLIPBOARD_TIMEOUT_MS = 400

/** Clipboard text, or "" when it can't be read in time. Never rejects. */
export async function readClipboardText(): Promise<string> {
  const read = window.api?.readClipboardText ?? (() => navigator.clipboard.readText())
  const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), CLIPBOARD_TIMEOUT_MS))
  try {
    return await Promise.race([read(), timeout])
  } catch {
    return ''
  }
}
