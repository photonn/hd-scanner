import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import { statSync, readdirSync, type Dirent } from 'fs'

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
    try {
      const { protocol } = new URL(details.url)
      if (protocol === 'https:' || protocol === 'http:') {
        void shell.openExternal(details.url).catch(console.error)
      }
    } catch {
      // malformed URL — ignore
    }
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
// Patterns are compiled once per scan (see compileExcludes) rather than per entry,
// since isExcluded() runs once per filesystem entry visited.
interface CompiledExcludes {
  exact: Set<string>
  regexes: RegExp[]
}

function compileExcludes(excludes: string[]): CompiledExcludes {
  const exact = new Set<string>()
  const regexes: RegExp[] = []
  for (const pattern of excludes) {
    const p = pattern.trim().toLowerCase()
    if (!p) continue
    if (!p.includes('*')) {
      exact.add(p)
    } else {
      const escaped = p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
      regexes.push(new RegExp(`^${escaped}$`))
    }
  }
  return { exact, regexes }
}

function isExcluded(name: string, compiled: CompiledExcludes): boolean {
  if (compiled.exact.size === 0 && compiled.regexes.length === 0) return false
  const lower = name.toLowerCase()
  if (compiled.exact.has(lower)) return true
  return compiled.regexes.some((re) => re.test(lower))
}

// ── Active scan tracking (for cancellation) ──────────────────────────────────
const activeScans = new Map<string, AbortController>()

// ── Debug mode ────────────────────────────────────────────────────────────────
// Toggled from the renderer so the user can watch what a scan is doing in the
// terminal/devtools console in real time — useful for telling apart "still
// scanning something big" from "actually frozen".
let debugEnabled = false

interface ScanStats {
  dirsEntered: number
  filesStated: number
  activeOps: number
  lastPath: string
  lastActivityAt: number
}

function debugLog(scanId: string, ...args: unknown[]): void {
  if (debugEnabled) console.log(`[scan:${scanId.slice(0, 8)}]`, ...args)
}

class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled')
    this.name = 'ScanCancelledError'
  }
}

// fs.promises readdir/stat don't support an AbortSignal option, so a hung
// syscall (e.g. an unresponsive network mount) would otherwise keep the scan
// "stuck" forever even after the user cancels. Racing every fs call against
// the signal lets cancellation unblock the promise chain immediately — the
// underlying I/O may keep running in the background, but we stop waiting on it.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ScanCancelledError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new ScanCancelledError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      }
    )
  })
}

// ── Recursive folder scanner ─────────────────────────────────────────────────
// The returned node (and every child node) is mutated in place as the scan
// progresses (size/children fill in incrementally), rather than only being
// populated once the whole subtree resolves. This lets the caller take live
// snapshots of an in-progress scan for real-time rendering.
async function scanDirectory(
  dirPath: string,
  signal: AbortSignal,
  excludes: CompiledExcludes,
  stats: ScanStats,
  onProgress?: (scanned: string) => void,
  onRootCreated?: (node: FolderNode) => void
): Promise<FolderNode> {
  if (signal.aborted) throw new ScanCancelledError()

  const name = dirPath.split(/[\\/]/).pop() || dirPath
  const node: FolderNode = { name, path: dirPath, size: 0, children: [], errorCount: 0 }
  if (onRootCreated) onRootCreated(node)

  stats.dirsEntered += 1
  stats.activeOps += 1
  stats.lastPath = dirPath
  stats.lastActivityAt = Date.now()

  let entries: Dirent<string>[]
  try {
    entries = await abortable(
      fs.readdir(dirPath, { withFileTypes: true, encoding: 'utf8' }),
      signal
    )
  } catch {
    stats.activeOps -= 1
    if (signal.aborted) throw new ScanCancelledError()
    node.errorCount = 1
    return node
  }
  stats.activeOps -= 1
  stats.lastActivityAt = Date.now()

  const tasks = entries.map(async (entry) => {
    if (signal.aborted) return
    if (isExcluded(entry.name, excludes)) return
    const fullPath = join(dirPath, entry.name)
    stats.activeOps += 1
    try {
      if (entry.isSymbolicLink()) return
      if (entry.isDirectory()) {
        if (onProgress) onProgress(fullPath)
        const child = await scanDirectory(fullPath, signal, excludes, stats, onProgress)
        node.children.push(child)
        node.size += child.size
        node.errorCount += child.errorCount
      } else if (entry.isFile()) {
        const stat = await abortable(fs.stat(fullPath), signal)
        node.size += stat.size
        stats.filesStated += 1
      }
    } catch {
      if (!signal.aborted) node.errorCount += 1
    } finally {
      stats.activeOps -= 1
      stats.lastPath = fullPath
      stats.lastActivityAt = Date.now()
    }
  })

  await Promise.allSettled(tasks)
  if (signal.aborted) throw new ScanCancelledError()

  node.children.sort((a, b) => b.size - a.size)

  return node
}

