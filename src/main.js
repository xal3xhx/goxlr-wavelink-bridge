import { GoXLRClient } from "./goxlr-client.js";
import { WaveLinkClient } from "./wavelink-client.js";
import { Bridge } from "./bridge.js";
import { ConfigServer } from "./config-server.js";
import { Tray } from "./tray.js";
import * as config from "./config.js";
import { createLogger, setLevel } from "./logger.js";

const log = createLogger("Main");

// ── Load Config ─────────────────────────────────────────────────────

let cfg = config.load();
setLevel(cfg.options?.log_level || "info");

log.info("GoXLR-WaveLink Bridge v1.0.0");

// ── Create Clients ──────────────────────────────────────────────────

const goxlr = new GoXLRClient({
  url: cfg.goxlr.url,
  serial: cfg.goxlr.serial,
  reconnectMs: cfg.options.reconnect_interval_ms,
});

const wavelink = new WaveLinkClient({
  wsInfoPath: cfg.wavelink.ws_info_path,
  reconnectMs: cfg.options.reconnect_interval_ms,
});

// ── Create Bridge ───────────────────────────────────────────────────

const bridge = new Bridge(goxlr, wavelink, cfg);

// ── Config Server ───────────────────────────────────────────────────

const configServer = new ConfigServer({
  goxlr,
  wavelink,
  getConfig: () => cfg,
  saveConfig: (newCfg) => {
    config.save(newCfg);
    cfg = newCfg;
  },
  onConfigUpdated: (newCfg) => {
    bridge.updateMappings(newCfg.mappings);
    log.info("Configuration updated from UI");
  },
});

configServer.start();

// ── Status Tracking ─────────────────────────────────────────────────

let goxlrConnected = false;
let wavelinkConnected = false;
let tray = null;

function getStatusText() {
  const g = goxlrConnected ? "Connected" : "Disconnected";
  const w = wavelinkConnected ? "Connected" : "Disconnected";
  return `GoXLR: ${g} | Wave Link: ${w}`;
}

function getTrayIcon() {
  if (goxlrConnected && wavelinkConnected) return "connected";
  if (goxlrConnected || wavelinkConnected) return "partial";
  return "disconnected";
}

function updateTray() {
  if (!tray) return;
  tray.update({
    status: getStatusText(),
    icon: getTrayIcon(),
    tooltip: `GoXLR-WaveLink Bridge\n${getStatusText()}`,
  });
}

goxlr.on("connected", () => {
  goxlrConnected = true;
  log.info(getStatusText());
  updateTray();
});

goxlr.on("disconnected", () => {
  goxlrConnected = false;
  log.info(getStatusText());
  updateTray();
});

wavelink.on("connected", () => {
  wavelinkConnected = true;
  log.info(getStatusText());
  updateTray();
});

wavelink.on("disconnected", () => {
  wavelinkConnected = false;
  log.info(getStatusText());
  updateTray();
});

// ── System Tray ─────────────────────────────────────────────────────

(async () => {
  try {
    tray = new Tray();
    await tray.start();

    tray.on("action", async (action) => {
      if (action === "configure") {
        const url = configServer.url;
        if (url) {
          const open = (await import("open")).default;
          open(url);
        }
      } else if (action === "reconnect") {
        log.info("Forcing reconnect...");
        goxlr.disconnect();
        wavelink.disconnect();
        setTimeout(() => {
          goxlr.connect();
          wavelink.connect();
        }, 500);
      } else if (action === "quit") {
        shutdown();
      }
    });

    updateTray();
  } catch (e) {
    log.warn(`Failed to create system tray: ${e.message}`);
    log.info("Running without system tray (console mode)");
    tray = null;
  }
})();

// ── Start ───────────────────────────────────────────────────────────

bridge.start();
goxlr.connect();
wavelink.connect();

log.info("Bridge started. Press Ctrl+C to quit.");

// ── Graceful Shutdown ───────────────────────────────────────────────

function shutdown() {
  log.info("Shutting down...");
  bridge.stop();
  goxlr.disconnect();
  wavelink.disconnect();
  configServer.stop();
  if (tray) {
    tray.kill();
  }
  setTimeout(() => process.exit(0), 600);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Keep process alive
setInterval(() => {}, 60000);
