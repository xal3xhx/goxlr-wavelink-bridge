# goxlr-wavelink-bridge

> **Work in progress — not currently stable.**

Syncs GoXLR fader/mute state to Elgato Wave Link 3 channels in real time.

Packaged as a single Electron desktop app with a tray icon, auto-update, and
auto-start on login. Talks to GoXLR Utility's WebSocket API and Wave Link 3's
JSON-RPC WebSocket API under the hood.

## Features

- GoXLR faders drive Wave Link channel volumes (bidirectional)
- Mute sync between GoXLR and Wave Link
- Per-fader mix targeting (Monitor / Stream / Both)
- Modern dark UI with live status, mapping editor, and log viewer
- Persistent config stored in the user profile
- Runs in the system tray; start on login; auto-updates from GitHub releases

## Requirements

- [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) running
- Elgato Wave Link 3 running
- Windows 10/11 (installer only builds a Windows target today)

## Development

```bash
npm install
npm run dev       # electron-vite dev
npm run typecheck # tsc for main + renderer
npm run build     # bundle main/preload/renderer
npm run dist      # produce NSIS installer in release/
```

## Status

Early development. Expect bugs, breaking changes, and missing features.
