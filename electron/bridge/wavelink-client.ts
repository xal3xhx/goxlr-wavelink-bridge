import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { createLogger } from "./logger.js";

const log = createLogger("WaveLink");

const ORIGIN = "streamdeck://";
const CONNECT_TIMEOUT_MS = 2000;
const APP_INFO_TIMEOUT_MS = 1500;
const VOLUME_WRITE_INTERVAL_MS = 16;
const VOLUME_WRITE_EPSILON = 0.002;
const STATE_REFRESH_DEBOUNCE_MS = 120;

function clamp01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export interface MixEntry {
  id: string;
  level?: number;
  volume?: number;
  isMuted?: boolean;
  muted?: boolean;
}

export interface WaveLinkChannel {
  id: string;
  name: string;
  level?: number;
  volume?: number;
  isMuted?: boolean;
  muted?: boolean;
  mixes?: MixEntry[];
}

export interface WaveLinkMix {
  id: string;
  name: string;
  level?: number;
  volume?: number;
  isMuted?: boolean;
  muted?: boolean;
}

export interface WaveLinkVolumeChangedEvent {
  channelId: string;
  channelName: string;
  level: number;
  mixId: string | null;
}

export interface WaveLinkMuteChangedEvent {
  channelId: string;
  channelName: string;
  isMuted: boolean;
  mixId: string | null;
}

export interface WaveLinkMixVolumeChangedEvent {
  mixId: string;
  mixName: string;
  level: number;
}

export interface WaveLinkClientOptions {
  wsInfoPath?: string | null;
  reconnectMs?: number;
}

type Events = {
  connected: [{ channels: WaveLinkChannel[]; mixes: WaveLinkMix[] }];
  disconnected: [];
  volume_changed: [WaveLinkVolumeChangedEvent];
  mute_changed: [WaveLinkMuteChangedEvent];
  mix_volume_changed: [WaveLinkMixVolumeChangedEvent];
};

interface Endpoint {
  identifier: string;
  mixer_id: string;
}

interface PendingWrite {
  endpoint: Endpoint;
  level: number;
}

interface RpcRequest {
  jsonrpc: "2.0";
  method: string;
  id: number;
  params?: Record<string, unknown>;
}

interface RpcMessage {
  id?: number;
  method?: string;
  result?: unknown;
}

export class WaveLinkClient extends EventEmitter {
  #ws: WebSocket | null = null;
  #port: number | null = null;
  #wsInfoPath: string | null;
  #reconnectMs: number;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #intentionalClose = false;
  #rpcSeq = 10;

  #channels: WaveLinkChannel[] = [];
  #mixes: WaveLinkMix[] = [];

  #pendingWrites = new Map<string, PendingWrite>();
  #lastSentVolume = new Map<string, number>();
  #flushTimer: NodeJS.Timeout | null = null;
  #flushInFlight = false;

  #channelsRefreshTimer: NodeJS.Timeout | null = null;
  #mixesRefreshTimer: NodeJS.Timeout | null = null;

  #appInfoResolve: ((result: unknown) => void) | null = null;
  #appInfoTimer: NodeJS.Timeout | null = null;

  constructor({ wsInfoPath = null, reconnectMs = 3000 }: WaveLinkClientOptions = {}) {
    super();
    this.#wsInfoPath = wsInfoPath ?? this.#defaultWsInfoPath();
    this.#reconnectMs = reconnectMs;
  }

