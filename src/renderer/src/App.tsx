import React, { useState, useCallback, useEffect, useRef } from 'react'
import TreemapComponent, { FolderNode } from './components/Treemap'

type AppState = 'idle' | 'scanning' | 'done'

type ScanHeartbeat = {
  elapsedMs: number
  idleMs: number
  dirsEntered: number
  filesStated: number
  activeOps: number
  lastPath: string
}

declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>
      listDrives: () => Promise<string[]>
      scanDirectory: (
        path: string,
        scanId: string,
        excludes: string[],
        maxConcurrency: number
      ) => Promise<FolderNode>
      cancelScan: (scanId: string) => Promise<void>
      setScanConcurrency: (scanId: string, maxConcurrency: number) => Promise<void>
      setDebugMode: (enabled: boolean) => Promise<void>
      revealInFolder: (itemPath: string) => Promise<void>
      trashItem: (itemPath: string, itemName: string) => Promise<{ deleted: boolean }>
      exportReport: (
        root: FolderNode,
        format: 'json' | 'csv'
      ) => Promise<{ saved: boolean; filePath?: string }>
      onScanProgress: (cb: (scanId: string, path: string) => void) => () => void
      onScanSnapshot: (cb: (scanId: string, node: FolderNode) => void) => () => void
      onScanHeartbeat: (cb: (scanId: string, heartbeat: ScanHeartbeat) => void) => () => void
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes >= 1e12) return (bytes / 1e12).toFixed(2) + ' TB'
  if (bytes >= 1e9) return (bytes / 1e9).toFixed(2) + ' GB'
  if (bytes >= 1e6) return (bytes / 1e6).toFixed(2) + ' MB'
  if (bytes >= 1e3) return (bytes / 1e3).toFixed(2) + ' KB'
  return bytes + ' B'
}

function parseExcludes(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const MIN_CONCURRENCY = 5
const MAX_CONCURRENCY = 64
const DEFAULT_CONCURRENCY = 10

function loadStoredConcurrency(): number {
  const stored = Number(localStorage.getItem('hd-scanner:maxConcurrency'))
  // Clamp into range rather than discarding — a value stored under an older,
  // wider MIN/MAX (e.g. 1-4 from before the floor was raised to 5) should
  // land at the new floor, not silently jump up to DEFAULT_CONCURRENCY.
  if (!Number.isFinite(stored)) return DEFAULT_CONCURRENCY
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, stored))
}

interface ContextMenuState {
  node: FolderNode
  x: number
  y: number
}

