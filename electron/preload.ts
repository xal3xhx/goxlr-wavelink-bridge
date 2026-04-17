import { contextBridge, ipcRenderer } from "electron";
import { IPC, EVENTS } from "../shared/ipc.js";
import type {
  AppConfig,
  ConnectionStatus,
  ChannelSnapshot,
  UpdateStatus,
} from "../shared/types.js";

export interface LogMessage {
  level: "debug" | "info" | "warn" | "error";
  tag: string;
  message: string;
  time: number;
}

const api = {
  getConfig: (): Promise<AppConfig> => ipcRenderer.invoke(IPC.getConfig),
  saveConfig: (cfg: AppConfig): Promise<void> =>
    ipcRenderer.invoke(IPC.saveConfig, cfg),
  getStatus: (): Promise<ConnectionStatus> => ipcRenderer.invoke(IPC.getStatus),
  getChannels: (): Promise<ChannelSnapshot> =>
    ipcRenderer.invoke(IPC.getChannels),
  reconnect: (): Promise<void> => ipcRenderer.invoke(IPC.reconnect),
  setAutoStart: (enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.setAutoStart, enabled),
  getAutoStart: (): Promise<boolean> => ipcRenderer.invoke(IPC.getAutoStart),
  quit: (): void => {
    ipcRenderer.send(IPC.quit);
  },
  checkForUpdates: (): Promise<UpdateStatus> =>
    ipcRenderer.invoke(IPC.checkForUpdates),
  downloadUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.downloadUpdate),
  installUpdate: (): void => {
    ipcRenderer.send(IPC.installUpdate);
  },
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke(IPC.openExternal, url),

  onStatusChanged: (cb: (s: ConnectionStatus) => void): (() => void) => {
    const listener = (_: unknown, s: ConnectionStatus): void => cb(s);
    ipcRenderer.on(EVENTS.statusChanged, listener);
    return () => ipcRenderer.off(EVENTS.statusChanged, listener);
  },
  onChannelsChanged: (cb: (c: ChannelSnapshot) => void): (() => void) => {
    const listener = (_: unknown, c: ChannelSnapshot): void => cb(c);
    ipcRenderer.on(EVENTS.channelsChanged, listener);
    return () => ipcRenderer.off(EVENTS.channelsChanged, listener);
  },
  onUpdateStatus: (cb: (u: UpdateStatus) => void): (() => void) => {
    const listener = (_: unknown, u: UpdateStatus): void => cb(u);
    ipcRenderer.on(EVENTS.updateStatus, listener);
    return () => ipcRenderer.off(EVENTS.updateStatus, listener);
  },
  onLogMessage: (cb: (m: LogMessage) => void): (() => void) => {
    const listener = (_: unknown, m: LogMessage): void => cb(m);
    ipcRenderer.on(EVENTS.logMessage, listener);
    return () => ipcRenderer.off(EVENTS.logMessage, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type BridgeApi = typeof api;
