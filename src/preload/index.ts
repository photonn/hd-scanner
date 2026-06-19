import { contextBridge, ipcRenderer } from 'electron'

export type FolderNode = {
  name: string
  path: string
  size: number
  children: FolderNode[]
  errorCount: number
}

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),

  listDrives: (): Promise<string[]> => ipcRenderer.invoke('fs:listDrives'),

  scanDirectory: (dirPath: string, scanId: string, excludes: string[]): Promise<FolderNode> =>
    ipcRenderer.invoke('fs:scanDirectory', dirPath, scanId, excludes),

  cancelScan: (scanId: string): Promise<void> => ipcRenderer.invoke('fs:cancelScan', scanId),

  revealInFolder: (itemPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:revealInFolder', itemPath),

  trashItem: (itemPath: string, itemName: string): Promise<{ deleted: boolean }> =>
    ipcRenderer.invoke('fs:trashItem', itemPath, itemName),

  exportReport: (
    root: FolderNode,
    format: 'json' | 'csv'
  ): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('fs:exportReport', root, format),

  onScanProgress: (callback: (path: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, path: string): void => callback(path)
    ipcRenderer.on('fs:scanProgress', handler)
    return () => ipcRenderer.removeListener('fs:scanProgress', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
