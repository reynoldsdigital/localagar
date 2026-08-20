// Simple bot AI: wander, chase nearby pellets, flee from bigger threats.
//
// Performance note: this used to scan EVERY pellet in the world (7000+) for
// every bot, every tick — 50 bots * 7000 pellets * 30 Hz = ~10M iterations/s.
// It now uses the room's spatial grid (rebuilt each tick) to only look at
// entities within ~700px, which is a few hundred candidates instead of
// thousands.

import { CELL, massToRadius } from "../shared/constants.js";
import { Cell } from "./player.js";
import { Pellet } from "./pellet.js";

const BOT_NAMES = [
  "Bot", "Nova", "Echo", "Drift", "Pixel", "Quark", "Orbit",
  "Flux", "Vex", "Hex", "Atlas", "Rune", "Zephyr", "Cobalt",
];

export function pickBotName(i) {
  return BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? `_${Math.floor(i / BOT_NAMES.length) + 1}` : "");
}

export function botThink(player, room) {
  if (!player.alive || player.cells.length === 0) return;

  const cx = player.cells.reduce((s, c) => s + c.x, 0) / player.cells.length;
  const cy = player.cells.reduce((s, c) => s + c.y, 0) / player.cells.length;
  const myMass = player.cells.reduce((s, c) => s + c.mass, 0);

  // Ask the spatial grid for everything nearby (populated on the previous
  // tick; empty on the very first tick, in which case bots just wander).
  const view = 700;
  const candidates = [];
  room._grid.query(cx, cy, view, candidates);

  let bestPellet = null;
  let bestPelletDist = Infinity;
  let threat = null;
  let threatDist = Infinity;

  for (const e of candidates) {
    if (e instanceof Pellet) {
      const dx = e.x - cx;
      const dy = e.y - cy;
      const d = Math.hypot(dx, dy);
      if (d < view && d < bestPelletDist) {
        bestPelletDist = d;
        bestPellet = e;
      }
    } else if (e instanceof Cell) {
      if (e.owner === player || !e.owner.alive) continue;
      if (e.mass < myMass * CELL.EAT_RATIO) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < 600 && d < threatDist) {
        threatDist = d;
        threat = e;
      }
    }
  }

  let tx = cx, ty = cy;
  if (threat) {
    // Flee directly away from the threat.
    tx = cx - (threat.x - cx);
    ty = cy - (threat.y - cy);
  } else if (bestPellet) {
    tx = bestPellet.x;
    ty = bestPellet.y;
  } else {
    // Wander toward world center with noise.
    const centerX = room.world.WIDTH / 2;
    const centerY = room.world.HEIGHT / 2;
    tx = centerX + Math.sin(Date.now() / 1000 + player.serial) * 1500;
    ty = centerY + Math.cos(Date.now() / 1300 + player.serial) * 1500;
  }

  player.targetX = tx;
  player.targetY = ty;

  // Occasionally eject mass at nearby viruses (helps split big players).
  if (Math.random() < 0.002 && myMass > CELL.EJECT_MIN_MASS + 50) {
    for (const v of room.viruses) {
      const d = Math.hypot(v.x - cx, v.y - cy);
      if (d < 600) {
        room.ejectMass(player, "w");
        break;
      }
    }
  }
  // Occasionally split toward a nearby smaller cell.
  if (Math.random() < 0.004 && myMass > CELL.SPLIT_MIN_MASS * 4) {
    for (const other of room.players) {
      if (!other.alive || other === player) continue;
      for (const c of other.cells) {
        if (c.mass >= myMass * 0.9) continue;
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d < 400) {
          player.targetX = c.x;
          player.targetY = c.y;
          room.split(player);
          break;
        }
      }
    }
  }
}
