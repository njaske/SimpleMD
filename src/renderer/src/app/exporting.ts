// Export and copy of the rendered document: PDF, standalone HTML, rich text, print.
// Each needs the reader on screen, so Edit view switches to Read first.
import type { AppHost } from './host'
import { reason } from './host'
import { resolveTheme } from './appearance'
import { loadExport } from './lazyParts'

/** Time for the reader to mount and paint after leaving Edit view. */
const READER_SETTLE_MS = 220

export type ExportActions = ReturnType<typeof createExportActions>

export function createExportActions(host: AppHost) {
  const stem = (): string => host.nameOf(host.state().activeId ?? '').replace(/\.[^.]+$/, '') || 'document'

  /** Run `fn` once the rendered article exists. */
  const withArticle = (fn: (article: HTMLElement) => void | Promise<void>, forceRead = false): void => {
    const s = host.state()
    if (!s.activeId) return
    const run = (): void => {
      const article = host.reader.getArticle()
      if (!article) {
        host.toast('Nothing to export yet. Wait for the document to finish loading, then try again.')
        return
      }
      void fn(article)
    }
    if (s.viewMode === 'edit' || (forceRead && s.viewMode !== 'read')) {
      host.update({ viewMode: 'read' }, () => setTimeout(run, READER_SETTLE_MS))
    } else run()
  }

  const exportPdf = (): void =>
    withArticle(async () => {
      try {
        const path = await window.api.exportPdf(stem())
        if (path) host.toast('Exported PDF')
      } catch (err) {
        const why = reason(err)
        host.toast(`Couldn't export the PDF${why ? ` (${why})` : ''}. Try a different folder.`)
      }
    }, true)

  const exportHtml = (): void =>
    withArticle(async (article) => {
      try {
        const { buildStandaloneHtml } = await loadExport()
        const s = host.state()
        const html = buildStandaloneHtml(article, { title: stem(), theme: resolveTheme(s.theme, s.systemDark) })
        const path = await window.api.exportHtml(stem(), html)
        if (path) host.toast('Exported HTML')
      } catch (err) {
        const why = reason(err)
        host.toast(`Couldn't export HTML${why ? ` (${why})` : ''}. Try a different folder.`)
      }
    })

  const copyRichText = (): void =>
    withArticle(async (article) => {
      try {
        const { articleClipboardPayload } = await loadExport()
        const { html, text } = articleClipboardPayload(article)
        await window.api.writeClipboardRich(html, text)
        host.toast('Copied. Paste it into Docs, Word or an email.')
      } catch {
        host.toast("Couldn't copy the document. Try again.")
      }
    })

  const print = (): void => withArticle(() => window.print(), true)

  return { exportPdf, exportHtml, copyRichText, print }
}