// ── IPC: scan a directory, streaming progress + live snapshots ──────────────
const SNAPSHOT_INTERVAL_MS = 400
const HEARTBEAT_INTERVAL_MS = 1000

ipcMain.handle(
  'fs:scanDirectory',
  async (event, dirPath: string, scanId: string, excludes: string[] = []) => {
    const controller = new AbortController()
    activeScans.set(scanId, controller)

    const safeSend = (channel: string, ...args: unknown[]): void => {
      if (!event.sender.isDestroyed()) event.sender.send(channel, ...args)
    }

    const onProgress = (scanned: string): void => {
      safeSend('fs:scanProgress', scanId, scanned)
    }

    const stats: ScanStats = {
      dirsEntered: 0,
      filesStated: 0,
      activeOps: 0,
      lastPath: dirPath,
      lastActivityAt: Date.now()
    }
    const startedAt = Date.now()
    debugLog(scanId, 'scan started', dirPath, 'excludes:', excludes)

    let rootNode: FolderNode | null = null
    // Skip the (relatively expensive) deep clone + send when the tree hasn't
    // grown since the last tick — common for small/fast-finishing scans.
    let lastSnapshotSize = -1
    const snapshotTimer = setInterval(() => {
      if (rootNode && rootNode.size !== lastSnapshotSize) {
        lastSnapshotSize = rootNode.size
        safeSend('fs:scanSnapshot', scanId, structuredClone(rootNode))
      }
    }, SNAPSHOT_INTERVAL_MS)

    const heartbeatTimer = setInterval(() => {
      const elapsedMs = Date.now() - startedAt
      const idleMs = Date.now() - stats.lastActivityAt
      const heartbeat = {
        elapsedMs,
        idleMs,
        dirsEntered: stats.dirsEntered,
        filesStated: stats.filesStated,
        activeOps: stats.activeOps,
        lastPath: stats.lastPath
      }
      safeSend('fs:scanHeartbeat', scanId, heartbeat)
      debugLog(
        scanId,
        `heartbeat: dirs=${stats.dirsEntered} files=${stats.filesStated} activeOps=${stats.activeOps} idleMs=${idleMs} lastPath=${stats.lastPath}`
      )
    }, HEARTBEAT_INTERVAL_MS)

    try {
      const result = await scanDirectory(
        dirPath,
        controller.signal,
        compileExcludes(excludes),
        stats,
        onProgress,
        (node) => {
          rootNode = node
        }
      )
      debugLog(
        scanId,
        `scan finished in ${Date.now() - startedAt}ms — dirs=${stats.dirsEntered} files=${stats.filesStated}`
      )
      return result
    } catch (err) {
      debugLog(scanId, 'scan ended:', err instanceof Error ? err.message : err)
      throw err
    } finally {
      clearInterval(snapshotTimer)
      clearInterval(heartbeatTimer)
      activeScans.delete(scanId)
    }
  }
)

ipcMain.handle('fs:cancelScan', (_event, scanId: string) => {
  debugLog(scanId, 'cancel requested')
  const controller = activeScans.get(scanId)
  if (controller) controller.abort()
})

ipcMain.handle('fs:setDebugMode', (_event, enabled: boolean) => {
  debugEnabled = enabled
  console.log(`[scan] debug mode ${enabled ? 'enabled' : 'disabled'}`)
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
  async (event, root: FolderNode, format: unknown) => {
    if (format !== 'json' && format !== 'csv') {
      throw new Error(`Invalid export format: ${String(format)}`)
    }

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
