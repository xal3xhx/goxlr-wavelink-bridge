export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel: number = LEVELS.info;

type LogSink = (level: LogLevel, tag: string, message: string) => void;
const sinks: LogSink[] = [];

function ts(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function fmt(args: unknown[]): string {
  return args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? a.stack ?? a.message
          : JSON.stringify(a),
    )
    .join(" ");
}

function log(level: LogLevel, tag: string, ...args: unknown[]): void {
  if (LEVELS[level] < currentLevel) return;
  const message = fmt(args);
  const prefix = `[${ts()}] [${level.toUpperCase().padEnd(5)}] [${tag}]`;

  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);

  for (const sink of sinks) {
    try {
      sink(level, tag, message);
    } catch {
      /* swallow sink errors */
    }
  }
}

export function setLevel(level: LogLevel): void {
  currentLevel = LEVELS[level];
}

export function addSink(sink: LogSink): () => void {
  sinks.push(sink);
  return () => {
    const i = sinks.indexOf(sink);
    if (i >= 0) sinks.splice(i, 1);
  };
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export function createLogger(tag: string): Logger {
  return {
    debug: (...args) => log("debug", tag, ...args),
    info: (...args) => log("info", tag, ...args),
    warn: (...args) => log("warn", tag, ...args),
    error: (...args) => log("error", tag, ...args),
  };
}
