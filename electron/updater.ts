import { BrowserWindow, app } from "electron";
import type { UpdateStatus } from "../shared/types.js";
import { EVENTS } from "../shared/ipc.js";
import { createLogger } from "./bridge/logger.js";

const log = createLogger("Updater");

let lastStatus: UpdateStatus = { state: "idle" };
let initialized = false;
let autoUpdater: typeof import("electron-updater").autoUpdater | null = null;

function broadcast(status: UpdateStatus): void {
  lastStatus = status;
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(EVENTS.updateStatus, status);
  }
}

async function ensureInit(): Promise<boolean> {
  if (!app.isPackaged) return false;
  if (initialized) return autoUpdater !== null;
  initialized = true;

  try {
    const mod = await import("electron-updater");
    autoUpdater = mod.autoUpdater;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on("checking-for-update", () => broadcast({ state: "checking" }));
    autoUpdater.on("update-available", (info) =>
      broadcast({
        state: "available",
        version: info.version,
        releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : undefined,
      }),
    );
    autoUpdater.on("update-not-available", () => broadcast({ state: "none" }));
    autoUpdater.on("download-progress", (p) =>
      broadcast({ state: "downloading", percent: Math.round(p.percent) }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      broadcast({ state: "ready", version: info.version }),
    );
    autoUpdater.on("error", (err) => {
      log.error("Updater error:", err.message);
      broadcast({ state: "error", message: err.message });
    });
    return true;
  } catch (e) {
    log.warn("electron-updater not available:", (e as Error).message);
    return false;
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const ok = await ensureInit();
  if (!ok || !autoUpdater) return { state: "idle" };
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    broadcast({ state: "error", message: (e as Error).message });
  }
  return lastStatus;
}

export async function downloadUpdate(): Promise<void> {
  const ok = await ensureInit();
  if (!ok || !autoUpdater) return;
  try {
    await autoUpdater.downloadUpdate();
  } catch (e) {
    broadcast({ state: "error", message: (e as Error).message });
  }
}

export function installUpdate(): void {
  if (!autoUpdater) return;
  autoUpdater.quitAndInstall();
}

export function getStatus(): UpdateStatus {
  return lastStatus;
}
