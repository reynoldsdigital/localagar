// Direct test: spawn a player, place a pellet exactly on the player, see if
// the next snapshot picks it up. Use the server's debug commands.
import { WebSocket } from "ws";

const URL = process.env.URL || "ws://localhost:3000/ws";
const ws = new WebSocket(URL);

let playerId = null;
let cellPos = null;
let snapshots = 0;
let lastMass = null;
let first = true;

ws.on("open", () => {
  console.log("[test] connected");
  ws.send(JSON.stringify({ t: "join", name: "EatDirect", mode: "ffa" }));
});

// Query all snapshots to find one where I have a cell, then spawn pellets
// on top of it via the dev cheats command (if supported). Instead, just
// walk the player around slowly and look at count of nearby pellets.
ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    playerId = msg.selfId;
    console.log("[test] welcomed", playerId);
  } else if (msg.t === "snapshot") {
    snapshots++;
    const me = msg.cells.find(c => c.o === playerId);
    if (me) {
      if (first) {
        first = false;
        cellPos = { x: me.x, y: me.y };
        console.log(`[test] cell at (${me.x.toFixed(1)}, ${me.y.toFixed(1)}) mass=${me.m.toFixed(1)}`);
      }
      lastMass = me.m;
      // Sample one snapshot to see the local view
      if (snapshots === 5) {
        const nearby = msg.pellets.filter(p => {
          const dx = p.x - me.x, dy = p.y - me.y;
          return Math.hypot(dx, dy) < 100;
        });
        console.log(`[test] pellet sample — total=${msg.pellets.length} within100=${nearby.length}`);
        if (nearby.length > 0) {
          const p = nearby[0];
          const dist = Math.hypot(p.x - me.x, p.y - me.y);
          console.log(`[test] nearest pellet: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) mass=${p.m} dist=${dist.toFixed(1)} cellRadius=${Math.sqrt(me.m) * 4}`);
        }
      }
    }
  }
});

ws.on("error", e => console.error("[test] error", e.message));

// Move directly to the cell's spawn position so we don't drift
setTimeout(() => {
  if (cellPos) {
    console.log(`[test] holding target at (${cellPos.x}, ${cellPos.y})`);
    setInterval(() => {
      ws.send(JSON.stringify({ t: "input", x: cellPos.x, y: cellPos.y }));
    }, 50);
  }
}, 200);

setTimeout(() => {
  console.log(`[test] lastMass=${lastMass} snapshots=${snapshots}`);
  ws.close();
  process.exit(0);
}, 5000);
