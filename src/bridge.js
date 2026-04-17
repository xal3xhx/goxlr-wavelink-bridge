import { createLogger } from "./logger.js";

const log = createLogger("Bridge");

// How long after the user last touched a GoXLR fader do we block
// Wave Link -> GoXLR writes for that fader. This prevents the
// GoXLR Utility's fader_pause_until mechanism from fighting the
// physical fader, which causes "lost tracking".
const FADER_ACTIVE_HOLD_MS = 1500;

/**
 * Bidirectional bridge between GoXLR faders and Wave Link channels.
 *
 * GoXLR -> Wave Link: fader moves dummy channel volume -> bridge -> Wave Link setChannel
 * Wave Link -> GoXLR: Wave Link volume changes -> bridge -> GoXLR SetVolume -> motorized fader moves
 */
export class Bridge {
  #goxlr;
  #wavelink;
  #mappings;
  #echoSuppressMs;

  #syncTimer = null;

  // Track when the user is physically touching each GoXLR fader.
  // While active, we suppress ALL Wave Link -> GoXLR writes for that fader
  // so the motorized fader doesn't fight the user's hand.
  #faderLastTouched = new Map();  // key: goxlr_dummy_channel -> timestamp

  // Echo suppression for the GoXLR -> Wave Link direction:
  // After the bridge writes to Wave Link, Wave Link echoes back a
  // channelsChanged event. We ignore that echo so it doesn't trigger
  // a redundant Wave Link -> GoXLR write.
  #lastWriteToWaveLink = new Map();   // key: "channelId::mixId" -> { time, value }
  #lastMuteWriteToWaveLink = new Map();

  // Echo suppression for the Wave Link -> GoXLR direction:
  // After the bridge writes to GoXLR, GoXLR emits a Patch event.
  // We ignore that echo so it doesn't trigger a redundant GoXLR -> Wave Link write.
  #lastWriteToGoXLR = new Map();      // key: goxlr channel name -> { time, value }
  #lastMuteWriteToGoXLR = new Map();

  // Resolved Wave Link channel IDs (cached)
  #resolvedChannelIds = new Map();
  #resolvedMixIds = { monitor: null, stream: null };

  // Active event listeners for cleanup
  #listeners = [];

  constructor(goxlrClient, wavelinkClient, config) {
    this.#goxlr = goxlrClient;
    this.#wavelink = wavelinkClient;
    this.#mappings = config.mappings || [];
    this.#echoSuppressMs = config.options?.echo_suppress_ms ?? 500;
  }

  start() {
    log.info("Starting bridge...");
    this.#wireEvents();
    this.#resolveChannelIds();
    this.#logMappings();
  }

  stop() {
    for (const { emitter, event, handler } of this.#listeners) {
      emitter.off(event, handler);
    }
    this.#listeners = [];
    log.info("Bridge stopped");
  }

  updateMappings(mappings) {
    this.#mappings = mappings;
    this.#resolveChannelIds();
    this.#logMappings();
  }

