// Player + cell state on the server.
// A player owns one or more `cells` until they die or split off too much.

import { CELL, CLAN_TAGS, massToRadius, nextId } from "../shared/constants.js";
import { rankFromPoints, rankLabel, RANK_RP } from "../shared/ranks.js";

let __cellSerial = 0;

export class Cell {
  constructor(owner, x, y, mass) {
    this.id = nextId("c");
    this.owner = owner;            // Player
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.vx = 0;
    this.vy = 0;
    this.boostVx = 0;              // split boost velocity (decays with friction, not capped by movement speed)
    this.boostVy = 0;
    this.spawnAt = Date.now();
    this.canMergeAt = 0;           // earliest timestamp this cell can re-merge with same owner cells
    this.fromSplit = false;        // true if recently split (cannot re-merge until merge cooldown)
    this.serial = ++__cellSerial;
  }

  get radius() { return massToRadius(this.mass); }
}

export class Player {
  constructor({ id, name, mode, clan, isBot = false, skin = "solid", color = null }) {
    this.id = id;
    this.name = (name || "Player").slice(0, 24);
    this.mode = mode;
    this.isBot = !!isBot;
    this.clan = clan || null;       // CFFA only
    this.color = color || pickColor(id);  // use chosen color, fall back to auto-assigned
    this.skin = skin;               // solid, striped, dotted, gradient
    this.cells = [];                // Cell[]
    this.targetX = 0;               // last input target (mouse or bot)
    this.targetY = 0;
    this.alive = true;
    this.joinedAt = Date.now();
    this.score = 0;                 // sum of cell masses
    this.lastInputAt = Date.now();
    this.gold = 0;                  // currency (integer, displayed to player)
    this.goldAccumulator = 0;       // fractional gold accumulator for passive gain
    this.xp = 0;                    // experience points
    this.level = 1;                 // player level
    this.totalMassEaten = 0;        // lifetime mass eaten for XP calculation
    // --- Ranking / objective tracking ---
    this.kills = 0;                 // number of players (real + bot) eaten
    this.playerKills = 0;           // real players eaten
    this.virusesEaten = 0;          // viruses eaten / popped
    this.rankPoints = 0;            // RP for the competitive ladder
    this.hasEatenPlayer = false;    // gates gold-to-mass (must eat a player first)
    this._lastRankDivIndex = 0;     // last division shown to the client (for rank-up events)
  }

  // Current rank info derived from RP.  Returns the structure from
  // rankFromPoints plus a human label.
  getRankInfo() {
    const info = rankFromPoints(this.rankPoints);
    info.label = rankLabel(info.divIndex);
    return info;
  }

  // Award rank points for an objective.  `kind` is one of
  // "kill_player" | "kill_bot" | "virus".  Returns the new rank info
  // plus a `rankedUp` flag so the room can fire a rank-up notification.
  awardRankPoints(kind) {
    let rp = 0;
    if (kind === "kill_player") { rp = RANK_RP.KILL_PLAYER_RP; this.kills++; this.playerKills++; this.hasEatenPlayer = true; }
    else if (kind === "kill_bot") { rp = RANK_RP.KILL_BOT_RP; this.kills++; this.hasEatenPlayer = true; }
    else if (kind === "virus") { rp = RANK_RP.VIRUS_RP; this.virusesEaten++; }
    if (!rp) return null;
    const before = this._lastRankDivIndex;
    this.rankPoints += rp;
    const info = this.getRankInfo();
    const rankedUp = info.divIndex > before;
    this._lastRankDivIndex = info.divIndex;
    return { ...info, rankedUp, awarded: rp };
  }

  spawnInto(world, mass = CELL.START_MASS) {
    const cell = new Cell(
      this,
      Math.random() * world.WIDTH,
      Math.random() * world.HEIGHT,
      mass,
    );
    cell.canMergeAt = 0;
    this.cells = [cell];
    this.targetX = cell.x;
    this.targetY = cell.y;
    this.score = mass;
    // Spawn a starter cluster of pellets around the cell so the player
    // always has food nearby on joining (otherwise they can decay to
    // MIN_MASS before finding any pellets in the sparse world).
    if (this._starterCluster && typeof this._starterCluster === "function") {
      this._starterCluster(cell.x, cell.y);
    }
    return cell;
  }

  setStarterClusterSpawner(fn) {
    this._starterCluster = fn;
  }

  addFractionalGold(amount) {
    this.goldAccumulator += amount;
    while (this.goldAccumulator >= 1) {
      this.gold++;
      this.goldAccumulator -= 1;
    }
  }

  recomputeScore() {
    let total = 0;
    for (const c of this.cells) total += c.mass;
    this.score = total;
  }

  kill() {
    this.alive = false;
    this.cells.length = 0;
  }
}

const PALETTE = [
  "#ff6b6b", "#4ecdc4", "#ffe066", "#a78bfa", "#fb7185",
  "#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#22d3ee",
  "#f97316", "#10b981", "#e879f9", "#fb923c", "#84cc16",
];

function pickColor(seed) {
  // Stable hash -> palette index
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function clanColor(clan) {
  if (!clan) return null;
  const i = CLAN_TAGS.indexOf(clan);
  if (i < 0) return null;
  // Map clan tag to a stable hue
  const hue = (i * (360 / CLAN_TAGS.length)) | 0;
  return `hsl(${hue}, 75%, 55%)`;
}