  override on<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override off<K extends keyof Events>(
    event: K,
    listener: (...args: Events[K]) => void,
  ): this {
    return super.off(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof Events>(event: K, ...args: Events[K]): boolean {
    return super.emit(event, ...args);
  }

  get connected(): boolean {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  get channels(): WaveLinkChannel[] {
    return this.#channels;
  }

  get mixes(): WaveLinkMix[] {
    return this.#mixes;
  }

  connect(): void {
    this.#intentionalClose = false;
    void this.#tryConnect();
  }

  disconnect(): void {
    this.#intentionalClose = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#cleanup();
  }

  setChannelVolume(channelId: string, level: number): void {
    this.#queueVolumeWrite({ identifier: channelId, mixer_id: "" }, clamp01(level));
  }

  setChannelMixVolume(channelId: string, mixId: string, level: number): void {
    this.#queueVolumeWrite({ identifier: channelId, mixer_id: mixId }, clamp01(level));
  }

  setMixVolume(mixId: string, level: number): void {
    this.#queueVolumeWrite({ identifier: "", mixer_id: mixId }, clamp01(level));
  }

  async setChannelMute(channelId: string, isMuted: boolean): Promise<void> {
    await this.#sendRpc("setChannel", { id: channelId, isMuted: Boolean(isMuted) });
  }

  async setChannelMixMute(channelId: string, mixId: string, isMuted: boolean): Promise<void> {
    await this.#sendRpc("setChannel", {
      id: channelId,
      mixes: [{ id: mixId, isMuted: Boolean(isMuted) }],
    });
  }

  async setMixMute(mixId: string, isMuted: boolean): Promise<void> {
    await this.#sendRpc("setMix", { id: mixId, isMuted: Boolean(isMuted) });
  }

  findChannelByName(name: string): WaveLinkChannel | null {
    const lower = name.toLowerCase();
    return this.#channels.find((c) => c.name?.toLowerCase() === lower) ?? null;
  }

  findMixByName(name: string): WaveLinkMix | null {
    const lower = name.toLowerCase();
    return this.#mixes.find((m) => m.name?.toLowerCase() === lower) ?? null;
  }

  #defaultWsInfoPath(): string | null {
    const appdata = process.env.APPDATA;
    if (!appdata) return null;
    const base = join(appdata, "..", "Local");
    return join(base, "Packages", "Elgato.WaveLink_g54w8ztgkx496", "LocalState", "ws-info.json");
  }

  #readPort(): number | null {
    if (!this.#wsInfoPath) {
      log.error("No ws-info.json path configured");
      return null;
    }
    try {
      const text = readFileSync(this.#wsInfoPath, "utf-8");
      const info = JSON.parse(text) as { port?: unknown };
      const port = Number(info.port);
      if (Number.isFinite(port) && port > 0 && port <= 65535) {
        return Math.trunc(port);
      }
    } catch (e) {
      log.warn(`Cannot read ws-info.json: ${(e as Error).message}`);
    }
    return null;
  }

  async #tryConnect(): Promise<void> {
    const port = this.#readPort();
    if (!port) {
      log.warn("Wave Link port not found, will retry...");
      this.#scheduleReconnect();
      return;
    }

