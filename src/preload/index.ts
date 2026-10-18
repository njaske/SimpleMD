import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Api,
  DropResult,
  FolderScan,
  OpenedFile,
  Platform,
  RecoveryEntry,
  Settings
} from '../shared/types'

const platform: Platform =
  process.platform === 'darwin' || process.platform === 'linux' ? process.platform : 'win32'

const api: Api = {
  platform,
  openFolder: () => ipcRenderer.invoke('dialog:openFolder') as Promise<FolderScan | null>,
  openFiles: () => ipcRenderer.invoke('dialog:openFiles') as Promise<OpenedFile[] | null>,
  openRecentFolder: (path) =>
    ipcRenderer.invoke('fs:openRecentFolder', path) as Promise<FolderScan | null>,
  takeLaunchFiles: () => ipcRenderer.invoke('app:takeLaunchFiles') as Promise<DropResult | null>,
  onOpenPaths: (cb) => {
    const handler = (_event: Electron.IpcRendererEvent, result: DropResult): void => cb(result)
    ipcRenderer.on('app:open-paths', handler)
    return () => ipcRenderer.removeListener('app:open-paths', handler)
  },
  // Paths come from webUtils here, never from the page, so a compromised renderer
  // cannot grant itself access to arbitrary paths through a fake drop.
  resolveDrop: (files) =>
    ipcRenderer.invoke(
      'fs:resolveDrop',
      files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
    ) as Promise<DropResult>,
  scanFolder: (path) => ipcRenderer.invoke('fs:scanFolder', path) as Promise<FolderScan | null>,
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path) as Promise<string>,
  saveFile: (path, content) => ipcRenderer.invoke('fs:saveFile', path, content) as Promise<boolean>,
  readImage: (docPath, src) =>
    ipcRenderer.invoke('fs:readImage', docPath, src) as Promise<string | null>,
  createFile: (dir, name, content) =>
    ipcRenderer.invoke('fs:createFile', dir, name, content) as Promise<OpenedFile>,
  createFolder: (parent, name) =>
    ipcRenderer.invoke('fs:createFolder', parent, name) as Promise<string>,
  renamePath: (path, newName) =>
    ipcRenderer.invoke('fs:renamePath', path, newName) as Promise<string>,
  duplicateFile: (path) => ipcRenderer.invoke('fs:duplicateFile', path) as Promise<OpenedFile>,
  saveAs: (defaultName, content) =>
    ipcRenderer.invoke('dialog:saveAs', defaultName, content) as Promise<string | null>,
  writeAsset: (docPath, fileName, data) =>
    ipcRenderer.invoke('fs:writeAsset', docPath, fileName, data) as Promise<string>,
  exportHtml: (defaultName, html) =>
    ipcRenderer.invoke('export:html', defaultName, html) as Promise<string | false>,
  exportPdf: (defaultName) => ipcRenderer.invoke('export:pdf', defaultName) as Promise<string | false>,
  readClipboardText: () => ipcRenderer.invoke('clipboard:readText') as Promise<string>,
  writeClipboardRich: (html, text) =>
    ipcRenderer.invoke('clipboard:writeRich', html, text) as Promise<void>,
  saveRecovery: (entries) => ipcRenderer.invoke('recovery:save', entries) as Promise<void>,
  loadRecovery: () => ipcRenderer.invoke('recovery:load') as Promise<RecoveryEntry[]>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial) as Promise<Settings>,
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url) as Promise<void>,
  trashItem: (path) => ipcRenderer.invoke('shell:trashItem', path) as Promise<boolean>,
  revealItem: (path) => ipcRenderer.invoke('shell:revealItem', path) as Promise<void>,
  setUnsaved: (hasUnsaved) => ipcRenderer.invoke('win:setUnsaved', hasUnsaved) as Promise<void>,
  onFolderChanged: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('folder:changed', handler)
    return () => ipcRenderer.removeListener('folder:changed', handler)
  },
  onRequestClose: (cb) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:request-close', handler)
    return () => ipcRenderer.removeListener('app:request-close', handler)
  },
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize') as Promise<void>,
    maximizeToggle: () => ipcRenderer.invoke('win:maximizeToggle') as Promise<boolean>,
    close: () => ipcRenderer.invoke('win:close') as Promise<void>,
    forceClose: () => ipcRenderer.invoke('win:forceClose') as Promise<void>,
    isMaximized: () => ipcRenderer.invoke('win:isMaximized') as Promise<boolean>,
    onMaximizeChange: (cb) => {
      const handler = (_event: Electron.IpcRendererEvent, isMaximized: boolean): void =>
        cb(isMaximized)
      ipcRenderer.on('win:maximizeChanged', handler)
      return () => ipcRenderer.removeListener('win:maximizeChanged', handler)
    },
    setZoom: (factor) => ipcRenderer.invoke('win:setZoom', factor) as Promise<void>,
    toggleFullScreen: () => ipcRenderer.invoke('win:toggleFullScreen') as Promise<boolean>
  }
}

contextBridge.exposeInMainWorld('api', api)
