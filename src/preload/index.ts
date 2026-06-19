import { contextBridge, ipcRenderer } from 'electron'

export type FolderNode = {
  name: string
  path: string
  size: number
  children: FolderNode[]
}

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),

  listDrives: (): Promise<string[]> => ipcRenderer.invoke('fs:listDrives'),

  scanDirectory: (dirPath: string): Promise<FolderNode> =>
    ipcRenderer.invoke('fs:scanDirectory', dirPath),

  onScanProgress: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('fs:scanProgress', handler)
    return () => ipcRenderer.removeListener('fs:scanProgress', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
