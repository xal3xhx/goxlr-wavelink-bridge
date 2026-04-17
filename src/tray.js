/**
 * Windows system tray using a compiled C# WinForms NotifyIcon helper.
 * Communicates with Node via stdin/stdout JSON lines.
 */
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "./logger.js";

const log = createLogger("Tray");

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRAY_EXE = join(__dirname, "..", "tray-helper", "bin", "Release", "net9.0-windows", "tray-helper.exe");

export class Tray extends EventEmitter {
  #proc = null;
  #ready = false;

  async start() {
    return new Promise((resolve, reject) => {
      log.info("Starting tray helper...");

      this.#proc = spawn(TRAY_EXE, [], {
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: false,
      });

      this.#proc.stderr.on("data", (data) => {
        const msg = data.toString().trim();
        if (msg) log.warn(`Tray stderr: ${msg}`);
      });

      let buf = "";
      this.#proc.stdout.on("data", (data) => {
        buf += data.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line);
            if (msg.type === "ready" && !this.#ready) {
              this.#ready = true;
              log.info("System tray ready");
              resolve();
            } else if (msg.type) {
              this.emit("action", msg.type);
            }
          } catch {}
        }
      });

      this.#proc.on("error", (err) => {
        log.error(`Tray process error: ${err.message}`);
        if (!this.#ready) reject(err);
      });

      this.#proc.on("exit", (code) => {
        log.info(`Tray process exited (code ${code})`);
        this.#proc = null;
        if (!this.#ready) reject(new Error(`Tray exited with code ${code}`));
      });

      setTimeout(() => {
        if (!this.#ready) reject(new Error("Tray startup timed out"));
      }, 10000);
    });
  }

  update({ status, icon, tooltip }) {
    this.#send({ cmd: "update", status, icon, tooltip });
  }

  kill() {
    this.#send({ cmd: "exit" });
    setTimeout(() => {
      if (this.#proc) {
        this.#proc.kill();
        this.#proc = null;
      }
    }, 1000);
  }

  #send(msg) {
    if (!this.#proc || !this.#proc.stdin.writable) return;
    try {
      this.#proc.stdin.write(JSON.stringify(msg) + "\n");
    } catch {}
  }
}
