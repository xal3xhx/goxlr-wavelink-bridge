import type { UpdateStatus } from "../../shared/types";
import { Button } from "./ui";

export function UpdateBanner({
  update,
  onDownload,
  onInstall,
  onDismiss,
}: {
  update: UpdateStatus;
  onDownload: () => void;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  if (update.state === "idle" || update.state === "none") return null;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-4 py-3">
      <div className="flex-1 text-sm text-indigo-100">{renderBody(update)}</div>
      <div className="flex items-center gap-2">
        {update.state === "available" && <Button onClick={onDownload}>Download</Button>}
        {update.state === "ready" && (
          <Button onClick={onInstall}>Restart &amp; install</Button>
        )}
        <Button variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

function renderBody(u: UpdateStatus): string {
  switch (u.state) {
    case "checking":
      return "Checking for updates…";
    case "available":
      return `Update available: v${u.version}`;
    case "downloading":
      return `Downloading update… ${u.percent}%`;
    case "ready":
      return `Update v${u.version} ready. Restart to install.`;
    case "error":
      return `Update error: ${u.message}`;
    default:
      return "";
  }
}
