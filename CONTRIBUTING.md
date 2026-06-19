# Contributing to HD Scanner

Thanks for your interest in contributing! This document covers how to get set up and what's expected in a pull request.

## Development setup

```bash
git clone https://github.com/photonn/hd-scanner.git
cd hd-scanner
npm ci --legacy-peer-deps   # see note in README about electron-vite/vite peer conflict
npm run dev
```

## Project layout

See the [Architecture](README.md#architecture) section of the README for an overview of the main/preload/renderer processes and key files.

## Making changes

- Keep changes focused — prefer several small, reviewable pull requests over one large one.
- Match the existing code style (TypeScript, functional React components, no added lint config — there isn't one configured yet).
- If you touch `FolderNode` or any other type shared across `main`, `preload`, and the renderer, update all the places it's duplicated (there is no shared types package yet).
- If you add a new main-process capability, wire it through `src/preload/index.ts` before using it from the renderer.

## Tests

```bash
npm test                                    # run the full suite
npx vitest run src/tests/treemap.test.ts    # run a single file
npx vitest run -t "name"                    # run tests matching a name
```

Add or update tests for any behavior change, especially to the treemap layout algorithm in `src/renderer/src/treemap.ts`, which is unit-tested in isolation from Electron/React.

## Type checking

```bash
npx tsc --noEmit -p tsconfig.node.json   # main/preload
npx tsc --noEmit -p tsconfig.web.json    # renderer
```

Both should pass with no errors before you open a pull request.

## Submitting a pull request

1. Fork the repo and create a branch off `main`.
2. Make your changes, with tests passing and both typecheck commands clean.
3. Open a pull request describing what changed and why. Link any related issue.
4. Be responsive to review feedback — small follow-up commits are fine.

## Reporting bugs / requesting features

Please use [GitHub Issues](https://github.com/photonn/hd-scanner/issues) and include your OS, Node version, and steps to reproduce for bugs.
