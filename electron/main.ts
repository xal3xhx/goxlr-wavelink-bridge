import {
  app,
  BrowserWindow,
  Menu,
  Tray,
  ipcMain,
  shell,
  nativeImage,
  type MenuItemConstructorOptions,
} from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { AppConfig, ConnectionStatus, ChannelSnapshot } from "../shared/types.js";
import { IPC, EVENTS } from "../shared/ipc.js";
import { loadConfig, saveConfig } from "./config-store.js";
import { BridgeManager } from "./bridge-manager.js";
import { addSink, createLogger } from "./bridge/logger.js";
import * as updater from "./updater.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger("Main");

const iconsDir = app.isPackaged
  ? join(process.resourcesPath, "icons")
  : join(__dirname, "../../icons");

function iconPath(name: "connected" | "disconnected" | "partial"): string {
  return join(iconsDir, `icon-${name}.ico`);
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let manager: BridgeManager | null = null;
let config: AppConfig = loadConfig();
let quitting = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
  void app.whenReady().then(init);
}

function init(): void {
  manager = new BridgeManager(config);

  manager.on("status", (s: ConnectionStatus) => {
    broadcast(EVENTS.statusChanged, s);
    updateTrayIcon(s);
  });
  manager.on("channels", (c: ChannelSnapshot) => broadcast(EVENTS.channelsChanged, c));

  addSink((level, tag, message) => {
    broadcast(EVENTS.logMessage, { level, tag, message, time: Date.now() });
  });

  registerIpc();
  createTray();
  createWindow();
  manager.start();

  applyAutoStart(config.options.start_on_login);

  if (config.options.auto_update) {
    setTimeout(() => {
      void updater.checkForUpdates();
    }, 5000);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    show: !config.options.start_minimized,
    autoHideMenuBar: true,
    backgroundColor: "#0a0a0a",
    icon: iconPath("connected"),
    webPreferences: {
      preload: join(__dirname, "../preload/preload.mjs"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    if (!config.options.start_minimized) mainWindow?.show();
  });

  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

function showWindow(): void {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const img = nativeImage.createFromPath(iconPath("disconnected"));
  tray = new Tray(img);
  tray.setToolTip("GoXLR-WaveLink Bridge");
  tray.on("click", () => showWindow());
  tray.on("double-click", () => showWindow());
  rebuildTrayMenu({ goxlr: false, wavelink: false });
}

function rebuildTrayMenu(state: { goxlr: boolean; wavelink: boolean }): void {
  if (!tray) return;
  const items: MenuItemConstructorOptions[] = [
    { label: "GoXLR-WaveLink Bridge", enabled: false },
    { type: "separator" },
    { label: `GoXLR: ${state.goxlr ? "connected" : "disconnected"}`, enabled: false },
    { label: `Wave Link: ${state.wavelink ? "connected" : "disconnected"}`, enabled: false },
    { type: "separator" },
    { label: "Open", click: () => showWindow() },
    { label: "Reconnect", click: () => manager?.reconnect() },
    { label: "Check for Updates", click: () => void updater.checkForUpdates() },
    { type: "separator" },
    {
      label: "Quit",
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function updateTrayIcon(status: ConnectionStatus): void {
  if (!tray) return;
  const g = status.goxlr.connected;
  const w = status.wavelink.connected;
  const name: "connected" | "disconnected" | "partial" =
    g && w ? "connected" : g || w ? "partial" : "disconnected";
  tray.setImage(nativeImage.createFromPath(iconPath(name)));
  tray.setToolTip(
    `GoXLR-WaveLink Bridge\nGoXLR: ${g ? "connected" : "offline"}\nWave Link: ${w ? "connected" : "offline"}`,
  );
  rebuildTrayMenu({ goxlr: g, wavelink: w });
}

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

function applyAutoStart(enabled: boolean): void {
  if (process.platform !== "win32" && process.platform !== "darwin") return;
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: ["--hidden"],
  });
}

function registerIpc(): void {
  ipcMain.handle(IPC.getConfig, () => config);

  ipcMain.handle(IPC.saveConfig, (_e, next: AppConfig) => {
    config = next;
    saveConfig(next);
    manager?.applyConfig(next);
    applyAutoStart(next.options.start_on_login);
  });

  ipcMain.handle(IPC.getStatus, () => manager?.getStatus() ?? emptyStatus());
  ipcMain.handle(IPC.getChannels, () => manager?.getChannels() ?? emptyChannels());
  ipcMain.handle(IPC.reconnect, () => manager?.reconnect());

  ipcMain.handle(IPC.setAutoStart, (_e, enabled: boolean) => {
    applyAutoStart(enabled);
    return app.getLoginItemSettings().openAtLogin;
  });
  ipcMain.handle(IPC.getAutoStart, () => app.getLoginItemSettings().openAtLogin);

  ipcMain.on(IPC.quit, () => {
    quitting = true;
    app.quit();
  });

  ipcMain.handle(IPC.checkForUpdates, () => updater.checkForUpdates());
  ipcMain.handle(IPC.downloadUpdate, () => updater.downloadUpdate());
  ipcMain.on(IPC.installUpdate, () => updater.installUpdate());

  ipcMain.handle(IPC.openExternal, (_e, url: string) => shell.openExternal(url));
}

function emptyStatus(): ConnectionStatus {
  return {
    goxlr: { connected: false, serial: null, faders: null },
    wavelink: { connected: false, channels: [], mixes: [] },
  };
}

function emptyChannels(): ChannelSnapshot {
  return {
    wavelink_channels: [],
    wavelink_mixes: [],
    goxlr_faders: {},
    goxlr_volumes: {},
  };
}

app.on("before-quit", () => {
  quitting = true;
  manager?.stop();
});

app.on("window-all-closed", () => {
  // Keep running in tray
});

process.on("uncaughtException", (err) => log.error("uncaughtException:", err));
process.on("unhandledRejection", (err) => log.error("unhandledRejection:", err));
