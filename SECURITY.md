# Security Policy

## Supported Versions

HD Scanner is currently pre-1.0 and does not yet maintain multiple supported release branches. Security fixes are applied to `main`.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public issue**. Instead, report it privately via [GitHub Security Advisories](https://github.com/photonn/hd-scanner/security/advisories/new) for this repository.

Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce, or a proof of concept
- The affected version/commit and platform (Windows/macOS/Linux)

We'll acknowledge your report and aim to provide an initial assessment within a few days. Once a fix is available, we'll coordinate disclosure with you.

## Scope notes

HD Scanner is an Electron desktop app that scans the local filesystem and can move files to the trash. Particularly relevant areas for security review:

- `src/main/index.ts` — the only place with `fs`/`dialog`/`shell` access
- `src/preload/index.ts` — the context-bridge boundary between the renderer and main process
