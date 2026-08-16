// Eat-debug: connect, hold position at spawn, log every nearby pellet and the
// computed distances. We'll see if the cell is actually touching any pellet.
import { WebSocket } from "ws";

const URL = process.env.URL || "ws://localhost:3000/ws";
const ws = new WebSocket(URL);

let playerId = null;
let cellPos = null;
let snapshots = 0;
let firstMass = null;
let lastMass = null;
let closestSeen = Infinity;

ws.on("open", () => {
  console.log("[test] connected");
  ws.send(JSON.stringify({ t: "join", name: "EatDebug", mode: "ffa" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    playerId = msg.selfId;
    console.log("[test] welcomed", playerId, "world=", msg.world);
  } else if (msg.t === "snapshot") {
    snapshots++;
    const me = msg.cells.find(c => c.o === playerId);
    if (me) {
      if (firstMass == null) firstMass = me.m;
      lastMass = me.m;
      if (!cellPos) {
        cellPos = { x: me.x, y: me.y };
        console.log(`[test] cell at (${me.x.toFixed(1)}, ${me.y.toFixed(1)}) mass=${me.m.toFixed(1)} radius=${(Math.sqrt(me.m) * 4).toFixed(1)}`);
      }
      const near = msg.pellets.map(p => {
        const dx = p.x - me.x, dy = p.y - me.y;
        return { p, dist: Math.hypot(dx, dy) };
      }).sort((a, b) => a.dist - b.dist);
      if (near.length > 0 && near[0].dist < closestSeen) closestSeen = near[0].dist;
      if (snapshots % 5 === 0) {
        const cellR = Math.sqrt(me.m) * 4;
        const sumR = cellR + 7 * 0.6;
        const myCells = msg.cells.filter(c => c.o === playerId);
        const bots = msg.cells.filter(c => c.o !== playerId);
        const nearby = bots.map(c => ({ c, d: Math.hypot(c.x - me.x, c.y - me.y) })).sort((a, b) => a.d - b.d).slice(0, 3);
        console.log(`[t=${(snapshots/30).toFixed(1)}s] myCells=${myCells.length} myMass=${me.m.toFixed(1)} cellR=${cellR.toFixed(1)} pickupR=${sumR.toFixed(1)} pellets=${msg.pellets.length} closestP=${near[0]?.dist.toFixed(1)} nearbyBots=${nearby.map(n => `bot@${n.d.toFixed(0)}m${n.c.m.toFixed(0)}`).join(",")}`);
      }
    }
  }
});

ws.on("error", e => console.error("[test] error", e.message));

// Hold position at the cell's location so we don't drift
setTimeout(() => {
  if (cellPos) {
    console.log(`[test] holding target at (${cellPos.x}, ${cellPos.y})`);
    setInterval(() => {
      ws.send(JSON.stringify({ t: "input", x: cellPos.x, y: cellPos.y }));
    }, 50);
  }
}, 200);

setTimeout(() => {
  console.log(`[test] lastMass=${lastMass} firstMass=${firstMass} closestEver=${closestSeen.toFixed(1)}`);
  if (lastMass > firstMass) {
    console.log(`[test] PASS — mass grew by ${(lastMass - firstMass).toFixed(1)}`);
  } else {
    console.log(`[test] FAIL — mass did not grow; closest pellet ever seen was ${closestSeen.toFixed(1)}px`);
  }
  ws.close();
  process.exit(0);
}, 10000);
