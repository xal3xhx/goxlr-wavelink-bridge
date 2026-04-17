import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "./logger.js";

const log = createLogger("Config");

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = join(__dirname, "..", "config.json");

const DEFAULT_CONFIG = {
  goxlr: {
    url: "ws://localhost:14564/api/websocket",
    serial: null,
  },
  wavelink: {
    ws_info_path: null,
  },
  mappings: [
    {
      goxlr_fader: "A",
      goxlr_dummy_channel: "LineIn",
      wavelink_channel_name: "Mic",
      wavelink_channel_id: null,
      mix_target: "both",
      sync_volume: true,
      sync_mute: true,
    },
    {
      goxlr_fader: "B",
      goxlr_dummy_channel: "Console",
      wavelink_channel_name: "Music",
      wavelink_channel_id: null,
      mix_target: "both",
      sync_volume: true,
      sync_mute: true,
    },
    {
      goxlr_fader: "C",
      goxlr_dummy_channel: "Game",
      wavelink_channel_name: "System",
      wavelink_channel_id: null,
      mix_target: "monitor",
      sync_volume: true,
      sync_mute: true,
    },
    {
      goxlr_fader: "D",
      goxlr_dummy_channel: "Chat",
      wavelink_channel_name: "Discord",
      wavelink_channel_id: null,
      mix_target: "both",
      sync_volume: true,
      sync_mute: true,
    },
  ],
  options: {
    volume_write_interval_ms: 16,
    reconnect_interval_ms: 3000,
    echo_suppress_ms: 500,
    start_minimized: true,
  },
};

const VALID_FADERS = ["A", "B", "C", "D"];
const VALID_MIX_TARGETS = ["monitor", "stream", "both"];
const VALID_GOXLR_CHANNELS = [
  "Mic", "LineIn", "Console", "System", "Game", "Chat", "Sample", "Music",
  "Headphones", "MicMonitor", "LineOut",
];

export function load() {
  if (!existsSync(CONFIG_PATH)) {
    log.info("No config.json found, creating default...");
    save(DEFAULT_CONFIG);
    return structuredClone(DEFAULT_CONFIG);
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    const merged = {
      goxlr: { ...DEFAULT_CONFIG.goxlr, ...cfg.goxlr },
      wavelink: { ...DEFAULT_CONFIG.wavelink, ...cfg.wavelink },
      mappings: Array.isArray(cfg.mappings) ? cfg.mappings : DEFAULT_CONFIG.mappings,
      options: { ...DEFAULT_CONFIG.options, ...cfg.options },
    };
    validate(merged);
    log.info("Config loaded");
    return merged;
  } catch (e) {
    log.error(`Failed to load config: ${e.message}`);
    log.info("Using default config");
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function save(config) {
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  log.info("Config saved");
}

export function validate(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object");
  if (!Array.isArray(config.mappings)) throw new Error("mappings must be an array");

  for (let i = 0; i < config.mappings.length; i++) {
    const m = config.mappings[i];
    if (!VALID_FADERS.includes(m.goxlr_fader)) {
      throw new Error(`mappings[${i}].goxlr_fader must be A, B, C, or D`);
    }
    if (!VALID_GOXLR_CHANNELS.includes(m.goxlr_dummy_channel)) {
      throw new Error(`mappings[${i}].goxlr_dummy_channel "${m.goxlr_dummy_channel}" is not valid`);
    }
    if (!m.wavelink_channel_name || typeof m.wavelink_channel_name !== "string") {
      throw new Error(`mappings[${i}].wavelink_channel_name is required`);
    }
    if (!VALID_MIX_TARGETS.includes(m.mix_target)) {
      throw new Error(`mappings[${i}].mix_target must be monitor, stream, or both`);
    }
  }
}

export function getConfigPath() {
  return CONFIG_PATH;
}
