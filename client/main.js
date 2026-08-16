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
  showDiag(`JS error: ${e.message}\n${e.filename || ""}:${e.lineno || ""}`);
});
window.addEventListener("unhandledrejection", (e) => {
  showDiag(`Promise error: ${e.reason?.message || e.reason}`);
});
function showDiag(msg) {
  if (!diagEl) return;
  diagEl.textContent = String(msg);
  diagEl.classList.add("show");
  console.warn("[localagar diag]", msg);
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
  input = new Input(canvas, net);
  renderer = new Renderer(canvas, minimapCanvas);

  net.on("welcome", (msg) => {
    state.selfId = msg.selfId;
    state.world = msg.world;
    canvas.focus();
    showDiag(""); // clear any previous diag
  });
  net.on("snapshot", (msg) => renderer.applySnapshot(msg));
  net.on("leaderboard", (msg) => renderer.applyLeaderboard(msg.rows));
  net.on("open", () => {
    net.join({ name, mode, clan });
    menu.hidden = true;
    hudEl.hidden = false;
    leaderboardEl.hidden = false;
    minimapEl.hidden = false;
    showDiag("");
  });
  net.on("error", (e) => {
    showDiag(`WebSocket error: ${e?.message || e || "unknown"}`);
  });
  net.on("close", () => {
    menu.hidden = false;
    hudEl.hidden = true;
    leaderboardEl.hidden = true;
    minimapEl.hidden = true;
    deathEl.hidden = true;
    showDiag("Disconnected from server (WebSocket closed).");
  });

  try {
    net.connect();
  } catch (e) {
    showDiag(`connect() threw: ${e.message}`);
    throw e;
  }
  try { renderer.start(); } catch (e) { showDiag(`renderer error: ${e.message}`); throw e; }
  try { input.start();    } catch (e) { showDiag(`input error: ${e.message}`); throw e; }
  showDiag("Connecting…");
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
