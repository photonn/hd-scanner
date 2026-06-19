# HD Scanner

A free, open-source disk space analyser — a multiplatform alternative to TreeSize and WinDirStat.

![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## Features

- 🖴 **Disk & folder picker** — choose any drive or directory to scan
- 🗺️ **Squarified treemap** — folder sizes rendered as proportional rectangles, painted live as the scan progresses
- 🔍 **Drill-down navigation** — click any folder to zoom into it; breadcrumb bar to navigate back
- 💡 **Hover tooltips** — see name, size, and full path on mouse-over
- 🚫 **Exclude patterns** — skip files/directories matching simple glob patterns (e.g. `node_modules`, `*.log`) during the scan
- 🗑️ **Move to trash** — delete files/folders straight from the treemap, with a confirmation dialog
- 📂 **Reveal in folder** — jump to a file/folder in your OS file manager
- 📄 **Export report** — save scan results to disk
- 🌐 **Multiplatform** — Windows, macOS, Linux (built with Electron)

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- npm

### Install & run

```bash
git clone https://github.com/photonn/hd-scanner.git
cd hd-scanner

# NOTE: electron-vite@5 and vite@8 currently have a peer-dependency conflict.
# Until that's resolved upstream, install with:
npm install --legacy-peer-deps

npm run dev      # start in development mode (hot-reload)
```

### Other commands

```bash
npm run build     # electron-vite build -> bundles main/preload/renderer into out/
npm run preview   # preview the production build (alias: npm start)
npm test          # vitest run -- runs src/tests/**/*.test.ts

npx tsc --noEmit -p tsconfig.node.json   # typecheck main/preload process
npx tsc --noEmit -p tsconfig.web.json    # typecheck renderer (React) process
```

## Architecture

| Layer | Technology |
|---|---|
| Desktop shell | Electron |
| UI framework | React + TypeScript |
| Build tool | electron-vite + Vite |
| Treemap layout | Custom squarified treemap (Bruls et al. 2000), no extra runtime dependency |
| Tests | Vitest |

HD Scanner follows the standard Electron three-process model. The main process owns all filesystem and OS access (`fs`, `dialog`, `shell`); the renderer never touches Node APIs directly — everything is exposed through a `contextBridge` preload script.

### Key source files

```
src/
  main/index.ts          – Electron main process: window, IPC, recursive folder scanning
  preload/index.ts       – Context-bridge API exposed to the renderer (window.api.*)
  renderer/src/
    treemap.ts           – Pure squarified treemap layout algorithm
    App.tsx              – Top-level React component (states: idle → scanning → done)
    components/
      Treemap.tsx        – Canvas-based treemap renderer with click, hover & context menu
    global.css           – Application styles
src/tests/
  treemap.test.ts        – Unit tests for the treemap algorithm
```

### How a scan works

1. The renderer generates a `scanId` and asks the main process to scan a path, with optional exclude patterns.
2. The main process walks the directory tree asynchronously, in parallel, skipping symlinks and patterns that match an exclude rule, while streaming progress events back to the UI.
3. The full folder tree (sizes, child counts, unreadable-entry counts) resolves once the walk completes; drilling into a folder in the UI re-renders a subtree of the already-scanned tree rather than re-scanning.
4. A scan can be cancelled at any time from the renderer.

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up your environment, coding conventions, and how to submit a pull request.

This project follows a [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

If you discover a security vulnerability, please see [SECURITY.md](SECURITY.md) for how to report it responsibly.

## License

HD Scanner is licensed under the [Apache License 2.0](LICENSE).
