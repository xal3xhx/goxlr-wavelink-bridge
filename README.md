# goxlr-wavelink-bridge

> **Work in progress — not currently stable.**

Syncs GoXLR fader/mute state to Elgato Wave Link 3 channels in real time.

Connects to GoXLR Utility's WebSocket API (read-only) and Wave Link 3's JSON-RPC WebSocket API. Runs as a system tray app on Windows.

## Features

- GoXLR faders control Wave Link channel volumes
- Mute sync between GoXLR and Wave Link
- Per-fader mix targeting (Monitor / Stream / Both)
- Interactive setup UI for channel mapping
- Persistent config

## Requirements

- [GoXLR Utility](https://github.com/GoXLR-on-Linux/goxlr-utility) running
- Elgato Wave Link 3 running
- Node.js 18+

## Usage

```bash
npm install
npm start
```

## Status

Early development. Expect bugs, breaking changes, and missing features.
