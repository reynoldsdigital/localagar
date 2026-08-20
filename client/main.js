// Bootstraps the game. Wires UI -> net -> input -> render.

import { Net } from "./net.js";
import { RANKS } from "../shared/ranks.js";
import { Input } from "./input.js";
import { Renderer } from "./render.js";

const canvas = document.getElementById("game");
const menu = document.getElementById("menu");
const hudEl = document.getElementById("hud");
const leaderboardEl = document.getElementById("leaderboard");
const minimapEl = document.getElementById("minimap");
const deathEl = document.getElementById("death");
const pauseMenuEl = document.getElementById("pause-menu");
const respawnBtn = document.getElementById("respawn-btn");
const resumePauseBtn = document.getElementById("resume-pause-btn");
const menuPauseBtn = document.getElementById("menu-pause-btn");
const scoreEl = document.getElementById("score");
const rankEl = document.getElementById("rank");
const goldEl = document.getElementById("gold");
const levelEl = document.getElementById("level");
const xpFillEl = document.getElementById("xp-fill");
const modeEl = document.getElementById("mode-label");
const leaderRowsEl = document.getElementById("leader-rows");
const minimapCanvas = document.getElementById("minimap-canvas");
const form = document.getElementById("join-form");
const clanFieldset = document.getElementById("clan-fieldset");
const modeFieldset = document.getElementById("mode-fieldset");
const colorSwatchesEl = document.getElementById("color-swatches");
const customColorInput = document.getElementById("custom-color-input");
const skinFieldset = document.getElementById("skin-fieldset");
const diagEl = document.getElementById("diag");
const rankPillEl = document.getElementById("rank-pill");
const rankLabelEl = document.getElementById("rank-label");
const rankIconEl = document.getElementById("rank-icon");
const rankProgressEl = document.getElementById("rank-progress");
const rankProgressFillEl = document.getElementById("rank-progress-fill");
const rankRpEl = document.getElementById("rank-rp");
const objectivesEl = document.getElementById("objectives");
const objKillsEl = document.getElementById("obj-kills");
const objPlayerKillsEl = document.getElementById("obj-player-kills");
const objVirusesEl = document.getElementById("obj-viruses");
const massGateEl = document.getElementById("mass-gate");
const rankUpToastEl = document.getElementById("rank-up-toast");
const rankUpLabelEl = document.getElementById("rank-up-label");
const nameInput = document.getElementById("name-input");
const passwordInput = document.getElementById("password-input");
const rememberCheck = document.getElementById("remember-check");
const loginErrEl = document.getElementById("login-err");
const deathRunMassEl = document.getElementById("death-run-mass");
const deathRunDurEl = document.getElementById("death-run-duration");
const deathRunKillsEl = document.getElementById("death-run-kills");
const deathRunVirusesEl = document.getElementById("death-run-viruses");
const deathRunGoldEl = document.getElementById("death-run-gold");
const deathRunRpEl = document.getElementById("death-run-rp");
const deathLtRankEl = document.getElementById("death-lt-rank");
const deathLtLevelEl = document.getElementById("death-lt-level");
const deathLtGoldEl = document.getElementById("death-lt-gold");
const deathLtKillsEl = document.getElementById("death-lt-kills");
const deathLtVirusesEl = document.getElementById("death-lt-viruses");
const deathLtBestEl = document.getElementById("death-lt-best");
const deathRespawnBtn = document.getElementById("death-respawn-btn");
const deathMenuBtn = document.getElementById("death-menu-btn");

// --- Remember last login (name + optional password) ---
try {
  const saved = JSON.parse(localStorage.getItem("localagar.login") || "null");
  if (saved && saved.name) {
    nameInput.value = saved.name;
    if (saved.password) { passwordInput.value = saved.password; rememberCheck.checked = true; }
  }
} catch (_) {}

// --- Color picker: update skin previews in real time ---
function getSelectedColor() {
  // Check if custom color input was recently changed (takes priority
  // when the user interacted with it). Otherwise use the checked swatch.
  const checkedSwatch = colorSwatchesEl.querySelector('input[name="color"]:checked');
  if (checkedSwatch) return checkedSwatch.value;
  return customColorInput.value || "#4ecdc4";
}

function updateSkinPreviewColors() {
  const color = getSelectedColor();
  skinFieldset.style.setProperty("--cell-color", color);
}

// Update previews whenever a color swatch or custom color changes
for (const input of colorSwatchesEl.querySelectorAll('input[name="color"]')) {
  input.addEventListener("change", () => {
    // Sync custom color input to match swatch
    customColorInput.value = getSelectedColor();
    updateSkinPreviewColors();
  });
}
customColorInput.addEventListener("input", () => {
  // Deselect swatches when using custom picker
  const checked = colorSwatchesEl.querySelector('input[name="color"]:checked');
  if (checked) checked.checked = false;
  updateSkinPreviewColors();
});
// Set initial preview color
updateSkinPreviewColors();

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
  level: 1,
  xp: 0,
  xpNeeded: 100,
  paused: false,
};

