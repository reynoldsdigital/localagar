// Move test: join, send rapid input to (6000,6000), snapshot, check player cell moves.
import { WebSocket } from "ws";

const URL = process.env.URL || "ws://mr:3000/ws";
const ws = new WebSocket(URL);

let playerId = null;
let snapshots = 0;
let firstPos = null;
let lastPos = null;

ws.on("open", () => {
  console.log("[test] connected, sending join");
  ws.send(JSON.stringify({ t: "join", name: "MoveTest", mode: "ffa" }));
});

ws.on("message", (raw) => {
  const msg = JSON.parse(raw.toString());
  if (msg.t === "welcome") {
    playerId = msg.selfId;
    console.log("[test] welcomed", playerId);
  } else if (msg.t === "snapshot") {
    snapshots++;
    const me = msg.cells.find(c => c.o === playerId);
    if (me) {
      if (!firstPos) firstPos = { x: me.x, y: me.y };
      lastPos = { x: me.x, y: me.y };
    }
  }
});

ws.on("error", e => console.error("[test] error", e.message));

// Send input pointing to (6000, 6000) every 50ms for 1.5s
setTimeout(() => {
  console.log("[test] sending input (6000,6000) repeatedly");
  for (let i = 0; i < 30; i++) {
    setTimeout(() => {
      ws.send(JSON.stringify({ t: "input", x: 6000, y: 6000 }));
    }, i * 50);
  }
}, 200);

setTimeout(() => {
  console.log(`[test] snapshots=${snapshots}`);
  if (firstPos && lastPos) {
    const dx = lastPos.x - firstPos.x;
    const dy = lastPos.y - firstPos.y;
    const dist = Math.hypot(dx, dy);
    console.log(`[test] firstPos=${JSON.stringify(firstPos)}`);
    console.log(`[test] lastPos=${JSON.stringify(lastPos)}`);
    console.log(`[test] moved ${dist.toFixed(1)}px`);
    if (dist > 100) console.log("[test] PASS — cell moved");
    else console.log("[test] FAIL — cell did not move");
  } else {
    console.log("[test] FAIL — no player cells seen");
  }
  ws.close();
  process.exit(0);
}, 2000);
