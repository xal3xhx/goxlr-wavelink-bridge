import { EventEmitter } from "node:events";
import type { AppConfig, ChannelSnapshot, ConnectionStatus } from "../shared/types.js";
import { createLogger, setLevel, type LogLevel } from "./bridge/logger.js";
import { GoXLRClient } from "./bridge/goxlr-client.js";
import { WaveLinkClient } from "./bridge/wavelink-client.js";
import { Bridge } from "./bridge/bridge.js";

const log = createLogger("Manager");

type Events = {
  status: [ConnectionStatus];
  channels: [ChannelSnapshot];
};

export class BridgeManager extends EventEmitter {
  #config: AppConfig;
  #goxlr: GoXLRClient;
  #wavelink: WaveLinkClient;
  #bridge: Bridge;
  #emitTimer: NodeJS.Timeout | null = null;

  constructor(config: AppConfig) {
    super();
    this.#config = config;
    setLevel(config.options.log_level);

    this.#goxlr = new GoXLRClient({
      url: config.goxlr.url,
      serial: config.goxlr.serial,
      reconnectMs: config.options.reconnect_interval_ms,
    });
    this.#wavelink = new WaveLinkClient({
      wsInfoPath: config.wavelink.ws_info_path,
      reconnectMs: config.options.reconnect_interval_ms,
    });
    this.#bridge = new Bridge(this.#goxlr, this.#wavelink, config);

    this.#wireStateEvents();
  }

  override on<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    return super.emit(event, ...args);
  }

  start(): void {
    log.info("Starting bridge manager");
    this.#bridge.start();
    this.#goxlr.connect();
    this.#wavelink.connect();
  }

  stop(): void {
    log.info("Stopping bridge manager");
    if (this.#emitTimer) clearTimeout(this.#emitTimer);
    this.#emitTimer = null;
    this.#bridge.stop();
    this.#goxlr.disconnect();
    this.#wavelink.disconnect();
  }

  applyConfig(next: AppConfig): void {
    const prev = this.#config;
    this.#config = next;

    if (prev.options.log_level !== next.options.log_level) {
      setLevel(next.options.log_level);
    }

    const goxlrChanged =
      prev.goxlr.url !== next.goxlr.url || prev.goxlr.serial !== next.goxlr.serial;
    const wlChanged = prev.wavelink.ws_info_path !== next.wavelink.ws_info_path;

    this.#bridge.updateMappings(next.mappings);
    this.#bridge.updateEchoSuppressMs(next.options.echo_suppress_ms);

    if (goxlrChanged || wlChanged) {
      this.reconnect();
    }

    this.#scheduleEmit();
  }

  reconnect(): void {
    log.info("Reconnecting clients");
    this.#goxlr.disconnect();
    this.#wavelink.disconnect();
    this.#goxlr = new GoXLRClient({
      url: this.#config.goxlr.url,
      serial: this.#config.goxlr.serial,
      reconnectMs: this.#config.options.reconnect_interval_ms,
    });
    this.#wavelink = new WaveLinkClient({
      wsInfoPath: this.#config.wavelink.ws_info_path,
      reconnectMs: this.#config.options.reconnect_interval_ms,
    });
    this.#bridge.stop();
    this.#bridge = new Bridge(this.#goxlr, this.#wavelink, this.#config);
    this.#bridge.start();
    this.#wireStateEvents();
    this.#goxlr.connect();
    this.#wavelink.connect();
  }

  getStatus(): ConnectionStatus {
    const mixer = this.#goxlr.mixer;
    const faders = mixer?.fader_status
      ? Object.fromEntries(
          Object.entries(mixer.fader_status).map(([k, v]) => [
            k,
            { channel: v.channel, mute_state: v.mute_state },
          ]),
        )
      : null;

    return {
      goxlr: {
        connected: this.#goxlr.connected,
        serial: this.#goxlr.serial,
        faders,
      },
      wavelink: {
        connected: this.#wavelink.connected,
        channels: this.#wavelink.channels.map((c) => ({ id: c.id, name: c.name })),
        mixes: this.#wavelink.mixes.map((m) => ({ id: m.id, name: m.name })),
      },
    };
  }

  getChannels(): ChannelSnapshot {
    const mixer = this.#goxlr.mixer;
    const volumes = mixer?.levels?.volumes ?? {};
    const faders = mixer?.fader_status
      ? Object.fromEntries(
          Object.entries(mixer.fader_status).map(([k, v]) => [
            k,
            { channel: v.channel, mute_state: v.mute_state },
          ]),
        )
      : {};

    return {
      wavelink_channels: this.#wavelink.channels.map((c) => ({
        id: c.id,
        name: c.name,
        level: Number(c.level ?? c.volume ?? 0),
        isMuted: Boolean(c.isMuted ?? c.muted ?? false),
        mixes: (c.mixes ?? []).map((m) => ({
          id: m.id,
          level: Number(m.level ?? m.volume ?? 0),
          isMuted: Boolean(m.isMuted ?? m.muted ?? false),
        })),
      })),
      wavelink_mixes: this.#wavelink.mixes.map((m) => ({
        id: m.id,
        name: m.name,
        level: Number(m.level ?? m.volume ?? 0),
      })),
      goxlr_faders: faders,
      goxlr_volumes: { ...volumes },
    };
  }

  #wireStateEvents(): void {
    const onStatusChange = (): void => this.#scheduleEmit();
    this.#goxlr.on("connected", onStatusChange);
    this.#goxlr.on("disconnected", onStatusChange);
    this.#goxlr.on("volume_changed", onStatusChange);
    this.#goxlr.on("mute_changed", onStatusChange);
    this.#wavelink.on("connected", onStatusChange);
    this.#wavelink.on("disconnected", onStatusChange);
    this.#wavelink.on("volume_changed", onStatusChange);
    this.#wavelink.on("mute_changed", onStatusChange);
    this.#wavelink.on("mix_volume_changed", onStatusChange);
  }

  #scheduleEmit(): void {
    if (this.#emitTimer) return;
    this.#emitTimer = setTimeout(() => {
      this.#emitTimer = null;
      this.emit("status", this.getStatus());
      this.emit("channels", this.getChannels());
    }, 50);
  }

  setLogLevel(level: LogLevel): void {
    setLevel(level);
  }
}
