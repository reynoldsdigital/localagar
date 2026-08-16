// Bootstraps the game. Wires UI -> net -> input -> render.

import { Net } from "./net.js";
import { Input } from "./input.js";
import { Renderer } from "./render.js";

const canvas = document.getElementById("game");
const menu = document.getElementById("menu");
const hudEl = document.getElementById("hud");
const leaderboardEl = document.getElementById("leaderboard");
const minimapEl = document.getElementById("minimap");
const deathEl = document.getElementById("death");
const deathCountEl = document.getElementById("death-count");
const scoreEl = document.getElementById("score");
const rankEl = document.getElementById("rank");
const goldEl = document.getElementById("gold");
const modeEl = document.getElementById("mode-label");
const leaderRowsEl = document.getElementById("leader-rows");
const minimapCanvas = document.getElementById("minimap-canvas");
const form = document.getElementById("join-form");
const clanFieldset = document.getElementById("clan-fieldset");
const modeFieldset = document.getElementById("mode-fieldset");
const diagEl = document.getElementById("diag");

// Visible diagnostics so connection / module errors surface even without DevTools.
window.addEventListener("error", (e) => {
  showDiag("JS error", `${e.message}\n${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`);
});
window.addEventListener("unhandledrejection", (e) => {
  const r = e.reason;
  showDiag("Unhandled error", (r && r.message) ? `${r.message}\n${r.stack || ""}` : String(r));
});
function showDiag(title, body) {
  if (!diagEl) return;
  // Allow call style: showDiag("string") or showDiag("Title", "Body")
  let t, b;
  if (arguments.length === 1) { t = "Status"; b = title; }
  else { t = title; b = body || ""; }
  diagEl.innerHTML = "";
  const head = document.createElement("strong");
  head.textContent = t;
  diagEl.appendChild(head);
  const pre = document.createElement("pre");
  pre.style.margin = "0";
  pre.style.whiteSpace = "pre-wrap";
  pre.textContent = b;
  diagEl.appendChild(pre);
  diagEl.classList.add("show");
  console.warn(`[localagar diag] ${t}: ${b}`);
}

let state = {
  selfId: null,
  mode: "ffa",
  world: null,
  alive: true,
  score: 0,
  rank: 0,
  gold: 0,
};

let net, input, renderer;

// Show/hide clan picker based on mode
for (const r of modeFieldset.querySelectorAll('input[type="radio"]')) {
  r.addEventListener("change", () => {
    const checked = modeFieldset.querySelector('input[type="radio"]:checked');
    clanFieldset.hidden = !checked || checked.value !== "cffa";
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = (document.getElementById("name-input").value || "Player").trim();
  const mode = modeFieldset.querySelector('input[name="mode"]:checked').value;
  const clan = mode === "cffa"
    ? document.querySelector('input[name="clan"]:checked')?.value || "RED"
    : null;
  startGame({ name, mode, clan });
});

function startGame({ name, mode, clan }) {
  state.mode = mode;
  modeEl.textContent = mode === "event" ? "Etkinlik" : mode.toUpperCase();

  net = new Net();
  renderer = new Renderer(canvas, minimapCanvas);
  input = new Input(canvas, net, renderer);

  net.on("welcome", (msg) => {
    console.log("[main] welcome received", msg);
    state.selfId = msg.selfId;
    state.world = msg.world;
    canvas.focus();
    showDiag("Connected", `selfId=${msg.selfId} world=${msg.world.WIDTH}x${msg.world.HEIGHT}`);
    setTimeout(() => hideDiag(), 800);
  });
  net.on("snapshot", (msg) => renderer.applySnapshot(msg));
  net.on("leaderboard", (msg) => renderer.applyLeaderboard(msg.rows));
  net.on("open", () => {
    console.log("[main] ws open, sending join");
    net.join({ name, mode, clan });
    menu.hidden = true;
    hudEl.hidden = false;
    leaderboardEl.hidden = false;
    minimapEl.hidden = false;
    showDiag("Connecting to game…", "WebSocket open, waiting for welcome…");
  });
  net.on("error", (e) => {
    console.warn("[main] ws error", e);
    showDiag("WebSocket error", (e && e.message) || String(e) || "unknown");
  });
  net.on("close", (e) => {
    console.warn("[main] ws close", e);
    menu.hidden = false;
    hudEl.hidden = true;
    leaderboardEl.hidden = true;
    minimapEl.hidden = true;
    deathEl.hidden = true;
    showDiag("Disconnected from server",
      `The WebSocket connection was closed.\n` +
      `Code: ${e?.code ?? "?"}\n` +
      `Reason: ${e?.reason || "(none)"}\n` +
      `Was clean: ${e?.wasClean ?? "?"}\n` +
      `URL tried: ${location.protocol === "https:" ? "wss://" : "ws://"}${location.host}/ws`);
  });

  try {
    net.connect();
  } catch (e) {
    showDiag("connect() threw", e.message || String(e));
    throw e;
  }
  try { renderer.start(); } catch (e) { showDiag("renderer error", e.message || String(e)); throw e; }
  try { input.start();    } catch (e) { showDiag("input error", e.message || String(e)); throw e; }
}

function hideDiag() {
  if (!diagEl) return;
  diagEl.classList.remove("show");
}

// Update HUD at ~10 Hz
setInterval(() => {
  if (!renderer) return;
  state.score = renderer.totalMass();
  state.rank = renderer.getRank();
  state.alive = renderer.isAlive();
  state.gold = renderer.getGold();
  scoreEl.textContent = Math.floor(state.score);
  rankEl.textContent = "#" + (state.rank || "—");
  goldEl.textContent = state.gold | 0;
  if (!state.alive) {
    deathEl.hidden = false;
    const remaining = Math.max(0, 1500 - (Date.now() - renderer.getDeathAt()));
    deathCountEl.textContent = Math.max(1, Math.ceil(remaining / 1000));
  } else {
    deathEl.hidden = true;
  }
}, 100);

// Render leaderboard rows
setInterval(() => {
  if (!renderer) return;
  const rows = renderer.getLeaderboard();
  leaderRowsEl.innerHTML = "";
  rows.forEach((r, i) => {
    const li = document.createElement("li");
    if (r.id === state.selfId) li.classList.add("me");
    if (r.bot) li.classList.add("bot");
    li.innerHTML = `<span class="rank">${i + 1}.</span><span class="name">${escapeHtml(r.name)}</span><span class="score">${r.score}</span>`;
    leaderRowsEl.appendChild(li);
  });
}, 500);

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}