const App: React.FC = () => {
  const [state, setState] = useState<AppState>('idle')
  const [drives, setDrives] = useState<string[]>([])
  const [rootData, setRootData] = useState<FolderNode | null>(null)
  const [navStack, setNavStack] = useState<FolderNode[]>([])
  const [scanningPath, setScanningPath] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [excludeInput, setExcludeInput] = useState<string>('node_modules, .git')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [expandedPath, setExpandedPath] = useState<FolderNode[]>([])
  const [debugMode, setDebugMode] = useState<boolean>(
    () => localStorage.getItem('hd-scanner:debug') === '1'
  )
  const [heartbeat, setHeartbeat] = useState<ScanHeartbeat | null>(null)
  const [maxConcurrency, setMaxConcurrency] = useState<number>(loadStoredConcurrency)

  const scanIdRef = useRef<string | null>(null)
  // Heartbeat events fire once a second for the life of every scan, so they
  // read this ref (rather than the `debugMode` state captured when the scan
  // started) to decide whether to re-render/log — this keeps a mid-scan
  // toggle effective immediately and avoids a state update + re-render every
  // second when debug mode is off.
  const debugModeRef = useRef(debugMode)

  useEffect(() => {
    window.api.listDrives().then(setDrives).catch(console.error)
  }, [])

  // Keep main-process logging in sync with the toggle, and persist it across
  // restarts so a debug session survives an app reload.
  useEffect(() => {
    debugModeRef.current = debugMode
    localStorage.setItem('hd-scanner:debug', debugMode ? '1' : '0')
    void window.api.setDebugMode(debugMode).catch(console.error)
  }, [debugMode])

  const handleToggleDebug = useCallback(() => {
    setDebugMode((prev) => !prev)
  }, [])

  // Persist the chosen worker cap and, if a scan is currently running, push
  // it live to that scan's semaphore — no need to wait for the next scan.
  useEffect(() => {
    localStorage.setItem('hd-scanner:maxConcurrency', String(maxConcurrency))
    if (scanIdRef.current) {
      void window.api.setScanConcurrency(scanIdRef.current, maxConcurrency).catch(console.error)
    }
  }, [maxConcurrency])

  const handleConcurrencyChange = useCallback((value: number) => {
    setMaxConcurrency(value)
  }, [])

  // Cancel any in-flight scan if the component unmounts mid-scan.
  useEffect(() => {
    return () => {
      if (scanIdRef.current) void window.api.cancelScan(scanIdRef.current).catch(console.error)
    }
  }, [])

  const currentNode = navStack.length > 0 ? navStack[navStack.length - 1] : rootData

  // Collapse any in-place expansion whenever the viewed root changes (drill
  // in/out, breadcrumb jump, new scan) since the expanded path belongs to
  // the previous root's children.
  useEffect(() => {
    setExpandedPath([])
  }, [currentNode?.path])

  const startScan = useCallback(
    async (dirPath: string) => {
      setState('scanning')
      setScanningPath(dirPath)
      setError(null)
      setNavStack([])
      setRootData(null)
      setContextMenu(null)
      setExpandedPath([])
      setHeartbeat(null)

      const scanId = crypto.randomUUID()
      scanIdRef.current = scanId
      if (debugModeRef.current) console.log(`[scan:${scanId.slice(0, 8)}] starting`, dirPath)

      // Stale events from a superseded/cancelled scan must not clobber the
      // current scan's state, so ignore anything not tagged with this scanId.
      const unsubProgress = window.api.onScanProgress((id, p) => {
        if (id !== scanId) return
        setScanningPath(p)
        if (debugModeRef.current) console.log(`[scan:${scanId.slice(0, 8)}] progress`, p)
      })
      const unsubSnapshot = window.api.onScanSnapshot((id, node) => {
        if (id !== scanId) return
        setRootData(node)
        if (debugModeRef.current)
          console.log(
            `[scan:${scanId.slice(0, 8)}] snapshot`,
            `size=${node.size}`,
            `children=${node.children.length}`
          )
      })
      const unsubHeartbeat = window.api.onScanHeartbeat((id, hb) => {
        if (id !== scanId) return
        // Skip the re-render entirely when debug mode is off — the panel
        // that would display this state isn't even rendered.
        if (!debugModeRef.current) return
        setHeartbeat(hb)
        console.log(`[scan:${scanId.slice(0, 8)}] heartbeat`, hb)
      })
      try {
        const result = await window.api.scanDirectory(
          dirPath,
          scanId,
          parseExcludes(excludeInput),
          maxConcurrency
        )
        setRootData(result)
        setState('done')
        if (debugModeRef.current) console.log(`[scan:${scanId.slice(0, 8)}] done`)
      } catch (err) {
        const message = String(err)
        if (debugModeRef.current) console.log(`[scan:${scanId.slice(0, 8)}] ended:`, message)
        // A cancelled scan is an expected outcome, not a failure — don't surface an error.
        if (!message.toLowerCase().includes('cancelled')) setError(message)
        setState('idle')
        setRootData(null)
      } finally {
        unsubProgress()
        unsubSnapshot()
        unsubHeartbeat()
        scanIdRef.current = null
        setHeartbeat(null)
      }
    },
    [excludeInput, maxConcurrency]
  )

  const handleCancelScan = useCallback(() => {
    if (scanIdRef.current) void window.api.cancelScan(scanIdRef.current).catch(console.error)
  }, [])

  const handlePickFolder = useCallback(async () => {
    const chosen = await window.api.openFolder()
    if (chosen) startScan(chosen)
  }, [startScan])

  const handleNavigate = useCallback((node: FolderNode) => {
    setNavStack((prev) => [...prev, node])
  }, [])

  const handleBreadcrumb = useCallback((index: number) => {
    if (index === -1) {
      setNavStack([])
    } else {
      setNavStack((prev) => prev.slice(0, index + 1))
    }
  }, [])

  const handleContextMenu = useCallback((node: FolderNode, x: number, y: number) => {
    setContextMenu({ node, x, y })
  }, [])

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const handleReveal = useCallback(() => {
    if (contextMenu) void window.api.revealInFolder(contextMenu.node.path).catch(console.error)
    setContextMenu(null)
  }, [contextMenu])

  const handleDelete = useCallback(async () => {
    if (!contextMenu || !rootData) return
    const { node } = contextMenu
    setContextMenu(null)
    try {
      const result = await window.api.trashItem(node.path, node.name)
      if (result.deleted) startScan(rootData.path)
    } catch (err) {
      setError(String(err))
    }
  }, [contextMenu, rootData, startScan])

  const handleExport = useCallback(
    async (format: 'json' | 'csv') => {
      if (!rootData) return
      try {
        await window.api.exportReport(rootData, format)
      } catch (err) {
        setError(String(err))
      }
    },
    [rootData]
  )

  const breadcrumbs: { label: string; index: number }[] = rootData
    ? [
        { label: rootData.name, index: -1 },
        ...navStack.map((n, i) => ({ label: n.name, index: i }))
      ]
    : []

  return (
    <div className="app" onClick={closeContextMenu}>
      <header className="app-header">
        <div className="header-left">
          <span className="app-logo">💿</span>
          <h1 className="app-title">HD Scanner</h1>
        </div>
        <div className="header-actions">
          <div
            className="workers-control"
            title="Maximum number of filesystem operations the scanner runs at once. Lower this if scanning makes your system unresponsive; raising it can speed up scans on fast drives. Takes effect immediately, even mid-scan."
          >
            <label htmlFor="workers-range">⚙️ Workers</label>
            <input
              id="workers-range"
              type="range"
              min={MIN_CONCURRENCY}
              max={MAX_CONCURRENCY}
              value={maxConcurrency}
              onChange={(e) => handleConcurrencyChange(Number(e.target.value))}
            />
            <span className="workers-value">{maxConcurrency}</span>
          </div>
          <button
            className={`btn btn-secondary${debugMode ? ' btn-debug-active' : ''}`}
            onClick={handleToggleDebug}
            title="Log scan progress and per-second stats to the console, and show a live stats panel"
          >
            🐛 Debug {debugMode ? 'on' : 'off'}
          </button>
          <button className="btn btn-primary" onClick={handlePickFolder}>
            📂 Choose Folder…
          </button>
        </div>
      </header>

      {state === 'idle' && !rootData && (
        <div className="home-screen">
          <div className="welcome-card">
            <div className="welcome-icon">💾</div>
            <h2>Disk Space Analyser</h2>
            <p>Select a folder or disk to visualise its contents as a treemap.</p>

            {drives.length > 0 && (
              <div className="drives-section">
                <p className="drives-label">Quick-scan a drive:</p>
                <div className="drives-list">
                  {drives.map((d) => (
                    <button key={d} className="btn btn-drive" onClick={() => startScan(d)}>
                      🖴 {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="exclude-section">
              <label className="exclude-label" htmlFor="exclude-input">
                Exclude patterns (comma-separated, supports *)
              </label>
              <input
                id="exclude-input"
                className="exclude-input"
                type="text"
                value={excludeInput}
                onChange={(e) => setExcludeInput(e.target.value)}
                placeholder="node_modules, .git, *.cache"
              />
            </div>

            <button className="btn btn-primary btn-large" onClick={handlePickFolder}>
              📂 Choose Folder…
            </button>
            {error && <p className="error-msg">{error}</p>}
          </div>
        </div>
      )}

      {state === 'scanning' && !rootData && (
        <div className="scanning-overlay">
          <div className="scanning-card">
            <div className="spinner" />
            <p className="scanning-title">Scanning…</p>
            <p className="scanning-path">{scanningPath}</p>
            <button className="btn btn-secondary" onClick={handleCancelScan}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {(state === 'scanning' || state === 'done') && currentNode && (
        <div className="treemap-view">
          <div className="treemap-toolbar">
            <nav className="breadcrumb" aria-label="Navigation">
              {breadcrumbs.map((b, i) => (
                <React.Fragment key={b.index}>
                  {i > 0 && <span className="breadcrumb-sep">›</span>}
                  <button
                    className={`breadcrumb-item${i === breadcrumbs.length - 1 ? ' active' : ''}`}
                    onClick={() => handleBreadcrumb(b.index)}
                    disabled={i === breadcrumbs.length - 1}
                  >
                    {b.label}
                  </button>
                </React.Fragment>
              ))}
            </nav>
            <div className="toolbar-meta">
              <span className="size-badge">{formatSize(currentNode.size)}</span>
              {rootData && rootData.errorCount > 0 && (
                <span
                  className="error-badge"
                  title="Some files or folders could not be read (permission denied)"
                >
                  ⚠️ {rootData.errorCount} skipped
                </span>
              )}
              {state === 'done' && (
                <>
                  <button className="btn btn-secondary" onClick={() => handleExport('json')}>
                    ⬇️ Export JSON
                  </button>
                  <button className="btn btn-secondary" onClick={() => handleExport('csv')}>
                    ⬇️ Export CSV
                  </button>
                </>
              )}
              {state === 'scanning' ? (
                <button className="btn btn-secondary" onClick={handleCancelScan}>
                  ✋ Cancel scan
                </button>
              ) : (
                <button className="btn btn-secondary" onClick={handlePickFolder}>
                  🔄 New scan
                </button>
              )}
            </div>
          </div>

          {state === 'scanning' && (
            <div className="scanning-indicator">
              <div className="spinner spinner-small" />
              <span className="scanning-path">{scanningPath}</span>
            </div>
          )}

          <div className="treemap-container">
            <TreemapComponent
              key={rootData?.path}
              root={currentNode}
              onNavigate={handleNavigate}
              onContextMenu={handleContextMenu}
              expandedPath={expandedPath}
              onExpandPath={setExpandedPath}
              interactive={state === 'done'}
            />
          </div>

          <div className="treemap-hint">
            {state === 'scanning'
              ? 'Live preview — finishing the scan…'
              : 'Click a folder to preview its contents inline. Double-click to drill in. Right-click for more actions.'}
          </div>
        </div>
      )}

      {debugMode && heartbeat && state === 'scanning' && (
        <div className="debug-panel">
          <div className="debug-panel-title">🐛 Scan debug</div>
          <div className="debug-panel-row">
            <span>Elapsed</span>
            <span>{(heartbeat.elapsedMs / 1000).toFixed(1)}s</span>
          </div>
          <div className="debug-panel-row">
            <span>Idle since last activity</span>
            <span className={heartbeat.idleMs > 5000 ? 'debug-warn' : undefined}>
              {(heartbeat.idleMs / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="debug-panel-row">
            <span>Dirs entered</span>
            <span>{heartbeat.dirsEntered}</span>
          </div>
          <div className="debug-panel-row">
            <span>Files stat&apos;d</span>
            <span>{heartbeat.filesStated}</span>
          </div>
          <div className="debug-panel-row">
            <span>Active ops</span>
            <span>{heartbeat.activeOps}</span>
          </div>
          <div className="debug-panel-row">
            <span>Worker cap</span>
            <span>{maxConcurrency}</span>
          </div>
          <div className="debug-panel-row debug-panel-path" title={heartbeat.lastPath}>
            <span>Last path</span>
            <span>{heartbeat.lastPath}</span>
          </div>
          {heartbeat.idleMs > 5000 && heartbeat.activeOps > 0 && (
            <div className="debug-panel-hint">
              No activity for {(heartbeat.idleMs / 1000).toFixed(0)}s with {heartbeat.activeOps}{' '}
              op(s) outstanding — likely stuck on a slow/unresponsive path.
            </div>
          )}
        </div>
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button className="context-menu-item" onClick={handleReveal}>
            🔍 Reveal in file manager
          </button>
          <button className="context-menu-item context-menu-danger" onClick={handleDelete}>
            🗑️ Move to trash
          </button>
        </div>
      )}
    </div>
  )
}

export default App
