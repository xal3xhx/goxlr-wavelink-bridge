import type { AppConfig, Mapping } from "../../shared/types.js";
import { createLogger } from "./logger.js";
import type {
  GoXLRClient,
  MuteChangedEvent as GoXLRMuteChangedEvent,
  MuteState,
  VolumeChangedEvent as GoXLRVolumeChangedEvent,
} from "./goxlr-client.js";
import type {
  WaveLinkChannel,
  WaveLinkClient,
  WaveLinkMuteChangedEvent,
  WaveLinkVolumeChangedEvent,
} from "./wavelink-client.js";

const log = createLogger("Bridge");

const FADER_ACTIVE_HOLD_MS = 1500;

interface ListenerEntry {
  remove: () => void;
}

interface EchoValueEntry {
  time: number;
  value: number;
}

interface EchoMuteEntry {
  time: number;
  muted: boolean;
}

interface ResolvedMixIds {
  monitor: string | null;
  stream: string | null;
}

export class Bridge {
  #goxlr: GoXLRClient;
  #wavelink: WaveLinkClient;
  #mappings: Mapping[];
  #echoSuppressMs: number;

  #syncTimer: NodeJS.Timeout | null = null;

  #faderLastTouched = new Map<string, number>();

  #lastWriteToWaveLink = new Map<string, EchoValueEntry>();
  #lastMuteWriteToWaveLink = new Map<string, EchoMuteEntry>();

  #lastWriteToGoXLR = new Map<string, EchoValueEntry>();
  #lastMuteWriteToGoXLR = new Map<string, EchoMuteEntry>();

  #resolvedChannelIds = new Map<string, string>();
  #resolvedMixIds: ResolvedMixIds = { monitor: null, stream: null };

  #listeners: ListenerEntry[] = [];

  constructor(goxlrClient: GoXLRClient, wavelinkClient: WaveLinkClient, config: AppConfig) {
    this.#goxlr = goxlrClient;
    this.#wavelink = wavelinkClient;
    this.#mappings = config.mappings ?? [];
    this.#echoSuppressMs = config.options?.echo_suppress_ms ?? 500;
  }

  start(): void {
    log.info("Starting bridge...");
    this.#wireEvents();
    this.#resolveChannelIds();
    this.#logMappings();
  }

  stop(): void {
    for (const { remove } of this.#listeners) remove();
    this.#listeners = [];
    if (this.#syncTimer) clearTimeout(this.#syncTimer);
    this.#syncTimer = null;
    log.info("Bridge stopped");
  }

  updateMappings(mappings: Mapping[]): void {
    this.#mappings = mappings;
    this.#resolveChannelIds();
    this.#logMappings();
  }

  updateEchoSuppressMs(ms: number): void {
    this.#echoSuppressMs = ms;
  }

  initialSync(): void {
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
      log.info(
        `  Synced fader ${mapping.goxlr_fader} (${mapping.goxlr_dummy_channel}) -> ${(level * 100).toFixed(0)}%`,
      );
    }
  }

  #wireEvents(): void {
    const gVol = (ev: GoXLRVolumeChangedEvent): void => this.#onGoXLRVolumeChanged(ev);
    const gMute = (ev: GoXLRMuteChangedEvent): void => this.#onGoXLRMuteChanged(ev);
    const gConn = (): void => this.#debouncedInitialSync();
    this.#goxlr.on("volume_changed", gVol);
    this.#goxlr.on("mute_changed", gMute);
    this.#goxlr.on("connected", gConn);
    this.#listeners.push(
      { remove: () => this.#goxlr.off("volume_changed", gVol) },
      { remove: () => this.#goxlr.off("mute_changed", gMute) },
      { remove: () => this.#goxlr.off("connected", gConn) },
    );

    const wVol = (ev: WaveLinkVolumeChangedEvent): void => this.#onWaveLinkVolumeChanged(ev);
    const wMute = (ev: WaveLinkMuteChangedEvent): void => this.#onWaveLinkMuteChanged(ev);
    const wConn = (): void => {
      this.#resolveChannelIds();
      this.#debouncedInitialSync();
    };
    this.#wavelink.on("volume_changed", wVol);
    this.#wavelink.on("mute_changed", wMute);
    this.#wavelink.on("connected", wConn);
    this.#listeners.push(
      { remove: () => this.#wavelink.off("volume_changed", wVol) },
      { remove: () => this.#wavelink.off("mute_changed", wMute) },
      { remove: () => this.#wavelink.off("connected", wConn) },
    );
  }

  #debouncedInitialSync(): void {
    if (this.#syncTimer) clearTimeout(this.#syncTimer);
    this.#syncTimer = setTimeout(() => this.initialSync(), 400);
  }

  #onGoXLRVolumeChanged({ channel, value }: GoXLRVolumeChangedEvent): void {
    const mapping = this.#mappings.find((m) => m.goxlr_dummy_channel === channel);
    if (!mapping || !mapping.sync_volume) return;

    const suppress = this.#lastWriteToGoXLR.get(channel);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      if (elapsed < this.#echoSuppressMs && Math.abs(suppress.value - value) <= 2) {
        return;
      }
    }

    this.#faderLastTouched.set(channel, Date.now());

    const level = value / 255;
    let wlChannelId = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
    if (!wlChannelId) {
      this.#resolveChannelIds();
      wlChannelId = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
      if (!wlChannelId) return;
    }
    this.#writeToWaveLink(mapping, wlChannelId, level);
  }

  #onGoXLRMuteChanged({ fader, channel, muteState }: GoXLRMuteChangedEvent): void {
    const mapping = this.#mappings.find((m) => m.goxlr_dummy_channel === channel);
    if (!mapping || !mapping.sync_mute) return;

    const isMuted = muteState !== "Unmuted";
    const suppress = this.#lastMuteWriteToGoXLR.get(fader);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      if (elapsed < this.#echoSuppressMs && suppress.muted === isMuted) return;
    }

