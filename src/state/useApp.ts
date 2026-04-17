import { useCallback, useEffect, useState } from "react";
import type {
  AppConfig,
  ChannelSnapshot,
  ConnectionStatus,
  UpdateStatus,
} from "../../shared/types";
import type { LogMessage } from "../../electron/preload";

interface AppState {
  config: AppConfig | null;
  status: ConnectionStatus | null;
  channels: ChannelSnapshot | null;
  update: UpdateStatus;
  updateLastChecked: number | null;
  latestVersion: string | null;
  logs: LogMessage[];
  autoStart: boolean;
}

const MAX_LOGS = 500;

export function useApp(): AppState & {
  saveConfig: (cfg: AppConfig) => Promise<void>;
  reconnect: () => Promise<void>;
  setAutoStart: (enabled: boolean) => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  installUpdate: () => void;
  openExternal: (url: string) => void;
  quit: () => void;
} {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [channels, setChannels] = useState<ChannelSnapshot | null>(null);
  const [update, setUpdate] = useState<UpdateStatus>({ state: "idle" });
  const [updateLastChecked, setUpdateLastChecked] = useState<number | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [autoStart, setAutoStartState] = useState(false);

  useEffect(() => {
    void (async () => {
      const [cfg, st, ch, as] = await Promise.all([
        window.api.getConfig(),
        window.api.getStatus(),
        window.api.getChannels(),
        window.api.getAutoStart(),
      ]);
      setConfig(cfg);
      setStatus(st);
      setChannels(ch);
      setAutoStartState(as);
    })();

    const offStatus = window.api.onStatusChanged(setStatus);
    const offChannels = window.api.onChannelsChanged(setChannels);
    const offUpdate = window.api.onUpdateStatus((u) => {
      setUpdate(u);
      if (u.state === "available" || u.state === "ready") {
        setLatestVersion(u.version);
      } else if (u.state === "none") {
        setLatestVersion(null);
      }
      if (u.state === "available" || u.state === "none" || u.state === "error") {
        setUpdateLastChecked(Date.now());
      }
    });
    const offLog = window.api.onLogMessage((m) => {
      setLogs((prev) => {
        const next = [...prev, m];
        if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
        return next;
      });
    });
    return () => {
      offStatus();
      offChannels();
      offUpdate();
      offLog();
    };
  }, []);

  const saveConfig = useCallback(async (cfg: AppConfig): Promise<void> => {
    await window.api.saveConfig(cfg);
    setConfig(cfg);
  }, []);

  const reconnect = useCallback(() => window.api.reconnect(), []);

  const setAutoStart = useCallback(async (enabled: boolean): Promise<void> => {
    const applied = await window.api.setAutoStart(enabled);
    setAutoStartState(applied);
  }, []);

  const checkForUpdates = useCallback(async (): Promise<void> => {
    const s = await window.api.checkForUpdates();
    setUpdate(s);
    setUpdateLastChecked(Date.now());
  }, []);

  const downloadUpdate = useCallback(() => window.api.downloadUpdate(), []);
  const installUpdate = useCallback(() => window.api.installUpdate(), []);
  const openExternal = useCallback((url: string) => {
    void window.api.openExternal(url);
  }, []);
  const quit = useCallback(() => window.api.quit(), []);

  return {
    config,
    status,
    channels,
    update,
    updateLastChecked,
    latestVersion,
    logs,
    autoStart,
    saveConfig,
    reconnect,
    setAutoStart,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    openExternal,
    quit,
  };
}
