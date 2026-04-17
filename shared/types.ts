export type Fader = "A" | "B" | "C" | "D";
export type MixTarget = "monitor" | "stream" | "both";

export type GoXLRChannel =
  | "Mic"
  | "LineIn"
  | "Console"
  | "System"
  | "Game"
  | "Chat"
  | "Sample"
  | "Music"
  | "Headphones"
  | "MicMonitor"
  | "LineOut";

export interface Mapping {
  goxlr_fader: Fader;
  goxlr_dummy_channel: GoXLRChannel;
  wavelink_channel_name: string;
  wavelink_channel_id: string | null;
  mix_target: MixTarget;
  sync_volume: boolean;
  sync_mute: boolean;
}

export interface AppConfig {
  goxlr: {
    url: string;
    serial: string | null;
  };
  wavelink: {
    ws_info_path: string | null;
  };
  mappings: Mapping[];
  options: {
    volume_write_interval_ms: number;
    reconnect_interval_ms: number;
    echo_suppress_ms: number;
    start_minimized: boolean;
    start_on_login: boolean;
    log_level: "debug" | "info" | "warn" | "error";
    auto_update: boolean;
  };
}

export interface ConnectionStatus {
  goxlr: {
    connected: boolean;
    serial: string | null;
    faders: Record<string, { channel: string; mute_state: string }> | null;
  };
  wavelink: {
    connected: boolean;
    channels: Array<{ id: string; name: string }>;
    mixes: Array<{ id: string; name: string }>;
  };
}

export interface ChannelSnapshot {
  wavelink_channels: Array<{
    id: string;
    name: string;
    level: number;
    isMuted: boolean;
    mixes: Array<{ id: string; level: number; isMuted: boolean }>;
  }>;
  wavelink_mixes: Array<{ id: string; name: string; level: number }>;
  goxlr_faders: Record<string, { channel: string; mute_state: string }>;
  goxlr_volumes: Record<string, number>;
}

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "available"; version: string; releaseNotes?: string }
  | { state: "downloading"; percent: number }
  | { state: "ready"; version: string }
  | { state: "none" }
  | { state: "error"; message: string };
