import { useEffect, useState } from "react";
import type { AppConfig, UpdateStatus } from "../../shared/types";
import { Button, Card, Field, Select, TextInput, Toggle } from "./ui";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
const RELEASES_URL = "https://github.com/xal3xhx/goxlr-wavelink-bridge/releases";

export function Settings({
  config,
  autoStart,
  appVersion,
  update,
  updateLastChecked,
  latestVersion,
  onSave,
  onSetAutoStart,
  onReconnect,
  onCheckForUpdates,
  onDownloadUpdate,
  onInstallUpdate,
  onOpenExternal,
}: {
  config: AppConfig;
  autoStart: boolean;
  appVersion: string;
  update: UpdateStatus;
  updateLastChecked: number | null;
  latestVersion: string | null;
  onSave: (cfg: AppConfig) => Promise<void>;
  onSetAutoStart: (enabled: boolean) => Promise<void>;
  onReconnect: () => Promise<void>;
  onCheckForUpdates: () => Promise<void>;
  onDownloadUpdate: () => Promise<void>;
  onInstallUpdate: () => void;
  onOpenExternal: (url: string) => void;
}) {
  const [draft, setDraft] = useState<AppConfig>(config);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  function patchOptions(patch: Partial<AppConfig["options"]>): void {
    setDraft((d) => ({ ...d, options: { ...d.options, ...patch } }));
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  const saveButton = (
    <Button
      disabled={!dirty || saving}
      onClick={(e) => {
        e.stopPropagation();
        void save();
      }}
    >
      {saving ? "Saving…" : "Save"}
    </Button>
  );

  return (
    <div className="space-y-4">
      <Card title="General" actions={saveButton} collapsible defaultOpen>
        <div className="space-y-4">
          <Toggle
            checked={autoStart}
            onChange={onSetAutoStart}
            label="Start on login"
            hint="Launch the bridge automatically when you sign in"
          />
          <Toggle
            checked={draft.options.start_minimized}
            onChange={(v) => patchOptions({ start_minimized: v })}
            label="Start minimized to tray"
            hint="Show only the tray icon on launch"
          />
          <Field label="Log level">
            <Select
              value={draft.options.log_level}
              onChange={(e) =>
                patchOptions({
                  log_level: e.target.value as AppConfig["options"]["log_level"],
                })
              }
            >
              {LOG_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card
        title="Connection"
        actions={
          <>
            {saveButton}
            <Button
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                void onReconnect();
              }}
            >
              Reconnect
            </Button>
          </>
        }
        collapsible
        defaultOpen={false}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="GoXLR Utility URL">
            <TextInput
              value={draft.goxlr.url}
              onChange={(e) =>
                setDraft((d) => ({ ...d, goxlr: { ...d.goxlr, url: e.target.value } }))
              }
            />
          </Field>
          <Field
            label="GoXLR serial"
            hint="Leave empty to auto-select the first detected mixer"
          >
            <TextInput
              value={draft.goxlr.serial ?? ""}
              placeholder="auto"
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  goxlr: { ...d.goxlr, serial: e.target.value || null },
                }))
              }
            />
          </Field>
          <Field
            label="Wave Link ws-info.json path"
            hint="Leave empty to use the default location"
          >
            <TextInput
              value={draft.wavelink.ws_info_path ?? ""}
              placeholder="default"
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  wavelink: { ws_info_path: e.target.value || null },
                }))
              }
            />
          </Field>
          <Field label="Reconnect interval (ms)">
            <TextInput
              type="number"
              min={500}
              value={draft.options.reconnect_interval_ms}
              onChange={(e) =>
                patchOptions({ reconnect_interval_ms: Number(e.target.value) || 3000 })
              }
            />
          </Field>
          <Field label="Echo suppression (ms)">
            <TextInput
              type="number"
              min={0}
              value={draft.options.echo_suppress_ms}
              onChange={(e) =>
                patchOptions({ echo_suppress_ms: Number(e.target.value) || 0 })
              }
            />
          </Field>
          <Field label="Volume write interval (ms)">
            <TextInput
              type="number"
              min={4}
              value={draft.options.volume_write_interval_ms}
              onChange={(e) =>
                patchOptions({ volume_write_interval_ms: Number(e.target.value) || 16 })
              }
            />
          </Field>
        </div>
      </Card>

      <UpdatesCard
        appVersion={appVersion}
        update={update}
        updateLastChecked={updateLastChecked}
        latestVersion={latestVersion}
        autoUpdate={draft.options.auto_update}
        onToggleAutoUpdate={(v) => {
          patchOptions({ auto_update: v });
          void onSave({ ...draft, options: { ...draft.options, auto_update: v } });
        }}
        onCheck={onCheckForUpdates}
        onDownload={onDownloadUpdate}
        onInstall={onInstallUpdate}
        onOpenReleases={() => onOpenExternal(RELEASES_URL)}
      />
    </div>
  );
}

