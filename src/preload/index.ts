import { contextBridge, ipcRenderer } from 'electron'

export type FolderNode = {
  name: string
  path: string
  size: number
  children: FolderNode[]
  errorCount: number
}

export type ScanHeartbeat = {
  elapsedMs: number
  idleMs: number
  dirsEntered: number
  filesStated: number
  activeOps: number
  lastPath: string
}

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),

  listDrives: (): Promise<string[]> => ipcRenderer.invoke('fs:listDrives'),

  scanDirectory: (dirPath: string, scanId: string, excludes: string[]): Promise<FolderNode> =>
    ipcRenderer.invoke('fs:scanDirectory', dirPath, scanId, excludes),

  cancelScan: (scanId: string): Promise<void> => ipcRenderer.invoke('fs:cancelScan', scanId),

  setDebugMode: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('fs:setDebugMode', enabled),

  revealInFolder: (itemPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:revealInFolder', itemPath),

  trashItem: (itemPath: string, itemName: string): Promise<{ deleted: boolean }> =>
    ipcRenderer.invoke('fs:trashItem', itemPath, itemName),

  exportReport: (
    root: FolderNode,
    format: 'json' | 'csv'
  ): Promise<{ saved: boolean; filePath?: string }> =>
    ipcRenderer.invoke('fs:exportReport', root, format),

  onScanProgress: (callback: (scanId: string, path: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, scanId: string, path: string): void =>
      callback(scanId, path)
    ipcRenderer.on('fs:scanProgress', handler)
    return () => ipcRenderer.removeListener('fs:scanProgress', handler)
  },

  onScanSnapshot: (callback: (scanId: string, node: FolderNode) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, scanId: string, node: FolderNode): void =>
      callback(scanId, node)
    ipcRenderer.on('fs:scanSnapshot', handler)
    return () => ipcRenderer.removeListener('fs:scanSnapshot', handler)
  },

  onScanHeartbeat: (callback: (scanId: string, heartbeat: ScanHeartbeat) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      scanId: string,
      heartbeat: ScanHeartbeat
    ): void => callback(scanId, heartbeat)
    ipcRenderer.on('fs:scanHeartbeat', handler)
    return () => ipcRenderer.removeListener('fs:scanHeartbeat', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
