// Dropping Markdown files or a folder anywhere on the window opens them. A depth
// counter keeps the overlay steady while the pointer crosses child elements.
import type { DragEvent as ReactDragEvent } from 'react'
import type { AppHost } from './host'
import type { FileActions } from './files'

export type DropTarget = ReturnType<typeof createDropTarget>

const hasFiles = (e: ReactDragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files')

export function createDropTarget(host: AppHost, files: FileActions) {
  let depth = 0

  const reset = (): void => {
    depth = 0
    if (host.state().dragOver) host.update({ dragOver: false })
  }

  const onDragEnter = (e: ReactDragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    if (++depth === 1) host.update({ dragOver: true })
  }

  const onDragOver = (e: ReactDragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (): void => {
    if (depth === 0) return
    depth = Math.max(0, depth - 1)
    if (depth === 0) host.update({ dragOver: false })
  }

  const onDrop = async (e: ReactDragEvent): Promise<void> => {
    if (!hasFiles(e)) return
    e.preventDefault()
    reset()
    const dropped = Array.from(e.dataTransfer.files)
    if (!dropped.length) return
    try {
      const result = await window.api.resolveDrop(dropped)
      if (!result.folder && !result.files.length) host.toast('Nothing to open. Drop Markdown files or a folder.')
      else files.openResult(result)
    } catch {
      host.toast("Couldn't open what you dropped. Try Open file or Open folder instead.")
    }
  }

  return { reset, onDragEnter, onDragOver, onDragLeave, onDrop: (e: ReactDragEvent) => void onDrop(e) }
}
