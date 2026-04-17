/**
 * Test script for Wave Link client.
 * Run: node src/test-wavelink.js
 *
 * Make sure Wave Link 3 is running. This will:
 * 1. Connect and print all channels and mixes
 * 2. Log all volume/mute changes in real-time
 */
import { WaveLinkClient } from "./wavelink-client.js";
import { setLevel } from "./logger.js";

setLevel("debug");

const client = new WaveLinkClient();

client.on("connected", ({ channels, mixes }) => {
  console.log("\n=== CONNECTED ===");
  console.log("\nMixes:");
  for (const m of mixes) {
    console.log(`  ${m.name} (id: ${m.id}, level: ${m.level})`);
  }
  console.log("\nChannels:");
  for (const c of channels) {
    console.log(`  ${c.name} (id: ${c.id}, level: ${c.level}, muted: ${c.isMuted})`);
    if (Array.isArray(c.mixes)) {
      for (const mx of c.mixes) {
        console.log(`    -> mix ${mx.id}: level=${mx.level}, muted=${mx.isMuted}`);
      }
    }
  }
  console.log("\nListening for changes... (Ctrl+C to quit)\n");
});

client.on("disconnected", () => {
  console.log("\n=== DISCONNECTED ===\n");
});

client.on("volume_changed", ({ channelId, channelName, level, mixId }) => {
  const mixStr = mixId ? ` (mix: ${mixId})` : " (global)";
  console.log(`[VOL] ${channelName} = ${(level * 100).toFixed(1)}%${mixStr}`);
});

client.on("mute_changed", ({ channelId, channelName, isMuted, mixId }) => {
  const mixStr = mixId ? ` (mix: ${mixId})` : " (global)";
  console.log(`[MUTE] ${channelName} -> ${isMuted ? "MUTED" : "UNMUTED"}${mixStr}`);
});

client.on("mix_volume_changed", ({ mixId, mixName, level }) => {
  console.log(`[MIX VOL] ${mixName} = ${(level * 100).toFixed(1)}%`);
});

client.connect();

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  client.disconnect();
  process.exit(0);
});
