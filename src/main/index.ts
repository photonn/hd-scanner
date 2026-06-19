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
}

// ── Recursive folder scanner ─────────────────────────────────────────────────
async function scanDirectory(
  dirPath: string,
  onProgress?: (scanned: string) => void
): Promise<FolderNode> {
  const name = dirPath.split(/[\\/]/).pop() || dirPath

  let entries: Awaited<ReturnType<typeof fs.readdir>>
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true })
  } catch {
    return { name, path: dirPath, size: 0, children: [] }
  }

  const children: FolderNode[] = []
  let size = 0

  const tasks = entries.map(async (entry) => {
    const fullPath = join(dirPath, entry.name)
    try {
      if (entry.isSymbolicLink()) return
      if (entry.isDirectory()) {
        if (onProgress) onProgress(fullPath)
        const child = await scanDirectory(fullPath, onProgress)
        children.push(child)
        size += child.size
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath)
        size += stat.size
      }
    } catch {
      // skip inaccessible entries
    }
  })

  await Promise.allSettled(tasks)
  children.sort((a, b) => b.size - a.size)

  return { name, path: dirPath, size, children }
}

// ── IPC: scan a directory, streaming progress ────────────────────────────────
ipcMain.handle('fs:scanDirectory', async (event, dirPath: string) => {
  const onProgress = (scanned: string): void => {
    event.sender.send('fs:scanProgress', scanned)
  }
  return scanDirectory(dirPath, onProgress)
})
