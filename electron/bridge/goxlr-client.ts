import { EventEmitter } from "node:events";
import WebSocket from "ws";
import fjp from "fast-json-patch";
import type { Operation } from "fast-json-patch";
import { createLogger } from "./logger.js";

const { applyPatch } = fjp;
const log = createLogger("GoXLR");

const FADERS = ["A", "B", "C", "D"] as const;
export type Fader = (typeof FADERS)[number];

export type MuteState = "Unmuted" | "MutedToX" | "MutedToAll";

interface FaderStatus {
  channel: string;
  mute_state: MuteState;
}

interface Mixer {
  fader_status?: Record<Fader, FaderStatus>;
  levels?: {
    volumes?: Record<string, number>;
  };
}

export interface GoXLRStatus {
  mixers?: Record<string, Mixer>;
}

export interface VolumeChangedEvent {
  fader: Fader | null;
  channel: string;
  value: number;
}

export interface MuteChangedEvent {
  fader: Fader;
  channel: string;
  muteState: MuteState;
}

export interface GoXLRClientOptions {
  url?: string;
  serial?: string | null;
  reconnectMs?: number;
}

type Events = {
  connected: [{ serial: string; status: GoXLRStatus }];
  disconnected: [];
  volume_changed: [VolumeChangedEvent];
  mute_changed: [MuteChangedEvent];
};

export class GoXLRClient extends EventEmitter {
  #url: string;
  #ws: WebSocket | null = null;
  #status: GoXLRStatus | null = null;
  #serial: string | null = null;
  #preferredSerial: string | null;
  #nextId = 1;
  #reconnectMs: number;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #intentionalClose = false;

  constructor({
    url = "ws://localhost:14564/api/websocket",
    serial = null,
    reconnectMs = 3000,
  }: GoXLRClientOptions = {}) {
    super();
    this.#url = url;
    this.#preferredSerial = serial;
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

  get serial(): string | null {
    return this.#serial;
  }

  get status(): GoXLRStatus | null {
    return this.#status;
  }

  get mixer(): Mixer | null {
    if (!this.#status || !this.#serial) return null;
    return this.#status.mixers?.[this.#serial] ?? null;
  }

  connect(): void {
    this.#intentionalClose = false;
    this.#openSocket();
  }

  disconnect(): void {
    this.#intentionalClose = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  async setVolume(channelName: string, value: number): Promise<void> {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    this.#sendCommand({ SetVolume: [channelName, v] });
  }

  async setFaderMuteState(faderName: Fader, muteState: MuteState): Promise<void> {
    this.#sendCommand({ SetFaderMuteState: [faderName, muteState] });
  }

  #openSocket(): void {
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
      this.#ws = null;
    }

    log.info(`Connecting to ${this.#url}...`);
    const ws = new WebSocket(this.#url);

    ws.on("open", () => {
      log.info("WebSocket connected");
      this.#ws = ws;
      this.#send({ id: this.#nextId++, data: "GetStatus" });
    });

    ws.on("message", (raw: WebSocket.RawData) => {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.#handleMessage(msg as { id?: number; data?: unknown });
    });

    ws.on("close", () => {
      const wasConnected = this.#ws === ws;
      this.#ws = null;
      if (wasConnected) {
        log.warn("WebSocket disconnected");
        this.#serial = null;
        this.#status = null;
        this.emit("disconnected");
      }
      this.#scheduleReconnect();
    });

    ws.on("error", (err: Error) => {
      log.error("WebSocket error:", err.message);
    });
  }

  #handleMessage(msg: { id?: number; data?: unknown }): void {
    const data = msg.data;
    if (!data) return;

    if (typeof data === "object" && data !== null) {
      if ("Status" in data) {
        this.#onStatusReceived((data as { Status: GoXLRStatus }).Status);
        return;
      }
      if ("Patch" in data) {
        this.#onPatchReceived((data as { Patch: unknown[] }).Patch);
        return;
      }
      if ("Error" in data) {
        log.error(`Command error (id ${msg.id}):`, (data as { Error: unknown }).Error);
        return;
      }
    }

    if (data === "Ok") return;
  }

  #onStatusReceived(status: GoXLRStatus): void {
    this.#status = status;

    const serials = Object.keys(status.mixers || {});
    if (serials.length === 0) {
      log.warn("No GoXLR mixers found in status");
      return;
    }

    if (this.#preferredSerial && serials.includes(this.#preferredSerial)) {
      this.#serial = this.#preferredSerial;
    } else {
      this.#serial = serials[0];
      if (serials.length > 1) {
        log.info(`Multiple mixers found, using first: ${this.#serial}`);
      }
    }

    const mixer = this.mixer;
    log.info(`Connected to mixer: ${this.#serial}`);

    for (const f of FADERS) {
      const fs = mixer?.fader_status?.[f];
      if (fs) {
        const vol = mixer?.levels?.volumes?.[fs.channel];
        log.info(`  Fader ${f} = ${fs.channel} (vol: ${vol}, mute: ${fs.mute_state})`);
      }
    }

    this.emit("connected", { serial: this.#serial, status });
  }

  #onPatchReceived(patches: unknown[]): void {
    if (!this.#status || !this.#serial) return;

    const mixer = this.mixer;
    const prevVolumes: Record<string, number> = { ...(mixer?.levels?.volumes ?? {}) };
    const prevMuteStates: Partial<Record<Fader, MuteState>> = {};
    for (const f of FADERS) {
      prevMuteStates[f] = mixer?.fader_status?.[f]?.mute_state;
    }

    try {
      applyPatch(this.#status as object, patches as Operation[]);
    } catch (e) {
      log.error("Failed to apply patch:", (e as Error).message);
      return;
    }

    const updatedMixer = this.mixer;
    if (!updatedMixer) return;

    const volumes = updatedMixer.levels?.volumes;
    if (volumes) {
      for (const [channel, newVal] of Object.entries(volumes)) {
        if (prevVolumes[channel] !== newVal) {
          const fader = this.#faderForChannel(channel);
          this.emit("volume_changed", { fader, channel, value: newVal });
        }
      }
    }

    for (const f of FADERS) {
      const newMuteState = updatedMixer.fader_status?.[f]?.mute_state;
      if (prevMuteStates[f] !== newMuteState && newMuteState != null) {
        const channel = updatedMixer.fader_status![f].channel;
        this.emit("mute_changed", { fader: f, channel, muteState: newMuteState });
      }
    }
  }

  #faderForChannel(channelName: string): Fader | null {
    const mixer = this.mixer;
    if (!mixer?.fader_status) return null;
    for (const f of FADERS) {
      if (mixer.fader_status[f]?.channel === channelName) return f;
    }
    return null;
  }

  #sendCommand(command: unknown): void {
    if (!this.#serial) {
      log.warn("No mixer serial available, dropping command");
      return;
    }
    const id = this.#nextId++;
    this.#send({ id, data: { Command: [this.#serial, command] } });
  }

  #send(obj: unknown): void {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      log.warn("Cannot send, WebSocket not open");
      return;
    }
    this.#ws.send(JSON.stringify(obj));
  }

  #scheduleReconnect(): void {
    if (this.#intentionalClose) return;
    if (this.#reconnectTimer) return;
    log.info(`Reconnecting in ${this.#reconnectMs}ms...`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#openSocket();
    }, this.#reconnectMs);
  }
}
