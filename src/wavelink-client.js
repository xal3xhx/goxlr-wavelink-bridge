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

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export class WaveLinkClient extends EventEmitter {
  #ws = null;
  #port = null;
  #wsInfoPath;
  #reconnectMs;
  #reconnectTimer = null;
  #intentionalClose = false;
  #rpcSeq = 10;

  // State
  #channels = [];
  #mixes = [];

  // Volume write coalescing
  #pendingWrites = new Map();
  #lastSentVolume = new Map();
  #flushTimer = null;
  #flushInFlight = false;

  // State refresh debounce
  #channelsRefreshTimer = null;
  #mixesRefreshTimer = null;

  // AppInfo verification
  #appInfoResolve = null;
  #appInfoTimer = null;

  constructor({ wsInfoPath = null, reconnectMs = 3000 } = {}) {
    super();
    this.#wsInfoPath = wsInfoPath || this.#defaultWsInfoPath();
    this.#reconnectMs = reconnectMs;
  }

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  get channels() {
    return this.#channels;
  }

  get mixes() {
    return this.#mixes;
  }

  connect() {
    this.#intentionalClose = false;
    this.#tryConnect();
  }

  disconnect() {
    this.#intentionalClose = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#cleanup();
  }

  // ── Commands ──────────────────────────────────────────────────────

  /** Set volume for a channel (global). level: 0.0-1.0 */
  setChannelVolume(channelId, level) {
    this.#queueVolumeWrite({ identifier: channelId, mixer_id: "" }, clamp01(level));
  }

  /** Set volume for a channel within a specific mix. level: 0.0-1.0 */
  setChannelMixVolume(channelId, mixId, level) {
    this.#queueVolumeWrite({ identifier: channelId, mixer_id: mixId }, clamp01(level));
  }

  /** Set volume for a mix master. level: 0.0-1.0 */
  setMixVolume(mixId, level) {
    this.#queueVolumeWrite({ identifier: "", mixer_id: mixId }, clamp01(level));
  }

  /** Set mute for a channel (global). */
  async setChannelMute(channelId, isMuted) {
    await this.#sendRpc("setChannel", { id: channelId, isMuted: Boolean(isMuted) });
  }

  /** Set mute for a channel within a specific mix. */
  async setChannelMixMute(channelId, mixId, isMuted) {
    await this.#sendRpc("setChannel", {
      id: channelId,
      mixes: [{ id: mixId, isMuted: Boolean(isMuted) }],
    });
  }

  /** Set mute for a mix master. */
  async setMixMute(mixId, isMuted) {
    await this.#sendRpc("setMix", { id: mixId, isMuted: Boolean(isMuted) });
  }

  /** Find a channel by name (case-insensitive). Returns the channel object or null. */
  findChannelByName(name) {
    const lower = name.toLowerCase();
    return this.#channels.find((c) => c.name?.toLowerCase() === lower) ?? null;
  }

  /** Find a mix by name (case-insensitive). Returns the mix object or null. */
  findMixByName(name) {
    const lower = name.toLowerCase();
    return this.#mixes.find((m) => m.name?.toLowerCase() === lower) ?? null;
  }

  // ── Port Discovery ────────────────────────────────────────────────

  #defaultWsInfoPath() {
    const appdata = process.env.APPDATA;
    if (!appdata) return null;
    // APPDATA is ...\AppData\Roaming, we need ...\AppData\Local
    const base = join(appdata, "..", "Local");
    return join(base, "Packages", "Elgato.WaveLink_g54w8ztgkx496", "LocalState", "ws-info.json");
  }

  #readPort() {
    if (!this.#wsInfoPath) {
      log.error("No ws-info.json path configured");
      return null;
    }
    try {
      const text = readFileSync(this.#wsInfoPath, "utf-8");
      const info = JSON.parse(text);
      const port = Number(info.port);
      if (Number.isFinite(port) && port > 0 && port <= 65535) {
        return Math.trunc(port);
      }
    } catch (e) {
      log.warn(`Cannot read ws-info.json: ${e.message}`);
    }
    return null;
  }

  // ── Connection ────────────────────────────────────────────────────

  async #tryConnect() {
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

      const connected = await new Promise((resolve) => {
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

      ws.on("message", (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        this.#handleMessage(msg);
      });

      ws.on("close", () => {
        if (this.#ws === ws) {
          log.warn("Disconnected");
          this.#cleanup();
          this.emit("disconnected");
          this.#scheduleReconnect();
        }
      });

      ws.on("error", (err) => {
        log.error("WebSocket error:", err.message);
      });

      // Verify this is actually Wave Link
      const verified = await this.#verifyAppInfo();
      if (!verified) {
        log.warn("Failed to verify Wave Link application info");
        ws.close();
        this.#scheduleReconnect();
        return;
      }

      log.info(`Connected to Wave Link on port ${port}`);

      // Request full state
      await this.#requestFullState();

      this.emit("connected", { channels: this.#channels, mixes: this.#mixes });
    } catch (e) {
      log.error("Connection error:", e.message);
      this.#scheduleReconnect();
    }
  }

  async #verifyAppInfo() {
    return new Promise((resolve) => {
      this.#appInfoTimer = setTimeout(() => {
        this.#appInfoResolve = null;
        resolve(false);
      }, APP_INFO_TIMEOUT_MS);

      this.#appInfoResolve = (result) => {
        clearTimeout(this.#appInfoTimer);
        this.#appInfoResolve = null;
        this.#appInfoTimer = null;
        resolve(result && typeof result === "object");
      };

      this.#sendRaw({ jsonrpc: "2.0", method: "getApplicationInfo", id: 1 });
    });
  }

  async #requestFullState() {
    this.#sendRaw({ jsonrpc: "2.0", method: "getMixes", id: 2 });
    this.#sendRaw({ jsonrpc: "2.0", method: "getChannels", id: 3 });

    // Wait a bit for responses to arrive
    await new Promise((r) => setTimeout(r, 200));
  }

  // ── Message Handling ──────────────────────────────────────────────

  #handleMessage(msg) {
    if (!msg || typeof msg !== "object") return;

    const id = msg.id;

    // AppInfo response (id=1)
    if (id === 1) {
      if (this.#appInfoResolve) this.#appInfoResolve(msg.result || null);
      return;
    }

    // getMixes response (id=2)
    if (id === 2) {
      const result = msg.result;
      const payload = result?.mixes ?? result;
      if (Array.isArray(payload)) {
        const prevMixes = this.#mixes;
        this.#mixes = payload;
        this.#emitMixChanges(prevMixes, payload);
        log.info(`Received ${payload.length} mixes: ${payload.map((m) => m.name).join(", ")}`);
      }
      return;
    }

    // getChannels response (id=3)
    if (id === 3) {
      const result = msg.result;
      const payload = result?.channels ?? result;
      if (Array.isArray(payload)) {
        const prevChannels = this.#channels;
        this.#channels = payload;
        this.#emitChannelChanges(prevChannels, payload);
        log.info(`Received ${payload.length} channels: ${payload.map((c) => c.name).join(", ")}`);
      }
      return;
    }

    // Notifications (no id, has method)
    if (msg.method) {
      if (msg.method === "channelsChanged" || msg.method === "channelChanged") {
        this.#scheduleChannelsRefresh();
      }
      if (msg.method === "mixesChanged" || msg.method === "mixChanged") {
        this.#scheduleMixesRefresh();
      }
    }
  }

  #emitChannelChanges(prev, next) {
    for (const ch of next) {
      const old = prev.find((c) => c.id === ch.id);
      if (!old) continue;

      // Global level change
      const oldLevel = old.level ?? old.volume;
      const newLevel = ch.level ?? ch.volume;
      if (oldLevel != null && newLevel != null && Math.abs(oldLevel - newLevel) > VOLUME_WRITE_EPSILON) {
        this.emit("volume_changed", {
          channelId: ch.id,
          channelName: ch.name,
          level: clamp01(newLevel),
          mixId: null,
        });
      }

      // Global mute change
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

      // Per-mix changes
      if (Array.isArray(ch.mixes) && Array.isArray(old.mixes)) {
        for (const mixEntry of ch.mixes) {
          const oldEntry = old.mixes.find((m) => m.id === mixEntry.id);
          if (!oldEntry) continue;

          const oel = oldEntry.level ?? oldEntry.volume;
          const nel = mixEntry.level ?? mixEntry.volume;
          if (oel != null && nel != null && Math.abs(oel - nel) > VOLUME_WRITE_EPSILON) {
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

  #emitMixChanges(prev, next) {
    for (const mix of next) {
      const old = prev.find((m) => m.id === mix.id);
      if (!old) continue;

      const oldLevel = old.level ?? old.volume;
      const newLevel = mix.level ?? mix.volume;
      if (oldLevel != null && newLevel != null && Math.abs(oldLevel - newLevel) > VOLUME_WRITE_EPSILON) {
        this.emit("mix_volume_changed", {
          mixId: mix.id,
          mixName: mix.name,
          level: clamp01(newLevel),
        });
      }
    }
  }

  // ── State Refresh ─────────────────────────────────────────────────

  #scheduleChannelsRefresh() {
    if (this.#channelsRefreshTimer) return;
    this.#channelsRefreshTimer = setTimeout(() => {
      this.#channelsRefreshTimer = null;
      if (!this.#ws) return;
      this.#sendRaw({ jsonrpc: "2.0", method: "getChannels", id: 3 });
    }, STATE_REFRESH_DEBOUNCE_MS);
  }

  #scheduleMixesRefresh() {
    if (this.#mixesRefreshTimer) return;
    this.#mixesRefreshTimer = setTimeout(() => {
      this.#mixesRefreshTimer = null;
      if (!this.#ws) return;
      this.#sendRaw({ jsonrpc: "2.0", method: "getMixes", id: 2 });
    }, STATE_REFRESH_DEBOUNCE_MS);
  }

  // ── Volume Write Coalescing ───────────────────────────────────────

  #endpointKey(ep) {
    return `${ep.identifier || ""}::${ep.mixer_id || ""}`;
  }

  #queueVolumeWrite(endpoint, level) {
    const key = this.#endpointKey(endpoint);
    const prev = this.#pendingWrites.get(key);
    if (prev && Math.abs(prev.level - level) < VOLUME_WRITE_EPSILON) return;
    const lastSent = this.#lastSentVolume.get(key);
    if (typeof lastSent === "number" && Math.abs(lastSent - level) < VOLUME_WRITE_EPSILON) return;
    this.#pendingWrites.set(key, { endpoint, level });
    this.#scheduleFlush();
  }

  #scheduleFlush() {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flushWrites();
    }, VOLUME_WRITE_INTERVAL_MS);
  }

  async #flushWrites() {
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
          // Mix master
          await this.#sendRpc("setMix", { id: endpoint.mixer_id, level });
        } else if (!endpoint.mixer_id) {
          // Channel global
          await this.#sendRpc("setChannel", { id: endpoint.identifier, level });
        } else {
          // Channel within specific mix
          await this.#sendRpc("setChannel", {
            id: endpoint.identifier,
            mixes: [{ id: endpoint.mixer_id, level }],
          });
        }
        this.#lastSentVolume.set(this.#endpointKey(endpoint), level);
      }
    } catch {
      // Connection may have died
      this.#cleanup();
    } finally {
      this.#flushInFlight = false;
      if (this.#pendingWrites.size > 0) this.#scheduleFlush();
    }
  }

  // ── JSON-RPC ──────────────────────────────────────────────────────

  async #sendRpc(method, params) {
    this.#rpcSeq++;
    if (this.#rpcSeq > 2_000_000_000) this.#rpcSeq = 10;
    const req = { jsonrpc: "2.0", method, id: this.#rpcSeq };
    if (params && typeof params === "object" && Object.keys(params).length > 0) {
      req.params = params;
    }
    this.#sendRaw(req);
  }

  #sendRaw(obj) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) return;
    this.#ws.send(JSON.stringify(obj));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  #cleanup() {
    if (this.#ws) {
      try { this.#ws.close(); } catch {}
      this.#ws = null;
    }
    this.#port = null;
    this.#pendingWrites.clear();
    this.#lastSentVolume.clear();
    clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
    clearTimeout(this.#channelsRefreshTimer);
    this.#channelsRefreshTimer = null;
    clearTimeout(this.#mixesRefreshTimer);
    this.#mixesRefreshTimer = null;
    clearTimeout(this.#appInfoTimer);
    this.#appInfoTimer = null;
    this.#appInfoResolve = null;
    this.#channels = [];
    this.#mixes = [];
  }

  #scheduleReconnect() {
    if (this.#intentionalClose) return;
    if (this.#reconnectTimer) return;
    log.info(`Reconnecting in ${this.#reconnectMs}ms...`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#tryConnect();
    }, this.#reconnectMs);
  }
}
