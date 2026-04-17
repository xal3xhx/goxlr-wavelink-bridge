import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "./logger.js";

const log = createLogger("ConfigUI");

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, "..", "ui");

const MIME_TYPES = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
};

export class ConfigServer {
  #server = null;
  #port = null;
  #goxlr;
  #wavelink;
  #getConfig;
  #saveConfig;
  #onConfigUpdated;

  constructor({ goxlr, wavelink, getConfig, saveConfig, onConfigUpdated }) {
    this.#goxlr = goxlr;
    this.#wavelink = wavelink;
    this.#getConfig = getConfig;
    this.#saveConfig = saveConfig;
    this.#onConfigUpdated = onConfigUpdated;
  }

  start(port = 17565) {
    this.#server = createServer((req, res) => this.#handleRequest(req, res));
    this.#server.listen(port, "127.0.0.1", () => {
      this.#port = this.#server.address().port;
      log.info(`Config UI available at http://127.0.0.1:${this.#port}`);
    });
    this.#server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        log.warn(`Port ${port} in use, trying random port...`);
        this.#server.listen(0, "127.0.0.1", () => {
          this.#port = this.#server.address().port;
          log.info(`Config UI available at http://127.0.0.1:${this.#port}`);
        });
      }
    });
  }

  get url() {
    return this.#port ? `http://127.0.0.1:${this.#port}` : null;
  }

  stop() {
    if (this.#server) {
      this.#server.close();
      this.#server = null;
    }
  }

  #handleRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1`);

    // API endpoints
    if (url.pathname === "/api/status") {
      return this.#handleStatus(req, res);
    }
    if (url.pathname === "/api/config") {
      if (req.method === "GET") return this.#handleGetConfig(req, res);
      if (req.method === "POST") return this.#handleSaveConfig(req, res);
    }
    if (url.pathname === "/api/channels") {
      return this.#handleChannels(req, res);
    }

    // Static files
    this.#serveStatic(url.pathname, res);
  }

  #handleStatus(req, res) {
    this.#json(res, {
      goxlr: {
        connected: this.#goxlr.connected,
        serial: this.#goxlr.serial,
        faders: this.#goxlr.mixer?.fader_status ?? null,
      },
      wavelink: {
        connected: this.#wavelink.connected,
        channels: this.#wavelink.channels.map((c) => ({ id: c.id, name: c.name })),
        mixes: this.#wavelink.mixes.map((m) => ({ id: m.id, name: m.name })),
      },
    });
  }

  #handleGetConfig(req, res) {
    this.#json(res, this.#getConfig());
  }

  async #handleSaveConfig(req, res) {
    try {
      const body = await this.#readBody(req);
      const newConfig = JSON.parse(body);
      this.#saveConfig(newConfig);
      this.#onConfigUpdated(newConfig);
      this.#json(res, { ok: true });
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  }

  #handleChannels(req, res) {
    this.#json(res, {
      wavelink_channels: this.#wavelink.channels.map((c) => ({
        id: c.id,
        name: c.name,
        level: c.level,
        isMuted: c.isMuted,
        mixes: Array.isArray(c.mixes)
          ? c.mixes.map((m) => ({ id: m.id, level: m.level, isMuted: m.isMuted }))
          : [],
      })),
      wavelink_mixes: this.#wavelink.mixes.map((m) => ({
        id: m.id,
        name: m.name,
        level: m.level,
      })),
      goxlr_faders: this.#goxlr.mixer?.fader_status ?? {},
      goxlr_volumes: this.#goxlr.mixer?.levels?.volumes ?? {},
    });
  }

  #serveStatic(pathname, res) {
    if (pathname === "/") pathname = "/index.html";
    const filePath = join(UI_DIR, pathname);

    // Prevent directory traversal
    if (!filePath.startsWith(UI_DIR)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    try {
      const data = readFileSync(filePath);
      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not Found");
    }
  }

  #json(res, data) {
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify(data));
  }

  #readBody(req) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }
}
