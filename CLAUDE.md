# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HD Scanner — a free, open-source disk space analyser (TreeSize/WinDirStat-style alternative). Electron + React + TypeScript desktop app that scans a folder/drive and renders sizes as a squarified treemap.

## Commands

```bash
npm install            # note: electron-vite@5 vs vite@8 peer conflict in package.json;
                        # currently requires --legacy-peer-deps to install cleanly
npm run dev             # electron-vite dev — hot-reload desktop app
npm run build           # electron-vite build — builds main/preload/renderer into out/
npm run preview          # electron-vite preview (also aliased as `npm start`)
npm test                 # vitest run — runs src/tests/**/*.test.ts
npx vitest run src/tests/treemap.test.ts   # run a single test file
npx vitest run -t "name" # run tests matching a name pattern
npx tsc --noEmit -p tsconfig.node.json   # typecheck main/preload process
npx tsc --noEmit -p tsconfig.web.json    # typecheck renderer (React) process
```

There is no lint script configured.

## Architecture

This is a standard **electron-vite** three-process layout — main, preload, renderer — each with its own `tsconfig` and its own bundle entry in `electron.vite.config.ts`:

- **`src/main/index.ts`** — Electron main process. Owns all filesystem/OS access and is the only place `fs`, `dialog`, and `shell` are used. Key responsibilities:
  - Window creation with `contextIsolation: true` (and `sandbox: false`) — renderer never touches Node APIs directly.
  - `fs:listDrives` — platform-branches for Windows (probe `A:\`–`Z:\`), macOS (`/Volumes`), Linux (hardcoded mount point candidates).
  - `scanDirectory()` — recursive async directory walk; parallelizes children with `Promise.allSettled`, skips symlinks, sorts children descending by size, and tracks an `errorCount` for entries that couldn't be read (permission denied, etc.) instead of failing silently.
  - Scan cancellation: each scan is given a `scanId` from the renderer and tracked in an `activeScans` Map of `AbortController`s; `fs:cancelScan` aborts the in-flight walk.
  - Exclude patterns: `isExcluded()` matches directory/file names against simple glob-style patterns (`*` wildcard) supplied by the renderer, applied during the walk (not as a post-filter).
  - Destructive/OS-integration IPC (`fs:trashItem`, `fs:revealInFolder`, `fs:exportReport`) live here too — `fs:trashItem` always shows a native confirmation dialog before calling `shell.trashItem`.

- **`src/preload/index.ts`** — the *only* bridge between main and renderer, via `contextBridge.exposeInMainWorld('api', ...)`. Every method here is a thin wrapper around `ipcRenderer.invoke`/`.on`. If you add a new main-process capability, it must be wired through here before the renderer can call it — renderer code accesses it as `window.api.*`, declared via a global `Window.api` type augmentation in `App.tsx`.

- **`src/renderer/src/treemap.ts`** — pure, dependency-free squarified treemap layout algorithm (Bruls et al. 2000). Takes `{ value }[]` + a bounding box and returns rects in original item order. No DOM/React/Electron knowledge — this is why it's unit-testable in isolation (`src/tests/treemap.test.ts`, Node environment via `vitest.config.ts`).

- **`src/renderer/src/components/Treemap.tsx`** — canvas-based renderer that consumes `treemap.ts`. Important nuance: it doesn't just lay out the root's direct children — `buildRects()` *recursively* re-invokes `squarifiedTreemap()` for any folder tile whose pixel area is large enough (`MIN_CHILD_AREA`), producing nested rects in one flat array (painted deepest-first). Hit-testing (`getNodeAt`) and the right-click context menu both search this same flat rect list back-to-front to find the topmost (deepest) tile under the cursor.

- **`src/renderer/src/App.tsx`** — top-level state machine (`idle → scanning → done`) and the only place that owns scan state, navigation breadcrumbs, and the exclude-pattern input. Drilling into a folder pushes onto `navStack`, rather than re-scanning — the whole tree is scanned once up front and the UI just re-renders a different subtree of `rootData`. After a delete via the context menu, the app re-runs a full scan from `rootData.path` rather than patching the in-memory tree.

### Data flow for a scan

1. `App.tsx` generates a `scanId`, calls `window.api.scanDirectory(path, scanId, excludePatterns)`.
2. Preload invokes `fs:scanDirectory` in main; main creates an `AbortController`, stores it in `activeScans`, and recurses.
3. Progress (`fs:scanProgress`) streams back per-directory via an event the renderer subscribed to with `onScanProgress`.
4. The full `FolderNode` tree (with per-node `size` and `errorCount`, children pre-sorted descending by size) resolves back to the renderer in one shot — there is no incremental/partial tree rendering.
5. Cancelling calls `window.api.cancelScan(scanId)`, which aborts the controller; the pending `scanDirectory` promise rejects and `App.tsx` resets to `idle`.

### Shared types

`FolderNode` (`{ name, path, size, children, errorCount }`) is defined independently in `main/index.ts`, `preload/index.ts`, and `components/Treemap.tsx` — there's no shared types package. When changing this shape, update all three.
