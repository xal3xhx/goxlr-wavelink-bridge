import { useState } from "react";
import type {
  AppConfig,
  ConnectionStatus,
  Fader,
  GoXLRChannel,
  Mapping,
  MixTarget,
} from "../../shared/types";
import { Button, Card, Field, Select, Toggle } from "./ui";

const FADERS: Fader[] = ["A", "B", "C", "D"];
const GOXLR_CHANNELS: GoXLRChannel[] = [
  "Mic",
  "LineIn",
  "Console",
  "System",
  "Game",
  "Chat",
  "Sample",
  "Music",
  "Headphones",
  "MicMonitor",
  "LineOut",
];
const MIX_TARGETS: MixTarget[] = ["monitor", "stream", "both"];

function emptyMapping(fader: Fader): Mapping {
  return {
    goxlr_fader: fader,
    goxlr_dummy_channel: "Music",
    wavelink_channel_name: "",
    wavelink_channel_id: null,
    mix_target: "both",
    sync_volume: true,
    sync_mute: true,
  };
}

export function Mappings({
  config,
  status,
  onSave,
}: {
  config: AppConfig;
  status: ConnectionStatus | null;
  onSave: (cfg: AppConfig) => Promise<void>;
}) {
  const byFader = new Map<Fader, Mapping>(config.mappings.map((m) => [m.goxlr_fader, m]));
  const [draft, setDraft] = useState<Record<Fader, Mapping>>(
    () =>
      Object.fromEntries(
        FADERS.map((f) => [f, byFader.get(f) ?? emptyMapping(f)]),
      ) as Record<Fader, Mapping>,
  );
  const [enabled, setEnabled] = useState<Record<Fader, boolean>>(
    () =>
      Object.fromEntries(FADERS.map((f) => [f, byFader.has(f)])) as Record<Fader, boolean>,
  );
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const wlChannels = status?.wavelink.channels ?? [];

  function update(f: Fader, patch: Partial<Mapping>): void {
    setDraft((prev) => ({ ...prev, [f]: { ...prev[f], ...patch } }));
    setDirty(true);
  }

  function toggle(f: Fader, on: boolean): void {
    setEnabled((prev) => ({ ...prev, [f]: on }));
    setDirty(true);
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const mappings: Mapping[] = FADERS.filter((f) => enabled[f]).map((f) => draft[f]);
      await onSave({ ...config, mappings });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card
      title="Fader Mappings"
      actions={
        <>
          <span className="text-xs text-neutral-500">
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <Button disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {FADERS.map((f) => {
          const m = draft[f];
          const fs = status?.goxlr.faders?.[f];
          const on = enabled[f];
          return (
            <div
              key={f}
              className="rounded-md border border-neutral-800 bg-neutral-950/40 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-neutral-200">
                    Fader {f}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {fs?.channel ? `physical: ${fs.channel}` : "physical: —"}
                  </span>
                </div>
                <Toggle
                  checked={on}
                  onChange={(v) => toggle(f, v)}
                  label={on ? "Enabled" : "Disabled"}
                />
              </div>

              <div
                className={`grid gap-3 md:grid-cols-2 ${on ? "" : "pointer-events-none opacity-40"}`}
              >
                <Field label="GoXLR dummy channel">
                  <Select
                    value={m.goxlr_dummy_channel}
                    onChange={(e) =>
                      update(f, { goxlr_dummy_channel: e.target.value as GoXLRChannel })
                    }
                  >
                    {GOXLR_CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  label="Wave Link channel"
                  hint={m.wavelink_channel_id ? `id: ${m.wavelink_channel_id}` : undefined}
                >
                  <Select
                    value={m.wavelink_channel_id ?? ""}
                    onChange={(e) => {
                      const id = e.target.value || null;
                      const name = id
                        ? (wlChannels.find((c) => c.id === id)?.name ?? m.wavelink_channel_name)
                        : m.wavelink_channel_name;
                      update(f, { wavelink_channel_id: id, wavelink_channel_name: name });
                    }}
                  >
                    <option value="">— select —</option>
                    {wlChannels.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                    {m.wavelink_channel_id &&
                      !wlChannels.some((c) => c.id === m.wavelink_channel_id) && (
                        <option value={m.wavelink_channel_id}>
                          {m.wavelink_channel_name} (offline)
                        </option>
                      )}
                  </Select>
                </Field>

                <Field label="Mix target">
                  <Select
                    value={m.mix_target}
                    onChange={(e) => update(f, { mix_target: e.target.value as MixTarget })}
                  >
                    {MIX_TARGETS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="flex items-end gap-6">
                  <Toggle
                    checked={m.sync_volume}
                    onChange={(v) => update(f, { sync_volume: v })}
                    label="Sync volume"
                  />
                  <Toggle
                    checked={m.sync_mute}
                    onChange={(v) => update(f, { sync_mute: v })}
                    label="Sync mute"
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
