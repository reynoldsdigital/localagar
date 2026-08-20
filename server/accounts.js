// Simple file-backed account store for LocalAgar.
//
// Accounts are kept in memory and persisted to data/accounts.json. Passwords
// are per-account salted + SHA-256 hashed — good enough for a local/LAN game
// without bringing in a real auth backend. The store is process-local: a
// single server instance owns the file.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "data");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");

const accounts = new Map();   // name(lower) -> account object
let flushTimer = null;

function load() {
  try {
    if (!fs.existsSync(ACCOUNTS_FILE)) return;
    const raw = fs.readFileSync(ACCOUNTS_FILE, "utf8");
    const obj = JSON.parse(raw);
    for (const [k, v] of Object.entries(obj)) accounts.set(k.toLowerCase(), v);
    console.log(`[accounts] loaded ${accounts.size} account(s)`);
  } catch (e) {
    console.warn(`[accounts] load failed: ${e.message}`);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, 2000);
}

function flushNow() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = {};
    for (const [k, v] of accounts) obj[k] = v;
    const tmp = ACCOUNTS_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, ACCOUNTS_FILE);
  } catch (e) {
    console.warn(`[accounts] flush failed: ${e.message}`);
  }
}

function hash(password, salt) {
  return crypto.createHash("sha256").update(salt + ":" + password).digest("hex");
}

// Login or register. Returns { ok, account, created } or { ok:false, reason }.
export function login(name, password) {
  const key = String(name || "").trim().toLowerCase();
  const display = String(name || "").trim();
  if (!key || key.length > 24) return { ok: false, reason: "Invalid name" };
  if (typeof password !== "string" || password.length < 1) return { ok: false, reason: "Password required" };
  let acc = accounts.get(key);
  if (acc) {
    if (acc.passHash !== hash(password, acc.salt)) return { ok: false, reason: "Wrong password" };
    acc.lastSeen = Date.now();
    return { ok: true, account: acc, created: false };
  }
  const salt = crypto.randomBytes(8).toString("hex");
  acc = {
    name: display,
    salt,
    passHash: hash(password, salt),
    gold: 0, level: 1, xp: 0, rankPoints: 0,
    kills: 0, playerKills: 0, virusesEaten: 0, totalMassEaten: 0,
    hasEatenPlayer: false, bestScore: 0,
    createdAt: Date.now(), lastSeen: Date.now(),
  };
  accounts.set(key, acc);
  scheduleFlush();
  return { ok: true, account: acc, created: true };
}

// Persist a player's current stats back to their account.
export function savePlayer(player) {
  if (!player || !player.accountName) return;
  const acc = accounts.get(player.accountName.toLowerCase());
  if (!acc) return;
  acc.gold = player.gold;
  acc.level = player.level;
  acc.xp = player.xp;
  acc.rankPoints = player.rankPoints;
  acc.kills = player.kills;
  acc.playerKills = player.playerKills;
  acc.virusesEaten = player.virusesEaten;
  acc.totalMassEaten = Math.floor(player.totalMassEaten);
  acc.hasEatenPlayer = !!player.hasEatenPlayer;
  acc.bestScore = Math.max(acc.bestScore || 0, player.bestScore || 0, player.runMaxMass || 0);
  acc.lastSeen = Date.now();
  scheduleFlush();
}

// Apply a saved account's stats to a freshly created player (before they
// spawn into the world so the run-start snapshot captures loaded totals).
export function applyAccount(player, account) {
  if (!account) return;
  player.accountName = account.name;
  player.gold = account.gold || 0;
  player.level = account.level || 1;
  player.xp = account.xp || 0;
  player.rankPoints = account.rankPoints || 0;
  player.kills = account.kills || 0;
  player.playerKills = account.playerKills || 0;
  player.virusesEaten = account.virusesEaten || 0;
  player.totalMassEaten = account.totalMassEaten || 0;
  player.hasEatenPlayer = !!account.hasEatenPlayer;
  player.bestScore = account.bestScore || 0;
  player._lastRankDivIndex = player.getRankInfo().divIndex;
}

export function flushAll() { flushNow(); }

load();