    const wlChannelId = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
    if (!wlChannelId) return;

    this.#writeMuteToWaveLink(mapping, wlChannelId, isMuted);
  }

  #onWaveLinkVolumeChanged({
    channelId,
    channelName,
    level,
    mixId,
  }: WaveLinkVolumeChangedEvent): void {
    const mapping = this.#findMappingForWaveLink(channelId, channelName, mixId);
    if (!mapping || !mapping.sync_volume) return;

    const lastTouched = this.#faderLastTouched.get(mapping.goxlr_dummy_channel);
    if (lastTouched && Date.now() - lastTouched < FADER_ACTIVE_HOLD_MS) {
      return;
    }

    const suppressKey = `${channelId}::${mixId ?? ""}`;
    const suppress = this.#lastWriteToWaveLink.get(suppressKey);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      if (elapsed < this.#echoSuppressMs && Math.abs(suppress.value - level) < 0.01) return;
    }

    const goxlrValue = Math.round(level * 255);
    this.#writeToGoXLR(mapping.goxlr_dummy_channel, goxlrValue);
  }

  #onWaveLinkMuteChanged({
    channelId,
    channelName,
    isMuted,
    mixId,
  }: WaveLinkMuteChangedEvent): void {
    const mapping = this.#findMappingForWaveLink(channelId, channelName, mixId);
    if (!mapping || !mapping.sync_mute) return;

    const lastTouched = this.#faderLastTouched.get(mapping.goxlr_dummy_channel);
    if (lastTouched && Date.now() - lastTouched < FADER_ACTIVE_HOLD_MS) {
      return;
    }

    const suppressKey = `${channelId}::${mixId ?? ""}`;
    const suppress = this.#lastMuteWriteToWaveLink.get(suppressKey);
    if (suppress) {
      const elapsed = Date.now() - suppress.time;
      if (elapsed < this.#echoSuppressMs && suppress.muted === isMuted) return;
    }

    const muteState: MuteState = isMuted ? "MutedToAll" : "Unmuted";
    this.#writeMuteToGoXLR(mapping.goxlr_fader, muteState);
  }

  #writeToWaveLink(mapping: Mapping, channelId: string, level: number): void {
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

  #writeMuteToWaveLink(mapping: Mapping, channelId: string, isMuted: boolean): void {
    const target = mapping.mix_target;
    const now = Date.now();

    if (target === "both" || target === "monitor") {
      const mixId = this.#resolvedMixIds.monitor;
      if (mixId) {
        void this.#wavelink.setChannelMixMute(channelId, mixId, isMuted);
        this.#lastMuteWriteToWaveLink.set(`${channelId}::${mixId}`, { time: now, muted: isMuted });
      }
    }
    if (target === "both" || target === "stream") {
      const mixId = this.#resolvedMixIds.stream;
      if (mixId) {
        void this.#wavelink.setChannelMixMute(channelId, mixId, isMuted);
        this.#lastMuteWriteToWaveLink.set(`${channelId}::${mixId}`, { time: now, muted: isMuted });
      }
    }
    if (!this.#resolvedMixIds.monitor && !this.#resolvedMixIds.stream) {
      void this.#wavelink.setChannelMute(channelId, isMuted);
      this.#lastMuteWriteToWaveLink.set(`${channelId}::`, { time: now, muted: isMuted });
    }
  }

  #writeToGoXLR(channelName: string, value: number): void {
    this.#lastWriteToGoXLR.set(channelName, { time: Date.now(), value });
    this.#goxlr.setVolume(channelName, value).catch((e: Error) => {
      log.error(`Failed to set GoXLR volume for ${channelName}: ${e.message}`);
    });
  }

  #writeMuteToGoXLR(faderName: string, muteState: MuteState): void {
    this.#lastMuteWriteToGoXLR.set(faderName, {
      time: Date.now(),
      muted: muteState !== "Unmuted",
    });
    this.#goxlr.setFaderMuteState(faderName as never, muteState).catch((e: Error) => {
      log.error(`Failed to set GoXLR mute for fader ${faderName}: ${e.message}`);
    });
  }

  #resolveChannelIds(): void {
    const channels = this.#wavelink.channels;
    const mixes = this.#wavelink.mixes;

    this.#resolvedMixIds.monitor = null;
    this.#resolvedMixIds.stream = null;
    for (const mix of mixes) {
      const name = (mix.name ?? "").toLowerCase();
      if (
        !this.#resolvedMixIds.monitor &&
        (name.includes("monitor") || name.includes("system out"))
      ) {
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

  #getWaveLinkChannel(mapping: Mapping): WaveLinkChannel | null {
    const id = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
    if (!id) return null;
    return this.#wavelink.channels.find((c) => c.id === id) ?? null;
  }

  #getWaveLinkLevel(channel: WaveLinkChannel, mapping: Mapping): number | null {
    const target = mapping.mix_target;
    if (Array.isArray(channel.mixes)) {
      let mixId: string | null = null;
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

  #findMappingForWaveLink(
    channelId: string,
    _channelName: string,
    mixId: string | null,
  ): Mapping | null {
    for (const mapping of this.#mappings) {
      const resolvedId = this.#resolvedChannelIds.get(mapping.wavelink_channel_name);
      if (resolvedId && resolvedId === channelId) {
        if (mixId) {
          if (mapping.mix_target === "monitor" && mixId === this.#resolvedMixIds.monitor)
            return mapping;
          if (mapping.mix_target === "stream" && mixId === this.#resolvedMixIds.stream)
            return mapping;
          if (mapping.mix_target === "both" && mixId === this.#resolvedMixIds.monitor)
            return mapping;
        } else {
          return mapping;
        }
      }
    }
    return null;
  }

  #logMappings(): void {
    if (this.#mappings.length === 0) {
      log.warn("No mappings configured");
      return;
    }
    log.info("Active mappings:");
    for (const m of this.#mappings) {
      const resolved = this.#resolvedChannelIds.get(m.wavelink_channel_name);
      const status = resolved ? `resolved: ${resolved}` : "NOT RESOLVED";
      log.info(
        `  Fader ${m.goxlr_fader} (${m.goxlr_dummy_channel}) -> WL "${m.wavelink_channel_name}" [${m.mix_target}] (${status})`,
      );
    }
    log.info(`  Monitor mix: ${this.#resolvedMixIds.monitor ?? "not found"}`);
    log.info(`  Stream mix: ${this.#resolvedMixIds.stream ?? "not found"}`);
  }
}