  /** Perform initial sync: read Wave Link state and move GoXLR faders to match. */
  initialSync() {
    if (!this.#goxlr.connected || !this.#wavelink.connected) return;

    log.info("Performing initial sync (Wave Link -> GoXLR faders)...");
    for (const mapping of this.#mappings) {
      if (!mapping.sync_volume) continue;
      const wlChannel = this.#getWaveLinkChannel(mapping);
      if (!wlChannel) continue;

      const level = this.#getWaveLinkLevel(wlChannel, mapping);
      if (level == null) continue;

      const goxlrValue = Math.round(level * 255);
      this.#writeToGoXLR(mapping.goxlr_dummy_channel, goxlrValue);
      log.info(`  Synced fader ${mapping.goxlr_fader} (${mapping.goxlr_dummy_channel}) -> ${(level * 100).toFixed(0)}%`);
    }
  }

  // ── Event Wiring ──────────────────────────────────────────────────

  #wireEvents() {
    // GoXLR -> Wave Link (fader moved)
    this.#on(this.#goxlr, "volume_changed", (ev) => this.#onGoXLRVolumeChanged(ev));
    this.#on(this.#goxlr, "mute_changed", (ev) => this.#onGoXLRMuteChanged(ev));

    // Wave Link -> GoXLR (volume changed in Wave Link UI)
    this.#on(this.#wavelink, "volume_changed", (ev) => this.#onWaveLinkVolumeChanged(ev));
    this.#on(this.#wavelink, "mute_changed", (ev) => this.#onWaveLinkMuteChanged(ev));

    // Re-resolve channel IDs when Wave Link reconnects and sync once both are ready
    this.#on(this.#wavelink, "connected", () => {
      this.#resolveChannelIds();
      this.#debouncedInitialSync();
    });

    this.#on(this.#goxlr, "connected", () => {
      this.#debouncedInitialSync();
    });
  }

  #on(emitter, event, handler) {
    emitter.on(event, handler);
    this.#listeners.push({ emitter, event, handler });
  }

  #debouncedInitialSync() {
    clearTimeout(this.#syncTimer);
    this.#syncTimer = setTimeout(() => this.initialSync(), 400);
  }

  // ── GoXLR -> Wave Link ────────────────────────────────────────────

  #onGoXLRVolumeChanged({ fader, channel, value }) {
    const mapping = this.#mappings.find((m) => m.goxlr_dummy_channel === channel);
    if (!mapping || !mapping.sync_volume) return;

    // Check if this is an echo from our own write to GoXLR
    const suppress = this.#lastWriteToGoXLR.get(channel);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      if (elapsed < this.#echoSuppressMs && Math.abs(suppress.value - value) <= 2) {
        return;
      }
    }

    // Mark this fader as actively being touched by the user.
    // This blocks Wave Link -> GoXLR writes so the motorized fader
    // doesn't fight the user's hand.
    this.#faderLastTouched.set(channel, Date.now());

    const level = value / 255;
    const wlChannelId = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
    if (!wlChannelId) {
      this.#resolveChannelIds();
      const id = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
      if (!id) return;
      this.#writeToWaveLink(mapping, id, level);
    } else {
      this.#writeToWaveLink(mapping, wlChannelId, level);
    }
  }

  #onGoXLRMuteChanged({ fader, channel, muteState }) {
    const mapping = this.#mappings.find((m) => m.goxlr_dummy_channel === channel);
    if (!mapping || !mapping.sync_mute) return;

    // Check if echo from our own write
    const suppress = this.#lastMuteWriteToGoXLR.get(fader);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      const isMuted = muteState !== "Unmuted";
      if (elapsed < this.#echoSuppressMs && suppress.muted === isMuted) return;
    }

    const isMuted = muteState !== "Unmuted";
    const wlChannelId = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
    if (!wlChannelId) return;

    this.#writeMuteToWaveLink(mapping, wlChannelId, isMuted);
  }

  // ── Wave Link -> GoXLR ────────────────────────────────────────────

  #onWaveLinkVolumeChanged({ channelId, channelName, level, mixId }) {
    const mapping = this.#findMappingForWaveLink(channelId, channelName, mixId);
    if (!mapping || !mapping.sync_volume) return;

    // *** KEY FIX: If the user is actively moving this GoXLR fader,
    // do NOT write back to GoXLR. This prevents fader_pause_until
    // from blocking the physical fader. ***
    const lastTouched = this.#faderLastTouched.get(mapping.goxlr_dummy_channel);
    if (lastTouched && (Date.now() - lastTouched) < FADER_ACTIVE_HOLD_MS) {
      return;  // User is touching the fader, skip write-back
    }

    // Also suppress echoes from our own writes to Wave Link
    const suppressKey = `${channelId}::${mixId || ""}`;
    const suppress = this.#lastWriteToWaveLink.get(suppressKey);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      if (elapsed < this.#echoSuppressMs && Math.abs(suppress.value - level) < 0.01) return;
    }

    const goxlrValue = Math.round(level * 255);
    this.#writeToGoXLR(mapping.goxlr_dummy_channel, goxlrValue);
  }

  #onWaveLinkMuteChanged({ channelId, channelName, isMuted, mixId }) {
    const mapping = this.#findMappingForWaveLink(channelId, channelName, mixId);
    if (!mapping || !mapping.sync_mute) return;

    // Block if user is actively using GoXLR fader/buttons
    const lastTouched = this.#faderLastTouched.get(mapping.goxlr_dummy_channel);
    if (lastTouched && (Date.now() - lastTouched) < FADER_ACTIVE_HOLD_MS) {
      return;
    }

    const suppressKey = `${channelId}::${mixId || ""}`;
    const suppress = this.#lastMuteWriteToWaveLink.get(suppressKey);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      if (elapsed < this.#echoSuppressMs && suppress.muted === isMuted) return;
    }

    const muteState = isMuted ? "MutedToAll" : "Unmuted";
    this.#writeMuteToGoXLR(mapping.goxlr_fader, muteState);
  }

  // ── Write Helpers ─────────────────────────────────────────────────

  #writeToWaveLink(mapping, channelId, level) {
    const target = mapping.mix_target;
    const now = Date.now();

    if (target === "both" || target === "monitor") {
      const mixId = this.#resolvedMixIds.monitor;
      if (mixId) {
        this.#wavelink.setChannelMixVolume(channelId, mixId, level);
        this.#lastWriteToWaveLink.set(`${channelId}::${mixId}`, { time: now, value: level });
      }
    }
    if (target === "both" || target === "stream") {
      const mixId = this.#resolvedMixIds.stream;
      if (mixId) {
        this.#wavelink.setChannelMixVolume(channelId, mixId, level);
        this.#lastWriteToWaveLink.set(`${channelId}::${mixId}`, { time: now, value: level });
      }
    }
    if (!this.#resolvedMixIds.monitor && !this.#resolvedMixIds.stream) {
      this.#wavelink.setChannelVolume(channelId, level);
      this.#lastWriteToWaveLink.set(`${channelId}::`, { time: now, value: level });
    }
  }

  #writeMuteToWaveLink(mapping, channelId, isMuted) {
    const target = mapping.mix_target;
    const now = Date.now();

    if (target === "both" || target === "monitor") {
      const mixId = this.#resolvedMixIds.monitor;
      if (mixId) {
        this.#wavelink.setChannelMixMute(channelId, mixId, isMuted);
        this.#lastMuteWriteToWaveLink.set(`${channelId}::${mixId}`, { time: now, muted: isMuted });
      }
    }
    if (target === "both" || target === "stream") {
      const mixId = this.#resolvedMixIds.stream;
      if (mixId) {
        this.#wavelink.setChannelMixMute(channelId, mixId, isMuted);
        this.#lastMuteWriteToWaveLink.set(`${channelId}::${mixId}`, { time: now, muted: isMuted });
      }
    }
    if (!this.#resolvedMixIds.monitor && !this.#resolvedMixIds.stream) {
      this.#wavelink.setChannelMute(channelId, isMuted);
      this.#lastMuteWriteToWaveLink.set(`${channelId}::`, { time: now, muted: isMuted });
    }
  }

  #writeToGoXLR(channelName, value) {
    this.#lastWriteToGoXLR.set(channelName, { time: Date.now(), value });
    this.#goxlr.setVolume(channelName, value).catch((e) => {
      log.error(`Failed to set GoXLR volume for ${channelName}: ${e.message}`);
    });
  }

  #writeMuteToGoXLR(faderName, muteState) {
    this.#lastMuteWriteToGoXLR.set(faderName, { time: Date.now(), muted: muteState !== "Unmuted" });
    this.#goxlr.setFaderMuteState(faderName, muteState).catch((e) => {
      log.error(`Failed to set GoXLR mute for fader ${faderName}: ${e.message}`);
    });
  }

  // ── Channel Resolution ────────────────────────────────────────────

  #resolveChannelIds() {
    const channels = this.#wavelink.channels;
    const mixes = this.#wavelink.mixes;

    this.#resolvedMixIds.monitor = null;
    this.#resolvedMixIds.stream = null;
    for (const mix of mixes) {
      const name = (mix.name || "").toLowerCase();
      if (!this.#resolvedMixIds.monitor && (name.includes("monitor") || name.includes("system out"))) {
        this.#resolvedMixIds.monitor = mix.id;
      } else if (!this.#resolvedMixIds.stream && name.includes("stream")) {
        this.#resolvedMixIds.stream = mix.id;
      }
    }
    if (!this.#resolvedMixIds.monitor && mixes.length >= 1) {
      this.#resolvedMixIds.monitor = mixes[0].id;
    }
    if (!this.#resolvedMixIds.stream && mixes.length >= 2) {
      this.#resolvedMixIds.stream = mixes[1].id;
    }

    this.#resolvedChannelIds.clear();
    for (const mapping of this.#mappings) {
      const name = mapping.wavelink_channel_name;
      if (mapping.wavelink_channel_id) {
        this.#resolvedChannelIds.set(name, mapping.wavelink_channel_id);
        continue;
      }
      const ch = channels.find((c) => c.name?.toLowerCase() === name.toLowerCase());
      if (ch) {
        this.#resolvedChannelIds.set(name, ch.id);
      }
    }
  }

  #getWaveLinkChannel(mapping) {
    const id = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
    if (!id) return null;
    return this.#wavelink.channels.find((c) => c.id === id) ?? null;
  }

  #getWaveLinkLevel(channel, mapping) {
    if (!channel) return null;
    const target = mapping.mix_target;
    if (Array.isArray(channel.mixes)) {
      let mixId = null;
      if (target === "monitor" || target === "both") mixId = this.#resolvedMixIds.monitor;
      else if (target === "stream") mixId = this.#resolvedMixIds.stream;
      if (mixId) {
        const entry = channel.mixes.find((m) => m.id === mixId);
        if (entry) {
          const v = entry.level ?? entry.volume;
          if (v != null) return Number(v);
        }
      }
    }
    const v = channel.level ?? channel.volume;
    return v != null ? Number(v) : null;
  }

  #findMappingForWaveLink(channelId, channelName, mixId) {
    for (const mapping of this.#mappings) {
      const resolvedId = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
      if (resolvedId && resolvedId === channelId) {
        if (mixId) {
          if (mapping.mix_target === "monitor" && mixId === this.#resolvedMixIds.monitor) return mapping;
          if (mapping.mix_target === "stream" && mixId === this.#resolvedMixIds.stream) return mapping;
          if (mapping.mix_target === "both") {
            if (mixId === this.#resolvedMixIds.monitor) return mapping;
          }
        } else {
          return mapping;
        }
      }
    }
    return null;
  }

  #logMappings() {
    if (this.#mappings.length === 0) {
      log.warn("No mappings configured");
      return;
    }
    log.info("Active mappings:");
    for (const m of this.#mappings) {
      const resolved = this.#resolvedChannelIds.get(m.wavelink_channel_name);
      const status = resolved ? `resolved: ${resolved}` : "NOT RESOLVED";
      log.info(`  Fader ${m.goxlr_fader} (${m.goxlr_dummy_channel}) -> WL "${m.wavelink_channel_name}" [${m.mix_target}] (${status})`);
    }
    log.info(`  Monitor mix: ${this.#resolvedMixIds.monitor || "not found"}`);
    log.info(`  Stream mix: ${this.#resolvedMixIds.stream || "not found"}`);
  }
}
