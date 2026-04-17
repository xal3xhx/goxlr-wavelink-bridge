import Store from "electron-store";
import type { AppConfig } from "../shared/types.js";
import { DEFAULT_CONFIG } from "../shared/defaults.js";

type StoreSchema = { config: AppConfig };

const store = new Store<StoreSchema>({
  name: "config",
  defaults: { config: DEFAULT_CONFIG },
  clearInvalidConfig: true,
});

function merge(base: AppConfig, partial: Partial<AppConfig>): AppConfig {
  return {
    goxlr: { ...base.goxlr, ...(partial.goxlr ?? {}) },
    wavelink: { ...base.wavelink, ...(partial.wavelink ?? {}) },
    mappings: partial.mappings ?? base.mappings,
    options: { ...base.options, ...(partial.options ?? {}) },
  };
}

export function loadConfig(): AppConfig {
  const stored = store.get("config");
  return merge(DEFAULT_CONFIG, stored ?? {});
}

export function saveConfig(cfg: AppConfig): void {
  store.set("config", cfg);
}

export function configPath(): string {
  return store.path;
}
