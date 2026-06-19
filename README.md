# HD Scanner

A free, open-source disk space analyser — a multiplatform alternative to TreeSize.

## Features

- 🖴 **Disk & folder picker** — choose any drive or directory to scan
- 🗺️ **Squarified treemap** — folder sizes rendered as proportional rectangles
- 🔍 **Drill-down navigation** — click any folder to zoom into it; breadcrumb bar to navigate back
- 💡 **Hover tooltips** — see name, size, and full path on mouse-over
- 🌐 **Multiplatform** — Windows, macOS, Linux (built with Electron)

## Getting started

```bash
npm install
npm run dev      # start in development mode (hot-reload)
npm run build    # build for production
npm test         # run unit tests
```

## Architecture

| Layer | Technology |
|---|---|
| Desktop shell | Electron 42 |
| UI framework | React 19 + TypeScript |
| Build tool | electron-vite + Vite |
| Treemap layout | Custom squarified treemap (no extra runtime dependency) |
| Tests | Vitest |

### Key source files

```
src/
  main/index.ts          – Electron main process: window, IPC, folder scanning
  preload/index.ts       – Context-bridge API exposed to the renderer
  renderer/src/
    treemap.ts           – Pure squarified treemap layout algorithm
    App.tsx              – Top-level React component (states: idle → scanning → done)
    components/
      Treemap.tsx        – Canvas-based treemap renderer with click & tooltip
    global.css           – Application styles
src/tests/
  treemap.test.ts        – Unit tests for the treemap algorithm
```
