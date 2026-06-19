import React, { useState, useCallback, useEffect } from 'react'
import TreemapComponent, { FolderNode } from './components/Treemap'

type AppState = 'idle' | 'scanning' | 'done'

declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>
      listDrives: () => Promise<string[]>
      scanDirectory: (path: string) => Promise<FolderNode>
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

const App: React.FC = () => {
  const [state, setState] = useState<AppState>('idle')
  const [drives, setDrives] = useState<string[]>([])
  const [rootData, setRootData] = useState<FolderNode | null>(null)
  const [navStack, setNavStack] = useState<FolderNode[]>([])
  const [scanningPath, setScanningPath] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.listDrives().then(setDrives).catch(console.error)
  }, [])

  const currentNode = navStack.length > 0 ? navStack[navStack.length - 1] : rootData

  const startScan = useCallback(async (dirPath: string) => {
    setState('scanning')
    setScanningPath(dirPath)
    setError(null)
    setNavStack([])
    setRootData(null)

    const unsub = window.api.onScanProgress((p) => setScanningPath(p))
    try {
      const result = await window.api.scanDirectory(dirPath)
      setRootData(result)
      setState('done')
    } catch (err) {
      setError(String(err))
      setState('idle')
    } finally {
      unsub()
    }
  }, [])

  const handlePickFolder = useCallback(async () => {
    const chosen = await window.api.openFolder()
    if (chosen) startScan(chosen)
  }, [startScan])

  const handleNavigate = useCallback(
    (node: FolderNode) => {
      setNavStack((prev) => [...prev, node])
    },
    []
  )

  const handleBreadcrumb = useCallback(
    (index: number) => {
      if (index === -1) {
        // root
        setNavStack([])
      } else {
        setNavStack((prev) => prev.slice(0, index + 1))
      }
    },
    []
  )

  const breadcrumbs: { label: string; index: number }[] = rootData
    ? [
        { label: rootData.name, index: -1 },
        ...navStack.map((n, i) => ({ label: n.name, index: i }))
      ]
    : []

  return (
    <div className="app">
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
                    <button
                      key={d}
                      className="btn btn-drive"
                      onClick={() => startScan(d)}
                    >
                      🖴 {d}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
            />
          </div>

          <div className="treemap-hint">
            Click a folder rectangle to drill down into it.
          </div>
        </div>
      )}
    </div>
  )
}

export default App
