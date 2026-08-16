// End-to-end smoke test for the localagar server:
// - connects to /ws
// - joins an FFA room
// - feeds input/move/split/eject/macro/gold
// - receives snapshots for ~3 seconds and asserts structure

import { WebSocket } from "ws";

const URL = process.env.URL || "ws://127.0.0.1:3000/ws";
const ROUNDS = 60; // ~2.5s at 24 messages

const ws = new WebSocket(URL);

let welcome = null;
let snapshotCount = 0;
let leaderboardCount = 0;
let lastSnapshot = null;

const t0 = Date.now();

ws.on("open", () => {
  console.log(`[ws] connected to ${URL}`);
  ws.send(JSON.stringify({ t: "join", name: "SmokeBot", mode: "ffa" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    welcome = msg;
    console.log(`[ws] welcome selfId=${msg.selfId} mode=${msg.mode} world=${msg.world.WIDTH}x${msg.world.HEIGHT}`);
  } else if (msg.t === "snapshot") {
    snapshotCount++;
    lastSnapshot = msg;
    if (snapshotCount === 1) {
      console.log(`[ws] first snapshot cells=${msg.cells.length} pellets=${msg.pellets.length} viruses=${msg.viruses.length} you=${msg.you.length}`);
    }
  } else if (msg.t === "leaderboard") {
    leaderboardCount++;
  } else {
    console.log("[ws] unknown msg", msg);
  }
});

ws.on("error", (e) => { console.error("[ws] error", e.message); process.exit(2); });
ws.on("close", () => console.log("[ws] closed"));

// Feed some inputs
setTimeout(() => ws.send(JSON.stringify({ t: "input", x: 6000, y: 6000 })), 50);
setTimeout(() => ws.send(JSON.stringify({ t: "split" })), 200);
setTimeout(() => ws.send(JSON.stringify({ t: "eject", key: "w" })), 400);
setTimeout(() => ws.send(JSON.stringify({ t: "macro", key: "x" })), 600);
setTimeout(() => ws.send(JSON.stringify({ t: "gold", key: "a" })), 800);
setTimeout(() => ws.send(JSON.stringify({ t: "gold", key: "s" })), 900);

setTimeout(() => {
  const ok =
    welcome && welcome.selfId &&
    snapshotCount > 5 &&
    lastSnapshot && lastSnapshot.you && lastSnapshot.cells && lastSnapshot.pellets && lastSnapshot.viruses;
  console.log(`[smoke] snapshots=${snapshotCount} leaderboards=${leaderboardCount} elapsed=${Date.now()-t0}ms`);
  console.log(ok ? "[smoke] OK" : "[smoke] FAIL");
  ws.close();
  process.exit(ok ? 0 : 1);
}, ROUNDS * 30 + 200);
