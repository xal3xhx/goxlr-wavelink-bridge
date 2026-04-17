import { EventEmitter } from "node:events";
import WebSocket from "ws";
import fjp from "fast-json-patch";
const { applyPatch } = fjp;
import { createLogger } from "./logger.js";

const log = createLogger("GoXLR");

const FADERS = ["A", "B", "C", "D"];

export class GoXLRClient extends EventEmitter {
  #url;
  #ws = null;
  #status = null;
  #serial = null;
  #preferredSerial;
  #nextId = 1;
  #reconnectMs;
  #reconnectTimer = null;
  #intentionalClose = false;

  constructor({ url = "ws://localhost:14564/api/websocket", serial = null, reconnectMs = 3000 } = {}) {
    super();
    this.#url = url;
    this.#preferredSerial = serial;
    this.#reconnectMs = reconnectMs;
  }

  get connected() {
    return this.#ws?.readyState === WebSocket.OPEN;
  }

  get serial() {
    return this.#serial;
  }

  get status() {
    return this.#status;
  }

  /** Returns the mixer sub-tree for the active serial, or null. */
  get mixer() {
    if (!this.#status || !this.#serial) return null;
    return this.#status.mixers?.[this.#serial] ?? null;
  }

  connect() {
    this.#intentionalClose = false;
    this.#openSocket();
  }

  disconnect() {
    this.#intentionalClose = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    if (this.#ws) {
      this.#ws.close();
      this.#ws = null;
    }
  }

  // ── Commands (write to GoXLR Utility) ─────────────────────────────

  /** Set a channel's volume (0-255). Motorized fader will move if channel is on a fader. */
  async setVolume(channelName, value) {
    const v = Math.max(0, Math.min(255, Math.round(value)));
    return this.#sendCommand({ SetVolume: [channelName, v] });
  }

  /** Set mute state for a fader. muteState: "Unmuted", "MutedToX", "MutedToAll" */
  async setFaderMuteState(faderName, muteState) {
    return this.#sendCommand({ SetFaderMuteState: [faderName, muteState] });
  }

  // ── Internal ──────────────────────────────────────────────────────

  #openSocket() {
    if (this.#ws) {
      try { this.#ws.close(); } catch {}
      this.#ws = null;
    }

    log.info(`Connecting to ${this.#url}...`);
    const ws = new WebSocket(this.#url);

    ws.on("open", () => {
      log.info("WebSocket connected");
      this.#ws = ws;
      this.#send({ id: this.#nextId++, data: "GetStatus" });
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      this.#handleMessage(msg);
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

    ws.on("error", (err) => {
      log.error("WebSocket error:", err.message);
    });
  }

  #handleMessage(msg) {
    const data = msg.data;
    if (!data) return;

    // Status response
    if (data.Status) {
      this.#onStatusReceived(data.Status);
      return;
    }

    // Patch event (broadcast from daemon)
    if (data.Patch) {
      this.#onPatchReceived(data.Patch);
      return;
    }

    // Command response (Ok / Error)
    if (data === "Ok") return;
    if (data.Error) {
      log.error(`Command error (id ${msg.id}):`, data.Error);
    }
  }

  #onStatusReceived(status) {
    this.#status = status;

    // Resolve serial
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

    // Log fader assignments
    for (const f of FADERS) {
      const fs = mixer?.fader_status?.[f];
      if (fs) {
        const vol = mixer?.levels?.volumes?.[fs.channel];
        log.info(`  Fader ${f} = ${fs.channel} (vol: ${vol}, mute: ${fs.mute_state})`);
      }
    }

    this.emit("connected", { serial: this.#serial, status });
  }

  #onPatchReceived(patches) {
    if (!this.#status || !this.#serial) return;

    // Snapshot relevant state before applying patches
    const mixer = this.mixer;
    const prevVolumes = { ...mixer?.levels?.volumes };
    const prevMuteStates = {};
    for (const f of FADERS) {
      prevMuteStates[f] = mixer?.fader_status?.[f]?.mute_state;
    }

    // Apply patches to local status mirror
    try {
      applyPatch(this.#status, patches);
    } catch (e) {
      log.error("Failed to apply patch:", e.message);
      return;
    }

    // Diff and emit events
    const updatedMixer = this.mixer;
    if (!updatedMixer) return;

    // Check volume changes
    const volumes = updatedMixer.levels?.volumes;
    if (volumes) {
      for (const [channel, newVal] of Object.entries(volumes)) {
        if (prevVolumes[channel] !== newVal) {
          // Find which fader (if any) has this channel assigned
          const fader = this.#faderForChannel(channel);
          this.emit("volume_changed", { fader, channel, value: newVal });
        }
      }
    }

    // Check mute state changes
    for (const f of FADERS) {
      const newMuteState = updatedMixer.fader_status?.[f]?.mute_state;
      if (prevMuteStates[f] !== newMuteState && newMuteState != null) {
        const channel = updatedMixer.fader_status[f].channel;
        this.emit("mute_changed", { fader: f, channel, muteState: newMuteState });
      }
    }
  }

  /** Find which fader (A/B/C/D) is assigned to a given channel, or null. */
  #faderForChannel(channelName) {
    const mixer = this.mixer;
    if (!mixer?.fader_status) return null;
    for (const f of FADERS) {
      if (mixer.fader_status[f]?.channel === channelName) return f;
    }
    return null;
  }

  async #sendCommand(command) {
    if (!this.#serial) throw new Error("No mixer serial available");
    const id = this.#nextId++;
    this.#send({ id, data: { Command: [this.#serial, command] } });
  }

  #send(obj) {
    if (!this.#ws || this.#ws.readyState !== WebSocket.OPEN) {
      log.warn("Cannot send, WebSocket not open");
      return;
    }
    this.#ws.send(JSON.stringify(obj));
  }

  #scheduleReconnect() {
    if (this.#intentionalClose) return;
    if (this.#reconnectTimer) return;
    log.info(`Reconnecting in ${this.#reconnectMs}ms...`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#openSocket();
    }, this.#reconnectMs);
  }
}
