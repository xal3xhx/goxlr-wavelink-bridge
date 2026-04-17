/**
 * Test script for GoXLR client.
 * Run: node src/test-goxlr.js
 *
 * Make sure GoXLR Utility is running. This will:
 * 1. Connect and print full mixer status
 * 2. Log all fader movements and mute button presses in real-time
 * 3. After 5 seconds, test SetVolume by nudging a dummy channel
 */
import { GoXLRClient } from "./goxlr-client.js";
import { setLevel } from "./logger.js";

setLevel("debug");

const client = new GoXLRClient();

client.on("connected", ({ serial, status }) => {
  console.log("\n=== CONNECTED ===");
  console.log("Serial:", serial);
  const mixer = status.mixers[serial];
  console.log("\nFader assignments:");
  for (const f of ["A", "B", "C", "D"]) {
    const fs = mixer.fader_status?.[f];
    console.log(`  ${f}: ${fs?.channel} (mute: ${fs?.mute_state})`);
  }
  console.log("\nVolumes:");
  for (const [ch, vol] of Object.entries(mixer.levels?.volumes || {})) {
    console.log(`  ${ch}: ${vol}`);
  }
  console.log("\nListening for fader/mute changes... (Ctrl+C to quit)\n");
});

client.on("disconnected", () => {
  console.log("\n=== DISCONNECTED ===\n");
});

client.on("volume_changed", ({ fader, channel, value }) => {
  const faderStr = fader ? `Fader ${fader}` : "No fader";
  console.log(`[VOL] ${faderStr} | ${channel} = ${value} (${(value / 255 * 100).toFixed(1)}%)`);
});

client.on("mute_changed", ({ fader, channel, muteState }) => {
  console.log(`[MUTE] Fader ${fader} | ${channel} -> ${muteState}`);
});

client.connect();

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  client.disconnect();
  process.exit(0);
});
