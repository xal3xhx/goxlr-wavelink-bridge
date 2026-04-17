export const IPC = {
  getConfig: "config:get",
  saveConfig: "config:save",
  getStatus: "status:get",
  getChannels: "channels:get",
  reconnect: "bridge:reconnect",
  setAutoStart: "app:set-auto-start",
  getAutoStart: "app:get-auto-start",
  quit: "app:quit",
  checkForUpdates: "update:check",
  downloadUpdate: "update:download",
  installUpdate: "update:install",
  openExternal: "app:open-external",
} as const;

export const EVENTS = {
  statusChanged: "status:changed",
  channelsChanged: "channels:changed",
  updateStatus: "update:status",
  logMessage: "log:message",
} as const;
