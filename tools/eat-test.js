// Eat test: connect, drip input toward something, count how many snapshots show
// the player's mass increasing. Pins server snapshot: snapshots include every
// cell in the player's viewport, so we read our own cell's m field.
import { WebSocket } from "ws";

const URL = process.env.URL || "ws://localhost:3000/ws";
const ws = new WebSocket(URL);

let playerId = null;
let snapshots = 0;
let firstMass = null;
let lastMass = null;
let maxMass = 0;
let startPos = null;
let lastPos = null;

const t0 = Date.now();

ws.on("open", () => {
  console.log("[test] connected");
  ws.send(JSON.stringify({ t: "join", name: "EatTest", mode: "ffa" }));
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
      if (me.m > maxMass) maxMass = me.m;
      if (!startPos) startPos = { x: me.x, y: me.y };
      lastPos = { x: me.x, y: me.y };
    }
  }
});

ws.on("error", e => console.error("[test] error", e.message));

// Move randomly so we actually scan the world
setTimeout(() => {
  console.log("[test] sending random walk input to trigger pellet pickups");
  let i = 0;
  const interval = setInterval(() => {
    if (i++ > 60) { clearInterval(interval); return; }
    // Pick a random direction; use the player's last known position if any
    const cx = (lastPos?.x || 6000);
    const cy = (lastPos?.y || 6000);
    const a = Math.random() * Math.PI * 2;
    const fx = cx + Math.cos(a) * 800;
    const fy = cy + Math.sin(a) * 800;
    ws.send(JSON.stringify({ t: "input", x: fx, y: fy }));
  }, 100);
}, 200);

setTimeout(() => {
  console.log(`[test] snapshots=${snapshots} dt=${Date.now() - t0}ms`);
  console.log(`[test] firstMass=${firstMass} lastMass=${lastMass} maxMass=${maxMass}`);
  if (maxMass > firstMass) {
    console.log(`[test] PASS — mass grew by ${(maxMass - firstMass).toFixed(1)}`);
  } else {
    console.log(`[test] FAIL — mass did not grow`);
  }
  ws.close();
  process.exit(0);
}, 7000);