function UpdatesCard({
  appVersion,
  update,
  updateLastChecked,
  latestVersion,
  autoUpdate,
  onToggleAutoUpdate,
  onCheck,
  onDownload,
  onInstall,
  onOpenReleases,
}: {
  appVersion: string;
  update: UpdateStatus;
  updateLastChecked: number | null;
  latestVersion: string | null;
  autoUpdate: boolean;
  onToggleAutoUpdate: (v: boolean) => void;
  onCheck: () => Promise<void>;
  onDownload: () => Promise<void>;
  onInstall: () => void;
  onOpenReleases: () => void;
}) {
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const latestDisplay = latestVersion
    ? `v${latestVersion}`
    : update.state === "none"
      ? `v${appVersion}`
      : null;
  const hasNewer = !!latestVersion && latestVersion !== appVersion;
  const isAvailable = update.state === "available" || update.state === "downloading";
  const isReady = update.state === "ready";
  const isDownloading = update.state === "downloading";
  const percent = update.state === "downloading" ? update.percent : 0;

  async function handleCheck(): Promise<void> {
    setChecking(true);
    try {
      await onCheck();
    } finally {
      setChecking(false);
    }
  }

  async function handleDownload(): Promise<void> {
    setDownloading(true);
    try {
      await onDownload();
    } finally {
      setDownloading(false);
    }
  }

  const actions = (
    <Button
      variant="secondary"
      onClick={(e) => {
        e.stopPropagation();
        onOpenReleases();
      }}
    >
      Release notes
    </Button>
  );

  return (
    <Card title="Updates" actions={actions} collapsible defaultOpen={false}>
      <div className="space-y-4">
        <div className="grid gap-3 rounded-md border border-neutral-800 bg-neutral-950/40 p-4 md:grid-cols-2">
          <InfoRow label="Current version" value={`v${appVersion}`} mono />
          <InfoRow
            label="Latest version"
            value={latestDisplay ?? "unknown"}
            mono
            accent={hasNewer}
          />
          <InfoRow
            label="Last checked"
            value={
              updateLastChecked
                ? new Date(updateLastChecked).toLocaleString()
                : "never"
            }
          />
          <InfoRow label="Status" value={statusLabel(update)} />
        </div>

        {isDownloading && (
          <div>
            <div className="mb-1 flex justify-between text-xs text-neutral-400">
              <span>Downloading…</span>
              <span className="font-mono">{percent}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
              <div
                className="h-full bg-indigo-500 transition-[width]"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}

        {update.state === "error" && (
          <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {update.message}
          </div>
        )}

        {update.state === "available" &&
          update.releaseNotes &&
          update.releaseNotes.trim().length > 0 && (
            <ReleaseNotes text={update.releaseNotes} />
          )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleCheck} disabled={checking}>
            {checking ? "Checking…" : "Check for updates"}
          </Button>
          {isAvailable && !isDownloading && (
            <Button onClick={handleDownload} disabled={downloading}>
              {downloading
                ? "Starting…"
                : `Download${latestVersion ? ` v${latestVersion}` : ""}`}
            </Button>
          )}
          {isReady && (
            <Button variant="danger" onClick={onInstall}>
              Restart &amp; install
            </Button>
          )}
        </div>

        <Toggle
          checked={autoUpdate}
          onChange={onToggleAutoUpdate}
          label="Check for updates automatically"
          hint="Check on launch, then periodically in the background"
        />
      </div>
    </Card>
  );
}

function InfoRow({
  label,
  value,
  mono,
  accent,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-neutral-400">
        {label}
      </span>
      <span
        className={`${mono ? "font-mono" : ""} ${accent ? "text-indigo-300" : "text-neutral-100"} text-sm`}
      >
        {value}
      </span>
    </div>
  );
}

function ReleaseNotes({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="rounded-md border border-neutral-800 bg-neutral-950/40"
    >
      <summary className="cursor-pointer px-3 py-2 text-sm text-neutral-300">
        Release notes
      </summary>
      <pre className="whitespace-pre-wrap border-t border-neutral-800 px-3 py-2 text-xs text-neutral-300">
        {text}
      </pre>
    </details>
  );
}

function statusLabel(u: UpdateStatus): string {
  switch (u.state) {
    case "idle":
      return "Not checked";
    case "checking":
      return "Checking…";
    case "available":
      return "Update available";
    case "downloading":
      return `Downloading (${u.percent}%)`;
    case "ready":
      return "Ready to install";
    case "none":
      return "Up to date";
    case "error":
      return "Error";
  }
}