    log.info(`Connecting to ws://127.0.0.1:${port}...`);

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`, {
        headers: { Origin: ORIGIN },
        handshakeTimeout: CONNECT_TIMEOUT_MS,
      });

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          ws.close();
          resolve(false);
        }, CONNECT_TIMEOUT_MS);

        ws.on("open", () => {
          clearTimeout(timeout);
          resolve(true);
        });
        ws.on("error", () => {
          clearTimeout(timeout);
          resolve(false);
        });
      });

      if (!connected) {
        log.warn("Connection failed");
        this.#scheduleReconnect();
        return;
      }

      this.#ws = ws;
      this.#port = port;

      ws.on("message", (raw: WebSocket.RawData) => {
        let msg: unknown;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this.#handleMessage(msg as RpcMessage);
      });

      ws.on("close", () => {
        if (this.#ws === ws) {
          log.warn("Disconnected");
          this.#cleanup();
          this.emit("disconnected");
          this.#scheduleReconnect();
        }
      });

      ws.on("error", (err: Error) => {
        log.error("WebSocket error:", err.message);
      });

      const verified = await this.#verifyAppInfo();
      if (!verified) {
        log.warn("Failed to verify Wave Link application info");
        ws.close();
        this.#scheduleReconnect();
        return;
      }

      log.info(`Connected to Wave Link on port ${port}`);

      await this.#requestFullState();

      this.emit("connected", { channels: this.#channels, mixes: this.#mixes });
    } catch (e) {
      log.error("Connection error:", (e as Error).message);
      this.#scheduleReconnect();
    }
  }

  async #verifyAppInfo(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.#appInfoTimer = setTimeout(() => {
        this.#appInfoResolve = null;
        resolve(false);
      }, APP_INFO_TIMEOUT_MS);

      this.#appInfoResolve = (result: unknown) => {
        if (this.#appInfoTimer) clearTimeout(this.#appInfoTimer);
        this.#appInfoResolve = null;
        this.#appInfoTimer = null;
        resolve(result != null && typeof result === "object");
      };

      this.#sendRaw({ jsonrpc: "2.0", method: "getApplicationInfo", id: 1 });
    });
  }

  async #requestFullState(): Promise<void> {
    this.#sendRaw({ jsonrpc: "2.0", method: "getMixes", id: 2 });
    this.#sendRaw({ jsonrpc: "2.0", method: "getChannels", id: 3 });
    await new Promise((r) => setTimeout(r, 200));
  }

  #handleMessage(msg: RpcMessage): void {
    if (!msg || typeof msg !== "object") return;

    const id = msg.id;

    if (id === 1) {
      if (this.#appInfoResolve) this.#appInfoResolve(msg.result ?? null);
      return;
    }

    if (id === 2) {
      const result = msg.result as { mixes?: WaveLinkMix[] } | WaveLinkMix[] | undefined;
      const payload = Array.isArray(result) ? result : result?.mixes;
      if (Array.isArray(payload)) {
        const prevMixes = this.#mixes;
        this.#mixes = payload;
        this.#emitMixChanges(prevMixes, payload);
        log.info(`Received ${payload.length} mixes: ${payload.map((m) => m.name).join(", ")}`);
      }
      return;
    }

    if (id === 3) {
      const result = msg.result as { channels?: WaveLinkChannel[] } | WaveLinkChannel[] | undefined;
      const payload = Array.isArray(result) ? result : result?.channels;
      if (Array.isArray(payload)) {
        const prevChannels = this.#channels;
        this.#channels = payload;
        this.#emitChannelChanges(prevChannels, payload);
        log.info(`Received ${payload.length} channels: ${payload.map((c) => c.name).join(", ")}`);
      }
      return;
    }

    if (msg.method) {
      if (msg.method === "channelsChanged" || msg.method === "channelChanged") {
        this.#scheduleChannelsRefresh();
      }
      if (msg.method === "mixesChanged" || msg.method === "mixChanged") {
        this.#scheduleMixesRefresh();
      }
    }
  }

  #emitChannelChanges(prev: WaveLinkChannel[], next: WaveLinkChannel[]): void {
    for (const ch of next) {
      const old = prev.find((c) => c.id === ch.id);
      if (!old) continue;

      const oldLevel = old.level ?? old.volume;
      const newLevel = ch.level ?? ch.volume;
      if (
        oldLevel != null &&
        newLevel != null &&
        Math.abs(oldLevel - newLevel) > VOLUME_WRITE_EPSILON
      ) {
        this.emit("volume_changed", {
          channelId: ch.id,
          channelName: ch.name,
          level: clamp01(newLevel),
          mixId: null,
        });
      }

      const oldMuted = old.isMuted ?? old.muted;
      const newMuted = ch.isMuted ?? ch.muted;
      if (oldMuted !== newMuted && typeof newMuted === "boolean") {
        this.emit("mute_changed", {
          channelId: ch.id,
          channelName: ch.name,
          isMuted: newMuted,
          mixId: null,
        });
      }

      if (Array.isArray(ch.mixes) && Array.isArray(old.mixes)) {
        for (const mixEntry of ch.mixes) {
          const oldEntry = old.mixes.find((m) => m.id === mixEntry.id);
          if (!oldEntry) continue;

          const oel = oldEntry.level ?? oldEntry.volume;
          const nel = mixEntry.level ?? mixEntry.volume;
          if (
            oel != null &&
            nel != null &&
            Math.abs(oel - nel) > VOLUME_WRITE_EPSILON
          ) {
            this.emit("volume_changed", {
              channelId: ch.id,
              channelName: ch.name,
              level: clamp01(nel),
              mixId: mixEntry.id,
            });
          }

          const om = oldEntry.isMuted ?? oldEntry.muted;
          const nm = mixEntry.isMuted ?? mixEntry.muted;
          if (om !== nm && typeof nm === "boolean") {
            this.emit("mute_changed", {
              channelId: ch.id,
              channelName: ch.name,
              isMuted: nm,
              mixId: mixEntry.id,
            });
          }
        }
      }
    }
  }

  #emitMixChanges(prev: WaveLinkMix[], next: WaveLinkMix[]): void {
    for (const mix of next) {
      const old = prev.find((m) => m.id === mix.id);
      if (!old) continue;

      const oldLevel = old.level ?? old.volume;
      const newLevel = mix.level ?? mix.volume;
      if (
        oldLevel != null &&
        newLevel != null &&
        Math.abs(oldLevel - newLevel) > VOLUME_WRITE_EPSILON
      ) {
        this.emit("mix_volume_changed", {
          mixId: mix.id,
          mixName: mix.name,
          level: clamp01(newLevel),
        });
      }
    }
  }

  #scheduleChannelsRefresh(): void {
    if (this.#channelsRefreshTimer) return;
    this.#channelsRefreshTimer = setTimeout(() => {
      this.#channelsRefreshTimer = null;
      if (!this.#ws) return;
      this.#sendRaw({ jsonrpc: "2.0", method: "getChannels", id: 3 });
    }, STATE_REFRESH_DEBOUNCE_MS);
  }

  #scheduleMixesRefresh(): void {
    if (this.#mixesRefreshTimer) return;
    this.#mixesRefreshTimer = setTimeout(() => {
      this.#mixesRefreshTimer = null;
      if (!this.#ws) return;
      this.#sendRaw({ jsonrpc: "2.0", method: "getMixes", id: 2 });
    }, STATE_REFRESH_DEBOUNCE_MS);
  }

  #endpointKey(ep: Endpoint): string {
    return `${ep.identifier || ""}::${ep.mixer_id || ""}`;
  }

  #queueVolumeWrite(endpoint: Endpoint, level: number): void {
    const key = this.#endpointKey(endpoint);
    const prev = this.#pendingWrites.get(key);
    if (prev && Math.abs(prev.level - level) < VOLUME_WRITE_EPSILON) return;
    const lastSent = this.#lastSentVolume.get(key);
    if (typeof lastSent === "number" && Math.abs(lastSent - level) < VOLUME_WRITE_EPSILON) return;
    this.#pendingWrites.set(key, { endpoint, level });
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      void this.#flushWrites();
    }, VOLUME_WRITE_INTERVAL_MS);
  }

  async #flushWrites(): Promise<void> {
    if (this.#flushInFlight) return;
    if (!this.#ws) {
      this.#pendingWrites.clear();
      return;
    }
    this.#flushInFlight = true;
    try {
      const writes = Array.from(this.#pendingWrites.values());
      this.#pendingWrites.clear();
      for (const { endpoint, level } of writes) {
        if (!this.#ws) break;
        if (!endpoint.identifier) {
          await this.#sendRpc("setMix", { id: endpoint.mixer_id, level });
        } else if (!endpoint.mixer_id) {
          await this.#sendRpc("setChannel", { id: endpoint.identifier, level });
        } else {
          await this.#sendRpc("setChannel", {
            id: endpoint.identifier,
            mixes: [{ id: endpoint.mixer_id, level }],
          });
        }
        this.#lastSentVolume.set(this.#endpointKey(endpoint), level);
      }
    } catch {
      this.#cleanup();
    } finally {
      this.#flushInFlight = false;
      if (this.#pendingWrites.size > 0) this.#scheduleFlush();
    }
  }

  async #sendRpc(method: string, params?: Record<string, unknown>): Promise<void> {
    this.#rpcSeq++;
    if (this.#rpcSeq > 2_000_000_000) this.#rpcSeq = 10;
    const req: RpcRequest = { jsonrpc: "2.0", method, id: this.#rpcSeq };
    if (params && typeof params === "object" && Object.keys(params).length > 0) {
      req.params = params;
    }
    this.#sendRaw(req);
  }

  #sendRaw(obj: unknown): void {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(obj));
  }

  #cleanup(): void {
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
      this.#ws = null;
    }
    this.#port = null;
    this.#pendingWrites.clear();
    this.#lastSentVolume.clear();
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    if (this.#channelsRefreshTimer) clearTimeout(this.#channelsRefreshTimer);
    this.#channelsRefreshTimer = null;
    if (this.#mixesRefreshTimer) clearTimeout(this.#mixesRefreshTimer);
    this.#mixesRefreshTimer = null;
    if (this.#appInfoTimer) clearTimeout(this.#appInfoTimer);
    this.#appInfoTimer = null;
    this.#appInfoResolve = null;
    this.#channels = [];
    this.#mixes = [];
  }

  #scheduleReconnect(): void {
    if (this.#intentionalClose) return;
    if (this.#reconnectTimer) return;
    log.info(`Reconnecting in ${this.#reconnectMs}ms...`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      void this.#tryConnect();
    }, this.#reconnectMs);
  }
}
