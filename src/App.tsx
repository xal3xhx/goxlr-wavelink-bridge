import { useState } from "react";
import { Dashboard } from "./components/Dashboard";
import { Mappings } from "./components/Mappings";
import { Settings } from "./components/Settings";
import { UpdateBanner } from "./components/UpdateBanner";
import { LogView } from "./components/LogView";
import { Button, StatusDot } from "./components/ui";
import { useApp } from "./state/useApp";

type Tab = "dashboard" | "mappings" | "settings" | "logs";

const TABS: { id: Tab; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "mappings", label: "Mappings" },
  { id: "settings", label: "Settings" },
  { id: "logs", label: "Logs" },
];

export default function App() {
  const app = useApp();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [updateDismissed, setUpdateDismissed] = useState(false);

  if (!app.config) {
    return (
      <div className="flex h-full items-center justify-center text-neutral-400">
        Loading…
      </div>
    );
  }

  const g = app.status?.goxlr.connected ?? false;
  const w = app.status?.wavelink.connected ?? false;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-neutral-800 bg-neutral-900/60 px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold tracking-tight">
            GoXLR-WaveLink Bridge
          </h1>
          <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono text-[10px] text-neutral-400">
            v{APP_VERSION}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <HeaderStatus label="GoXLR" on={g} />
          <HeaderStatus label="Wave Link" on={w} />
          <Button variant="secondary" onClick={() => void app.reconnect()}>
            Reconnect
          </Button>
          <Button variant="ghost" onClick={app.quit}>
            Quit
          </Button>
        </div>
      </header>

      <nav className="flex items-center gap-1 border-b border-neutral-800 bg-neutral-950 px-4">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-indigo-500 text-neutral-100"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-6">
        {!updateDismissed && (
          <div className="mb-4">
            <UpdateBanner
              update={app.update}
              onDownload={() => void app.downloadUpdate()}
              onInstall={app.installUpdate}
              onDismiss={() => setUpdateDismissed(true)}
            />
          </div>
        )}

        {tab === "dashboard" && (
          <Dashboard status={app.status} channels={app.channels} />
        )}
        {tab === "mappings" && (
          <Mappings
            config={app.config}
            status={app.status}
            onSave={app.saveConfig}
          />
        )}
        {tab === "settings" && (
          <Settings
            config={app.config}
            autoStart={app.autoStart}
            appVersion={APP_VERSION}
            update={app.update}
            updateLastChecked={app.updateLastChecked}
            latestVersion={app.latestVersion}
            onSave={app.saveConfig}
            onSetAutoStart={app.setAutoStart}
            onReconnect={app.reconnect}
            onCheckForUpdates={app.checkForUpdates}
            onDownloadUpdate={app.downloadUpdate}
            onInstallUpdate={app.installUpdate}
            onOpenExternal={app.openExternal}
          />
        )}
        {tab === "logs" && <LogView logs={app.logs} />}
      </main>
    </div>
  );
}

function HeaderStatus({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-neutral-400">
      <StatusDot on={on} />
      <span>{label}</span>
    </div>
  );
}

declare const APP_VERSION: string;
