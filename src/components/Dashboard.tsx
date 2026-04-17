import type { ChannelSnapshot, ConnectionStatus } from "../../shared/types";
import { Card, StatusDot } from "./ui";

const FADERS = ["A", "B", "C", "D"] as const;

export function Dashboard({
  status,
  channels,
}: {
  status: ConnectionStatus | null;
  channels: ChannelSnapshot | null;
}) {
  const g = status?.goxlr;
  const w = status?.wavelink;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="GoXLR">
        <div className="space-y-3">
          <Row label="Status">
            <StatusDot on={Boolean(g?.connected)} />
            <span className="text-sm">{g?.connected ? "Connected" : "Offline"}</span>
          </Row>
          <Row label="Serial">
            <span className="font-mono text-xs text-neutral-400">
              {g?.serial ?? "—"}
            </span>
          </Row>
          <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-950/50">
            {FADERS.map((f) => {
              const fs = g?.faders?.[f];
              const vol = fs ? channels?.goxlr_volumes?.[fs.channel] : undefined;
              return (
                <div
                  key={f}
                  className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="rounded bg-neutral-800 px-2 py-0.5 text-xs font-semibold text-neutral-300">
                      Fader {f}
                    </span>
                    <span className="text-sm text-neutral-200">
                      {fs?.channel ?? <span className="text-neutral-500">unassigned</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-neutral-400">
                    {fs?.mute_state && fs.mute_state !== "Unmuted" && (
                      <span className="rounded bg-rose-500/20 px-2 py-0.5 text-rose-300">
                        {fs.mute_state}
                      </span>
                    )}
                    <VolumeBar value={vol} max={255} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Card>

      <Card title="Wave Link">
        <div className="space-y-3">
          <Row label="Status">
            <StatusDot on={Boolean(w?.connected)} />
            <span className="text-sm">{w?.connected ? "Connected" : "Offline"}</span>
          </Row>
          <Row label="Mixes">
            <span className="text-sm text-neutral-300">
              {w?.mixes.length ? w.mixes.map((m) => m.name).join(" · ") : "—"}
            </span>
          </Row>
          <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950/50">
            {channels?.wavelink_channels.length ? (
              channels.wavelink_channels.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between border-b border-neutral-800 px-3 py-2 last:border-b-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="truncate text-sm text-neutral-200">{c.name}</span>
                    {c.isMuted && (
                      <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">
                        muted
                      </span>
                    )}
                  </div>
                  <VolumeBar value={c.level} max={1} />
                </div>
              ))
            ) : (
              <p className="px-3 py-4 text-center text-xs text-neutral-500">
                No channels loaded
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function VolumeBar({ value, max }: { value: number | undefined; max: number }) {
  const pct = value != null ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full bg-indigo-500 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[11px] text-neutral-500">
        {value != null ? `${pct.toFixed(0)}%` : "—"}
      </span>
    </div>
  );
}
