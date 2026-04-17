const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
let currentLevel = LEVELS.info;

function ts() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function log(level, tag, ...args) {
  if (LEVELS[level] == null || LEVELS[level] < currentLevel) return;
  const prefix = `[${ts()}] [${level.toUpperCase().padEnd(5)}] [${tag}]`;
  if (level === "error") {
    console.error(prefix, ...args);
  } else if (level === "warn") {
    console.warn(prefix, ...args);
  } else {
    console.log(prefix, ...args);
  }
}

export function setLevel(level) {
  if (LEVELS[level] != null) currentLevel = LEVELS[level];
}

export function createLogger(tag) {
  return {
    debug: (...args) => log("debug", tag, ...args),
    info: (...args) => log("info", tag, ...args),
    warn: (...args) => log("warn", tag, ...args),
    error: (...args) => log("error", tag, ...args),
  };
}
