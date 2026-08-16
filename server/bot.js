// Simple bot AI: wander, chase nearby pellets, flee from bigger threats.

import { CELL, massToRadius } from "../shared/constants.js";

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

  // Look for nearest pellet within view
  let bestPellet = null;
  let bestPelletDist = Infinity;
  const view = 700;
  for (const p of room.pellets) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy);
    if (d < view && d < bestPelletDist) {
      bestPelletDist = d;
      bestPellet = p;
    }
  }

  // Look for threats (cells much larger than us within threat range)
  let threat = null;
  let threatDist = Infinity;
  for (const other of room.players) {
    if (!other.alive || other === player) continue;
    for (const c of other.cells) {
      if (c.mass < myMass * CELL.EAT_RATIO) continue;
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (d < 600 && d < threatDist) {
        threatDist = d;
        threat = c;
      }
    }
  }

  let tx = cx, ty = cy;
  if (threat) {
    // Flee
    tx = cx - (threat.x - cx);
    ty = cy - (threat.y - cy);
  } else if (bestPellet) {
    tx = bestPellet.x;
    ty = bestPellet.y;
  } else {
    // Wander toward world center with noise
    const centerX = room.world.WIDTH / 2;
    const centerY = room.world.HEIGHT / 2;
    tx = centerX + Math.sin(Date.now() / 1000 + player.serial) * 1500;
    ty = centerY + Math.cos(Date.now() / 1300 + player.serial) * 1500;
  }

  player.targetX = tx;
  player.targetY = ty;

  // Occasionally eject mass at viruses (helps them grow & split big players)
  if (Math.random() < 0.002 && myMass > CELL.EJECT_MIN_MASS + 50) {
    for (const v of room.viruses) {
      const d = Math.hypot(v.x - cx, v.y - cy);
      if (d < 600) {
        // Fake an eject by calling room.eject for this player
        room.ejectMass(player, "w");
        break;
      }
    }
  }
  // Occasionally split toward a target if chasing a smaller cell
  if (Math.random() < 0.004 && myMass > CELL.SPLIT_MIN_MASS * 4) {
    for (const other of room.players) {
      if (!other.alive || other === player) continue;
      for (const c of other.cells) {
        if (c.mass >= myMass * 0.9) continue;
        const d = Math.hypot(c.x - cx, c.y - cy);
        if (d < 400) {
          // Aim split at victim
          player.targetX = c.x;
          player.targetY = c.y;
          room.split(player);
          break;
        }
      }
    }
  }
}