let net, input, renderer;
let intentionalClose = false;  // true when WE close the socket (don't show an error)

// Disconnect and return to the main menu.
function exitToMenu() {
  intentionalClose = true;
  if (net && net.ws) { try { net.ws.close(); } catch (_) {} }
  menu.hidden = false;
  hudEl.hidden = true;
  leaderboardEl.hidden = true;
  minimapEl.hidden = true;
  pauseMenuEl.hidden = true;
  deathEl.hidden = true;
  objectivesEl.hidden = true;
  state.paused = false;
  if (input) input.stop();
}

// ---------------------------------------------------------------------------
// Pause-menu button handlers — registered ONCE, outside startGame() so they
// are not duplicated on rejoin.
// ---------------------------------------------------------------------------

// ESC toggles the pause menu (only while in-game, not on the main menu).
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!menu.hidden) return;            // don't pause from the main menu
  if (!net) return;                    // not in a game yet
  state.paused = !state.paused;
  pauseMenuEl.hidden = !state.paused;
});

// Resume — just hides the pause overlay.
resumePauseBtn.addEventListener("click", () => {
  state.paused = false;
  pauseMenuEl.hidden = true;
});

// Respawn — tell the server to kill current cells and spawn fresh.
respawnBtn.addEventListener("click", () => {
  if (net) {
    net.respawn();
  }
  state.paused = false;
  pauseMenuEl.hidden = true;
});

// Exit to menu — disconnect and return to the main menu.
menuPauseBtn.addEventListener("click", exitToMenu);

// Death-screen buttons (registered once).
deathRespawnBtn.addEventListener("click", () => {
  if (net) net.respawn();
  deathEl.hidden = true;
});
deathMenuBtn.addEventListener("click", exitToMenu);

// ---------------------------------------------------------------------------
// Main menu / join form
// ---------------------------------------------------------------------------

// Show/hide clan picker based on mode
for (const r of modeFieldset.querySelectorAll('input[type="radio"]')) {
  r.addEventListener("change", () => {
    const checked = modeFieldset.querySelector('input[type="radio"]:checked');
    clanFieldset.hidden = !checked || checked.value !== "cffa";
  });
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = (nameInput.value || "Player").trim();
  const password = passwordInput.value || "";
  const remember = rememberCheck.checked;
  if (loginErrEl) loginErrEl.textContent = "";
  if (!password) {
    if (loginErrEl) loginErrEl.textContent = "Enter a password to log in (or register).";
    return;
  }
  // Remember the login locally so next time it's one click.
  try {
    localStorage.setItem("localagar.login", JSON.stringify(
      remember ? { name, password } : { name }
    ));
  } catch (_) {}
  const mode = modeFieldset.querySelector('input[name="mode"]:checked').value;
  const skin = document.querySelector('input[name="skin"]:checked')?.value || "solid";
  const color = getSelectedColor();
  const clan = mode === "cffa"
    ? document.querySelector('input[name="clan"]:checked')?.value || "RED"
    : null;
  startGame({ name, password, mode, clan, skin, color });
});

