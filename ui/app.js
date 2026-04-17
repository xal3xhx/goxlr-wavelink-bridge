const GOXLR_CHANNELS = [
  "LineIn", "Console", "Game", "Chat", "Sample", "Music",
  "Mic", "System", "Headphones", "MicMonitor", "LineOut",
];
const FADERS = ["A", "B", "C", "D"];
const MIX_TARGETS = [
  { value: "both", label: "Both (Monitor + Stream)" },
  { value: "monitor", label: "Monitor Mix Only" },
  { value: "stream", label: "Stream Mix Only" },
];

let currentConfig = null;
let wavelinkChannels = [];
let wavelinkMixes = [];

async function fetchJSON(url) {
  const res = await fetch(url);
  return res.json();
}

async function loadStatus() {
  try {
    const status = await fetchJSON("/api/status");

    const goxlrDot = document.getElementById("goxlrDot");
    const goxlrText = document.getElementById("goxlrStatus");
    goxlrDot.className = "dot " + (status.goxlr.connected ? "connected" : "disconnected");
    goxlrText.textContent = status.goxlr.connected
      ? `Connected (${status.goxlr.serial})`
      : "Disconnected";

    const wlDot = document.getElementById("wavelinkDot");
    const wlText = document.getElementById("wavelinkStatus");
    wlDot.className = "dot " + (status.wavelink.connected ? "connected" : "disconnected");
    wlText.textContent = status.wavelink.connected
      ? `Connected (${status.wavelink.channels.length} channels)`
      : "Disconnected";

    wavelinkChannels = status.wavelink.channels || [];
    wavelinkMixes = status.wavelink.mixes || [];
  } catch (e) {
    console.error("Failed to load status:", e);
  }
}

async function loadConfig() {
  try {
    currentConfig = await fetchJSON("/api/config");
    renderMappings();
    renderSetupSteps();
  } catch (e) {
    console.error("Failed to load config:", e);
  }
}

function renderSetupSteps() {
  const list = document.getElementById("setupSteps");
  list.innerHTML = "";
  if (!currentConfig?.mappings) return;

  for (const m of currentConfig.mappings) {
    const li = document.createElement("li");
    li.textContent = `Fader ${m.goxlr_fader} → assign to "${m.goxlr_dummy_channel}" in GoXLR Utility`;
    list.appendChild(li);
  }
}

function renderMappings() {
  const container = document.getElementById("mappings");
  container.innerHTML = "";

  if (!currentConfig?.mappings) return;

  for (let i = 0; i < currentConfig.mappings.length; i++) {
    const m = currentConfig.mappings[i];
    container.appendChild(createMappingCard(m, i));
  }

  // Add mapping button (only if < 4 faders mapped)
  if (currentConfig.mappings.length < 4) {
    const addBtn = document.createElement("button");
    addBtn.className = "add-btn";
    addBtn.textContent = "+ Add Fader Mapping";
    addBtn.onclick = () => addMapping();
    container.appendChild(addBtn);
  }
}

