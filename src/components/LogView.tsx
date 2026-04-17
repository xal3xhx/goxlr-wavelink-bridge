import { useEffect, useRef } from "react";
import type { LogMessage } from "../../electron/preload";
import { Card } from "./ui";

const levelClass: Record<LogMessage["level"], string> = {
  debug: "text-neutral-500",
  info: "text-neutral-300",
  warn: "text-amber-300",
  error: "text-rose-300",
};

export function LogView({ logs }: { logs: LogMessage[] }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <Card title="Logs">
      <div
        ref={ref}
        className="max-h-[60vh] overflow-y-auto rounded-md border border-neutral-800 bg-neutral-950/60 p-3 font-mono text-[11px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <p className="text-neutral-500">No log messages yet.</p>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={levelClass[l.level]}>
              <span className="text-neutral-600">
                {new Date(l.time).toLocaleTimeString()}{" "}
              </span>
              <span className="text-neutral-500">[{l.tag}]</span>{" "}
              {l.message}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