function startGame({ name, password, mode, clan, skin, color }) {
  state.mode = mode;
  state.skin = skin;
  state.paused = false;
  pauseMenuEl.hidden = true;
  modeEl.textContent = mode === "event" ? "Etkinlik" : mode.toUpperCase();

  net = new Net();
  renderer = new Renderer(canvas, minimapCanvas);
  input = new Input(canvas, net, renderer);

  net.on("welcome", (msg) => {
    console.log("[main] welcome received", msg);
    state.selfId = msg.selfId;
    state.world = msg.world;
    renderer.setWorld(msg.world);
    // We're in the room — show the game, hide the menu.
    menu.hidden = true;
    hudEl.hidden = false;
    leaderboardEl.hidden = false;
    minimapEl.hidden = false;
    deathEl.hidden = true;
    pauseMenuEl.hidden = true;
    canvas.focus();
  });
  net.on("snapshot", (msg) => renderer.applySnapshot(msg));
  net.on("leaderboard", (msg) => renderer.applyLeaderboard(msg.rows));
  net.on("death", (msg) => showDeath(msg));
  net.on("login_ok", (msg) => {
    console.log("[main] login ok", msg.name, msg.created ? "(new account)" : "(returning)");
    if (loginErrEl) loginErrEl.textContent = "";
    // Now join the room with the saved/confirmed name.
    net.join({ name: msg.name, mode, clan, skin, color });
  });
  net.on("login_fail", (msg) => {
    console.warn("[main] login failed", msg && msg.reason);
    if (loginErrEl) loginErrEl.textContent = (msg && msg.reason) || "Login failed";
    // Stay on the menu; the inline error explains what happened.
    // (Mark the close intentional so the close handler doesn't pop a
    //  red "Disconnected" banner for a deliberate exit.)
    intentionalClose = true;
    try { if (net && net.ws) net.ws.close(); } catch (_) {}
    menu.hidden = false;
    hudEl.hidden = true;
  });
  net.on("open", () => {
    console.log("[main] ws open, sending login");
    net.login(name, password);
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
    pauseMenuEl.hidden = true;
    state.paused = false;
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
  state.level = renderer.getLevel();
  state.xp = renderer.getXP();
  state.xpNeeded = renderer.getXPNeeded();
  scoreEl.textContent = Math.floor(state.score);
  rankEl.textContent = "#" + (state.rank || "—");
  goldEl.textContent = state.gold | 0;
  levelEl.textContent = state.level | 1;
  // Update XP bar
  if (xpFillEl) {
    const xpPct = state.xpNeeded > 0 ? (state.xp / state.xpNeeded) * 100 : 0;
    xpFillEl.style.width = `${Math.min(100, xpPct)}%`;
  }
  // The death screen is shown by the "death" event (with stats) and hidden
  // again on respawn; here we only clear it if the player is alive.
  if (state.alive) deathEl.hidden = true;
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

// Populate + show the death-review screen.
function showDeath(msg) {
  if (!msg) return;
  const run = msg.run || {};
  const lt = msg.lifetime || {};
  if (deathRunMassEl) deathRunMassEl.textContent = run.maxMass || 0;
  if (deathRunDurEl) deathRunDurEl.textContent = fmtDuration(run.duration || 0);
  if (deathRunKillsEl) deathRunKillsEl.textContent = run.kills || 0;
  if (deathRunVirusesEl) deathRunVirusesEl.textContent = run.virusesEaten || 0;
  if (deathRunGoldEl) deathRunGoldEl.textContent = "+" + (run.goldGained || 0);
  if (deathRunRpEl) deathRunRpEl.textContent = "+" + (run.rpGained || 0);
  if (deathLtRankEl) deathLtRankEl.textContent = lt.rankLabel || "Bronze I";
  if (deathLtLevelEl) deathLtLevelEl.textContent = lt.level || 1;
  if (deathLtGoldEl) deathLtGoldEl.textContent = lt.gold || 0;
  if (deathLtKillsEl) deathLtKillsEl.textContent = lt.kills || 0;
  if (deathLtVirusesEl) deathLtVirusesEl.textContent = lt.virusesEaten || 0;
  if (deathLtBestEl) deathLtBestEl.textContent = lt.bestScore || 0;
  deathEl.hidden = false;
}

function fmtDuration(sec) {
  sec = Math.floor(sec || 0);
  if (sec < 60) return sec + "s";
  const m = Math.floor(sec / 60), r = sec % 60;
  return m + "m " + r + "s";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}


// ---------------------------------------------------------------------------
// Ranking / objectives HUD
// ---------------------------------------------------------------------------

function updateRankHUD() {
  if (!renderer) return;
  const r = renderer.getRank();
  if (!r) {
    if (rankPillEl) rankPillEl.hidden = true;
    if (objectivesEl) objectivesEl.hidden = true;
    return;
  }
  if (rankPillEl) rankPillEl.hidden = false;
  if (objectivesEl) objectivesEl.hidden = false;

  const rankMeta = RANKS[r.rank] || RANKS[0];
  if (rankLabelEl) rankLabelEl.textContent = r.label;
  if (rankIconEl) {
    rankIconEl.textContent = rankMeta.short;
    rankIconEl.style.background = rankMeta.color;
    rankIconEl.style.color = (r.rank === 1) ? "#11131a" : "#11131a";
  }
  if (rankProgressEl) rankProgressEl.hidden = !!r.atTop;
  if (rankProgressFillEl) {
    rankProgressFillEl.style.width = `${Math.round(r.progress * 100)}%`;
    rankProgressFillEl.style.background = rankMeta.color;
  }
  if (rankRpEl) rankRpEl.textContent = r.atTop ? "MAX" : `${r.rp}/${r.nextAt} RP`;

  if (objKillsEl) objKillsEl.textContent = r.kills;
  if (objPlayerKillsEl) objPlayerKillsEl.textContent = r.playerKills;
  if (objVirusesEl) objVirusesEl.textContent = r.virusesEaten;

  // Mass-gate indicator: locked until the player has eaten someone AND
  // banked more than 10 gold.
  if (massGateEl) {
    if (r.massUnlocked) {
      massGateEl.textContent = "Gold→Mass: UNLOCKED";
      massGateEl.className = "gate-unlocked";
    } else if (r.hasEatenPlayer) {
      massGateEl.textContent = "Gold→Mass: need >10 gold";
      massGateEl.className = "gate-locked";
    } else {
      massGateEl.textContent = "Gold→Mass: eat a player to unlock";
      massGateEl.className = "gate-locked";
    }
  }

  // Rank-up toast
  const up = renderer.getRankUp();
  if (up && rankUpToastEl) {
    rankUpLabelEl.textContent = up;
    rankUpToastEl.classList.add("show");
  } else if (rankUpToastEl && !up) {
    rankUpToastEl.classList.remove("show");
  }
}

// Run the rank HUD at ~10Hz alongside the existing HUD loop.
setInterval(updateRankHUD, 100);
