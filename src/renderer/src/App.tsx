import React, { useState, useCallback, useEffect, useRef } from 'react'
import TreemapComponent, { FolderNode } from './components/Treemap'

type AppState = 'idle' | 'scanning' | 'done'

declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>
      listDrives: () => Promise<string[]>
      scanDirectory: (path: string, scanId: string, excludes: string[]) => Promise<FolderNode>
      cancelScan: (scanId: string) => Promise<void>
      revealInFolder: (itemPath: string) => Promise<void>
      trashItem: (itemPath: string, itemName: string) => Promise<{ deleted: boolean }>
      exportReport: (
        root: FolderNode,
        format: 'json' | 'csv'
      ) => Promise<{ saved: boolean; filePath?: string }>
      onScanProgress: (cb: (path: string) => void) => () => void
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

  const scanIdRef = useRef<string | null>(null)

  useEffect(() => {
    window.api.listDrives().then(setDrives).catch(console.error)
  }, [])

  // Cancel any in-flight scan if the component unmounts mid-scan.
  useEffect(() => {
    return () => {
      if (scanIdRef.current) void window.api.cancelScan(scanIdRef.current).catch(console.error)
    }
  }, [])

  const currentNode = navStack.length > 0 ? navStack[navStack.length - 1] : rootData

  const startScan = useCallback(
    async (dirPath: string) => {
      setState('scanning')
      setScanningPath(dirPath)
      setError(null)
      setNavStack([])
      setRootData(null)
      setContextMenu(null)

      const scanId = crypto.randomUUID()
      scanIdRef.current = scanId

      const unsub = window.api.onScanProgress((p) => setScanningPath(p))
      try {
        const result = await window.api.scanDirectory(dirPath, scanId, parseExcludes(excludeInput))
        setRootData(result)
        setState('done')
      } catch (err) {
        const message = String(err)
        // A cancelled scan is an expected outcome, not a failure — don't surface an error.
        if (!message.toLowerCase().includes('cancelled')) setError(message)
        setState('idle')
      } finally {
        unsub()
        scanIdRef.current = null
      }
    },
    [excludeInput]
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

      {state === 'scanning' && (
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

      {state === 'done' && currentNode && (
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
              <button className="btn btn-secondary" onClick={() => handleExport('json')}>
                ⬇️ Export JSON
              </button>
              <button className="btn btn-secondary" onClick={() => handleExport('csv')}>
                ⬇️ Export CSV
              </button>
              <button className="btn btn-secondary" onClick={handlePickFolder}>
                🔄 New scan
              </button>
            </div>
          </div>

          <div className="treemap-container">
            <TreemapComponent
              key={currentNode.path}
              root={currentNode}
              onNavigate={handleNavigate}
              onContextMenu={handleContextMenu}
            />
          </div>

          <div className="treemap-hint">
            Click a folder rectangle to drill down. Right-click for more actions.
          </div>
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
