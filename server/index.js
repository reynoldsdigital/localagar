// Entry point. Hosts static files + WebSocket /ws endpoint.

import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

import { server } from "./server.js";
import { Player } from "./player.js";
import { Pellet } from "./pellet.js";
import { S2C, C2S } from "./protocol.js";
import { MODES, MODE_CONFIG, CELL } from "../shared/constants.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const PORT = parseInt(process.env.PORT || "3000", 10);

// HOST controls what we bind to (default: all interfaces, so localhost + LAN
// + Tailscale all work). The startup banner separately auto-detects Tailscale
// and prints the tailnet URL.
const HOST = process.env.HOST || "0.0.0.0";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".mjs":  "application/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".ico":  "image/x-icon",
};

// Static roots: /public serves as the site root, plus /client and /shared
// are exposed at the same URLs so the browser can import them as ES modules.
const PUBLIC_DIR = path.join(ROOT, "public");

const httpServer = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
    return;
  }
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  // Map /client/* -> client/*  and  /shared/* -> shared/*  so they live under
  // their on-disk folders, not under public/. Everything else goes to public/.
  let onDiskRel = urlPath.replace(/^\/+/, "");
  let rootDir = PUBLIC_DIR;
  if (onDiskRel.startsWith("client/") || onDiskRel === "client") {
    onDiskRel = onDiskRel.slice("client/".length);
    rootDir = path.join(ROOT, "client");
  } else if (onDiskRel.startsWith("shared/") || onDiskRel === "shared") {
    onDiskRel = onDiskRel.slice("shared/".length);
    rootDir = path.join(ROOT, "shared");
  }

  const resolved = path.normalize(path.join(rootDir, onDiskRel));
  // Prevent traversal: must stay inside the chosen root.
  if (!resolved.startsWith(rootDir + path.sep) && resolved !== rootDir) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    const ext = path.extname(resolved).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (ws, req) => {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").toString();
  console.log(`[ws] connected from ${ip} ua=${(req.headers["user-agent"] || "?").toString().slice(0, 60)}`);
  let player = null;
  let room = null;
  let alive = true;

  ws.on("close", () => {
    alive = false;
    console.log(`[ws] closed ip=${ip} player=${player?.id || "(none)"}`);
    if (player && room) server.removePlayer(player.id, room);
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { console.warn(`[ws] bad json from ${ip}`); return; }
    if (!msg || typeof msg.t !== "string") return;
    if (msg.t === "join") console.log(`[ws] join from ${ip} name=${msg.name} mode=${msg.mode}`);
    else if (alive) console.log(`[ws] ${msg.t} from ${ip}`);

    switch (msg.t) {
      case "join": {
        const mode = (msg.mode in MODE_CONFIG) ? msg.mode : MODES.FFA;
        const clan = mode === MODES.CFFA ? (typeof msg.clan === "string" ? msg.clan : null) : null;
        const skin = typeof msg.skin === "string" ? msg.skin.slice(0, 16) : "solid";
        const color = typeof msg.color === "string" && /^#[0-9a-fA-F]{6}$/.test(msg.color) ? msg.color : null;
        player = new Player({
          id: `p_${Math.random().toString(36).slice(2, 10)}`,
          name: (msg.name || "Player").toString().slice(0, 24),
          mode,
          clan,
          skin,
          color,
        });
        room = server.joinPlayer(player);
        room._conns.set(player.id, ws);

        ws.send(JSON.stringify({
          t: S2C.WELCOME,
          selfId: player.id,
          roomId: room.id,
          mode: room.mode,
          label: room.cfg.label,
          world: room.world,
          constants: { tick: 30 },
        }));
        break;
      }
      case "input": {
        if (!player || !room) return;
        if (typeof msg.x !== "number" || typeof msg.y !== "number") return;
        room.setTarget(player, msg.x, msg.y);
        break;
      }
      case "split": {
        if (!player || !room) return;
        room.split(player);
        break;
      }
      case "eject": {
        if (!player || !room) return;
        if (msg.key !== "w" && msg.key !== "e") return;
        room.ejectMass(player, msg.key);
        break;
      }
      case "macro": {
        if (!player || !room) return;
        if (msg.key === "z") room.split(player);
        else if (msg.key === "x") room.macroFeed(player);
        break;
      }
      case "gold": {
        if (!player || !room) return;
        if (msg.key === "a" || msg.key === "s") room.spendGold(player, msg.key);
        break;
      }
      case "respawn": {
        if (!player || !room) return;
        // Immediate respawn: kill current cells and spawn fresh
        if (player.alive) {
          // Convert current cells to pellets
          for (const c of player.cells) {
            const n = Math.min(20, Math.floor(c.mass / 12));
            for (let i = 0; i < n; i++) {
              const a = Math.random() * Math.PI * 2;
              const r = Math.random() * c.radius;
              const pelletX = Math.max(0, Math.min(room.world.WIDTH, c.x + Math.cos(a) * r));
              const pelletY = Math.max(0, Math.min(room.world.HEIGHT, c.y + Math.sin(a) * r));
              room.pellets.push(new Pellet(pelletX, pelletY, 12, true, player.id));
            }
          }
          player.cells = [];
          player.alive = false;
        }
        // Spawn fresh
        player.alive = true;
        player.spawnInto(room.world, CELL.START_MASS);
        break;
      }
      case "pong": {
        // client latency telemetry — currently unused
        break;
      }
    }
  });
});

httpServer.listen(PORT, HOST, () => {
  const tailIP = (() => { try { return execSync("tailscale ip -4 2>/dev/null", { encoding: "utf8", timeout: 1000 }).trim().split(/\s+/)[0] || null; } catch { return null; } })();
  const lines = [];
  lines.push(`[localagar] listening on ${HOST}:${PORT}`);
  lines.push(`  local      http://localhost:${PORT}`);
  if (tailIP) lines.push(`  tailscale  http://${tailIP}:${PORT}    (use this from other tailnet devices)`);
  if (HOST === "0.0.0.0") lines.push(`  lan        http://<lan-ip>:${PORT}        (any interface)`);
  console.log(lines.join("\n"));
});

process.on("SIGINT", () => {
  console.log("\n[localagar] shutting down…");
  server.shutdown();
  wss.close();
  httpServer.close(() => process.exit(0));
});
