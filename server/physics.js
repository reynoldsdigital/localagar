// Per-tick physics: movement, splitting, ejecting, merging, decay.

import {
  CELL, WORLD, TICK_RATE, massToRadius, clamp,
} from "../shared/constants.js";
import { Cell } from "./player.js";

// Move a single cell toward its owner's target. Smaller cells are faster.
export function moveCell(cell, owner, dt) {
  const dx = owner.targetX - cell.x;
  const dy = owner.targetY - cell.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) {
    cell.vx *= 0.6;
    cell.vy *= 0.6;
  } else {
    // Speed scales inversely with radius (agar.io behaviour)
    const base = CELL.SPEED_BASE * (CELL.START_MASS / cell.mass) ** 0.4;
    const speed = clamp(base, CELL.SPEED_MIN, CELL.SPEED_BASE * 1.2);
    const nx = dx / d;
    const ny = dy / d;
    // Smooth velocity toward target direction (avoids jitter from mouse changes)
    cell.vx = cell.vx * 0.6 + nx * speed * 0.4;
    cell.vy = cell.vy * 0.6 + ny * speed * 0.4;
  }
  // Clamp velocity magnitude to speed
  const mag = Math.hypot(cell.vx, cell.vy);
  const cap = CELL.SPEED_BASE * 1.4;
  if (mag > cap) {
    cell.vx = (cell.vx / mag) * cap;
    cell.vy = (cell.vy / mag) * cap;
  }
  cell.x += cell.vx * dt;
  cell.y += cell.vy * dt;

  // Clamp into world
  if (cell.x < 0) { cell.x = 0; cell.vx = 0; }
  if (cell.y < 0) { cell.y = 0; cell.vy = 0; }
  if (cell.x > WORLD.WIDTH)  { cell.x = WORLD.WIDTH;  cell.vx = 0; }
  if (cell.y > WORLD.HEIGHT) { cell.y = WORLD.HEIGHT; cell.vy = 0; }
}

export function decayCell(cell, dt) {
  if (cell.mass <= CELL.MIN_MASS) return;
  // dt is in tick units (1.0 = one full 33ms tick at TICK_RATE=30). Convert
  // to seconds so DECAY_PER_MIN (mass-per-minute) is applied correctly.
  // Bug prior: we computed DECAY_PER_MIN/60 * dt * 60, which at dt=1 dropped
  // a full unit per tick == 30 units/second (cell with mass 30 died in 1s).
  const dtSec = dt / TICK_RATE;
  cell.mass -= (CELL.DECAY_PER_MIN / 60) * dtSec;
  if (cell.mass < CELL.MIN_MASS) cell.mass = CELL.MIN_MASS;
}

// Split the cell in two. Returns array of new cells (0, 1, or 2).
export function splitCell(cell, owner, speedMul = 1.0) {
  if (owner.cells.length >= CELL.MAX_CELLS_PER_PLAYER) return [];
  if (cell.mass < CELL.SPLIT_MIN_MASS) return [];

  const dirX = cell.vx || 1;
  const dirY = cell.vy || 0;
  const d = Math.hypot(dirX, dirY) || 1;
  const nx = dirX / d;
  const ny = dirY / d;

  const halfMass = cell.mass / 2;
  const splitLoss = CELL.SPLIT_DECAY;
  cell.mass = Math.max(CELL.MIN_MASS, halfMass - splitLoss / 2);

  const newCell = new Cell(owner, cell.x, cell.y, halfMass - splitLoss / 2);
  newCell.vx = nx * CELL.SPLIT_SPEED * speedMul;
  newCell.vy = ny * CELL.SPLIT_SPEED * speedMul;
  newCell.fromSplit = true;
  newCell.canMergeAt = Date.now() + CELL.MERGE_TIME_MS;
  cell.canMergeAt = Date.now() + CELL.MERGE_TIME_MS;
  owner.cells.push(newCell);
  return [cell, newCell];
}

// Try to merge any pair of the owner's cells whose timers have expired.
export function mergeCells(owner) {
  if (owner.cells.length < 2) return;
  const now = Date.now();
  const cells = owner.cells.slice();
  for (let i = 0; i < cells.length; i++) {
    const a = cells[i];
    if (a.mass <= CELL.MIN_MASS) continue;
    for (let j = i + 1; j < cells.length; j++) {
      const b = cells[j];
      if (b.mass <= CELL.MIN_MASS) continue;
      if (now < a.canMergeAt || now < b.canMergeAt) continue;
      if (a.fromSplit || b.fromSplit) continue;
      const ar = massToRadius(a.mass);
      const br = massToRadius(b.mass);
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.hypot(dx, dy);
      // Must be close AND big-enough-to-eat smaller piece
      if (dist < ar && a.mass >= b.mass * CELL.MERGE_MIN_MASS_RATIO) {
        // Merge b into a (mass-weighted position)
        const total = a.mass + b.mass;
        a.x = (a.x * a.mass + b.x * b.mass) / total;
        a.y = (a.y * a.mass + b.y * b.mass) / total;
        a.mass = total;
        owner.cells = owner.cells.filter(c => c !== b);
        return; // one merge per tick to keep things stable
      } else if (dist < br && b.mass >= a.mass * CELL.MERGE_MIN_MASS_RATIO) {
        const total = a.mass + b.mass;
        b.x = (b.x * b.mass + a.x * a.mass) / total;
        b.y = (b.y * b.mass + a.y * a.mass) / total;
        b.mass = total;
        owner.cells = owner.cells.filter(c => c !== a);
        return;
      }
    }
  }
}