function createMappingCard(mapping, index) {
  const card = document.createElement("div");
  card.className = "mapping-card";

  const usedFaders = currentConfig.mappings.map((m, i) => i !== index ? m.goxlr_fader : null).filter(Boolean);
  const availableFaders = FADERS.filter((f) => !usedFaders.includes(f) || f === mapping.goxlr_fader);

  card.innerHTML = `
    <div class="mapping-header">
      <h3>Fader ${mapping.goxlr_fader}</h3>
      <button class="remove-btn" data-index="${index}">Remove</button>
    </div>
    <div class="mapping-grid">
      <div class="field">
        <label>GoXLR Fader</label>
        <select data-field="goxlr_fader" data-index="${index}">
          ${availableFaders.map((f) =>
            `<option value="${f}" ${f === mapping.goxlr_fader ? "selected" : ""}>Fader ${f}</option>`
          ).join("")}
        </select>
      </div>
      <div class="field">
        <label>GoXLR Dummy Channel</label>
        <select data-field="goxlr_dummy_channel" data-index="${index}">
          ${GOXLR_CHANNELS.map((ch) =>
            `<option value="${ch}" ${ch === mapping.goxlr_dummy_channel ? "selected" : ""}>${ch}</option>`
          ).join("")}
        </select>
      </div>
      <div class="field">
        <label>Wave Link Channel</label>
        <select data-field="wavelink_channel_name" data-index="${index}">
          <option value="">-- Select --</option>
          ${wavelinkChannels.map((ch) =>
            `<option value="${ch.name}" ${ch.name === mapping.wavelink_channel_name ? "selected" : ""}>${ch.name}</option>`
          ).join("")}
          ${mapping.wavelink_channel_name && !wavelinkChannels.find((c) => c.name === mapping.wavelink_channel_name)
            ? `<option value="${mapping.wavelink_channel_name}" selected>${mapping.wavelink_channel_name} (offline)</option>`
            : ""}
        </select>
      </div>
      <div class="field">
        <label>Mix Target</label>
        <select data-field="mix_target" data-index="${index}">
          ${MIX_TARGETS.map((t) =>
            `<option value="${t.value}" ${t.value === mapping.mix_target ? "selected" : ""}>${t.label}</option>`
          ).join("")}
        </select>
      </div>
      <div class="checkbox-row">
        <label>
          <input type="checkbox" data-field="sync_volume" data-index="${index}" ${mapping.sync_volume ? "checked" : ""}>
          Sync Volume
        </label>
        <label>
          <input type="checkbox" data-field="sync_mute" data-index="${index}" ${mapping.sync_mute ? "checked" : ""}>
          Sync Mute
        </label>
      </div>
    </div>
  `;

  // Event listeners
  card.querySelector(".remove-btn").onclick = () => {
    currentConfig.mappings.splice(index, 1);
    renderMappings();
    renderSetupSteps();
  };

  for (const select of card.querySelectorAll("select")) {
    select.onchange = (e) => {
      const field = e.target.dataset.field;
      const idx = parseInt(e.target.dataset.index);
      currentConfig.mappings[idx][field] = e.target.value;
      if (field === "goxlr_fader") {
        renderMappings(); // re-render to update available faders
      }
      renderSetupSteps();
    };
  }

  for (const checkbox of card.querySelectorAll('input[type="checkbox"]')) {
    checkbox.onchange = (e) => {
      const field = e.target.dataset.field;
      const idx = parseInt(e.target.dataset.index);
      currentConfig.mappings[idx][field] = e.target.checked;
    };
  }

  return card;
}

function addMapping() {
  const usedFaders = currentConfig.mappings.map((m) => m.goxlr_fader);
  const nextFader = FADERS.find((f) => !usedFaders.includes(f));
  if (!nextFader) return;

  const usedDummyChannels = currentConfig.mappings.map((m) => m.goxlr_dummy_channel);
  const dummyChannels = ["LineIn", "Console", "Game", "Chat", "Sample", "Music"];
  const nextDummy = dummyChannels.find((ch) => !usedDummyChannels.includes(ch)) || "LineIn";

  currentConfig.mappings.push({
    goxlr_fader: nextFader,
    goxlr_dummy_channel: nextDummy,
    wavelink_channel_name: "",
    wavelink_channel_id: null,
    mix_target: "both",
    sync_volume: true,
    sync_mute: true,
  });

  renderMappings();
  renderSetupSteps();
}

async function saveConfig() {
  const statusEl = document.getElementById("saveStatus");
  try {
    // Resolve channel IDs before saving
    for (const m of currentConfig.mappings) {
      const wlCh = wavelinkChannels.find((c) => c.name === m.wavelink_channel_name);
      m.wavelink_channel_id = wlCh?.id || null;
    }

    const res = await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(currentConfig),
    });
    const result = await res.json();
    if (result.ok) {
      statusEl.textContent = "Configuration saved and applied!";
      statusEl.className = "save-status success";
    } else {
      statusEl.textContent = "Error: " + (result.error || "Unknown error");
      statusEl.className = "save-status error";
    }
  } catch (e) {
    statusEl.textContent = "Error: " + e.message;
    statusEl.className = "save-status error";
  }
  setTimeout(() => { statusEl.textContent = ""; }, 4000);
}

// Wire up buttons
document.getElementById("saveBtn").onclick = saveConfig;
document.getElementById("refreshBtn").onclick = async () => {
  await loadStatus();
  await loadConfig();
};

// Initial load
(async () => {
  await loadStatus();
  await loadConfig();
})();

// Auto-refresh status every 5 seconds
setInterval(loadStatus, 5000);
