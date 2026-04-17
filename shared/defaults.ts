import type { AppConfig } from "./types.js";

export const DEFAULT_CONFIG: AppConfig = {
  goxlr: {
    url: "ws://localhost:14564/api/websocket",
    serial: null,
  },
  wavelink: {
    ws_info_path: null,
  },
  mappings: [],
  options: {
    volume_write_interval_ms: 16,
    reconnect_interval_ms: 3000,
    echo_suppress_ms: 500,
    start_minimized: true,
    start_on_login: false,
    log_level: "info",
    auto_update: true,
  },
};
