import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { statSync, readdirSync } from 'fs'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: 'HD Scanner',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ── IPC: open folder/disk picker dialog ──────────────────────────────────────
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory'],
    title: 'Select a folder or disk to scan'
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ── IPC: list drives (Windows) or mount points (Linux/Mac) ───────────────────
ipcMain.handle('fs:listDrives', async () => {
  if (process.platform === 'win32') {
    const drives: string[] = []
    for (let i = 65; i <= 90; i++) {
      const drive = `${String.fromCharCode(i)}:\\`
      try {
        statSync(drive)
        drives.push(drive)
      } catch {
        // drive not present
      }
    }
    return drives
  } else if (process.platform === 'darwin') {
    try {
      const entries = readdirSync('/Volumes')
      return entries.map((e) => `/Volumes/${e}`)
    } catch {
      return ['/']
    }
  } else {
    // Linux: return common mount points that exist
    const candidates = ['/', '/home', '/media', '/mnt', '/tmp']
    return candidates.filter((p) => {
      try {
        statSync(p)
        return true
      } catch {
        return false
      }
    })
  }
})

// ── Types shared with renderer ───────────────────────────────────────────────
export interface FolderNode {
  name: string
  path: string
  size: number
  children: FolderNode[]
  errorCount: number
}

// ── Exclude pattern matching ─────────────────────────────────────────────────
// Supports plain names ("node_modules") and simple "*" wildcards ("*.cache").
function isExcluded(name: string, excludes: string[]): boolean {
  if (excludes.length === 0) return false
  const lower = name.toLowerCase()
  return excludes.some((pattern) => {
    const p = pattern.trim().toLowerCase()
    if (!p) return false
    if (!p.includes('*')) return lower === p
    const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
    return new RegExp(`^${escaped}$`).test(lower)
  })
}

// ── Active scan tracking (for cancellation) ──────────────────────────────────
const activeScans = new Map<string, AbortController>()

class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled')
    this.name = 'ScanCancelledError'
  }
}

// ── Recursive folder scanner ─────────────────────────────────────────────────
async function scanDirectory(
  dirPath: string,
  signal: AbortSignal,
  excludes: string[],
  onProgress?: (scanned: string) => void
): Promise<FolderNode> {
  if (signal.aborted) throw new ScanCancelledError()

  const name = dirPath.split(/[\\/]/).pop() || dirPath

  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return { name, path: dirPath, size: 0, children: [], errorCount: 1 }
  }

  const children: FolderNode[] = []
  let size = 0
  let errorCount = 0

  const tasks = entries.map(async (entry) => {
    if (signal.aborted) return
    if (isExcluded(entry.name, excludes)) return
    const fullPath = join(dirPath, entry.name)
    try {
      if (entry.isSymbolicLink()) return
      if (entry.isDirectory()) {
        if (onProgress) onProgress(fullPath)
        const child = await scanDirectory(fullPath, signal, excludes, onProgress)
        children.push(child)
        size += child.size
        errorCount += child.errorCount
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath)
        size += stat.size
      }
    } catch {
      errorCount += 1
    }
  })

  await Promise.allSettled(tasks)
  if (signal.aborted) throw new ScanCancelledError()

  children.sort((a, b) => b.size - a.size)

  return { name, path: dirPath, size, children, errorCount }
}

// ── IPC: scan a directory, streaming progress ────────────────────────────────
ipcMain.handle(
  'fs:scanDirectory',
  async (event, dirPath: string, scanId: string, excludes: string[] = []) => {
    const controller = new AbortController()
    activeScans.set(scanId, controller)

    const onProgress = (scanned: string): void => {
      event.sender.send('fs:scanProgress', scanned)
    }

    try {
      return await scanDirectory(dirPath, controller.signal, excludes, onProgress)
    } finally {
      activeScans.delete(scanId)
    }
  }
)

ipcMain.handle('fs:cancelScan', (_event, scanId: string) => {
  const controller = activeScans.get(scanId)
  if (controller) controller.abort()
})

// ── IPC: reveal a file/folder in the OS file manager ─────────────────────────
ipcMain.handle('fs:revealInFolder', (_event, itemPath: string) => {
  shell.showItemInFolder(itemPath)
})

// ── IPC: move a file/folder to the OS trash, with confirmation ───────────────
ipcMain.handle('fs:trashItem', async (event, itemPath: string, itemName: string) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Cancel', 'Move to Trash'],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirm Delete',
    message: `Move "${itemName}" to the trash?`,
    detail: itemPath
  }
  const result = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options)
  if (result.response !== 1) return { deleted: false }
  await shell.trashItem(itemPath)
  return { deleted: true }
})

// ── IPC: export scan report as JSON or CSV ───────────────────────────────────
function flattenToCsv(node: FolderNode, rows: string[]): void {
  const escape = (s: string): string => `"${s.replace(/"/g, '""')}"`
  rows.push([escape(node.path), escape(node.name), String(node.size)].join(','))
  for (const child of node.children) flattenToCsv(child, rows)
}

ipcMain.handle(
  'fs:exportReport',
  async (event, root: FolderNode, format: 'json' | 'csv') => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.SaveDialogOptions = {
      title: 'Export Scan Report',
      defaultPath: `hd-scanner-report.${format}`,
      filters:
        format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'CSV', extensions: ['csv'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false }

    if (format === 'json') {
      await fs.writeFile(result.filePath, JSON.stringify(root, null, 2), 'utf-8')
    } else {
      const rows = ['path,name,size']
      flattenToCsv(root, rows)
      await fs.writeFile(result.filePath, rows.join('\n'), 'utf-8')
    }
    return { saved: true, filePath: result.filePath }
  }
)
