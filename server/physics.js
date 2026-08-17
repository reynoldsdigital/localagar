// Per-tick physics: movement, splitting, ejecting, merging, decay.
//
// Splitting follows agar.io behaviour:
//   1. The new cell gets a "boost velocity" that is NOT capped by normal
//      movement speed, so it launches forward from the parent.
//   2. The boost decays with friction each tick until the cell stops.
//   3. While the merge cooldown is active, same-owner cells are pushed
//      apart so they sit on each other's outline (just touching, not
//      overlapping) — exactly like agar.io.
//   4. When the cooldown expires the separation no longer applies, cells
//      overlap, and mergeCells() recombines them.

import {
  CELL, WORLD, TICK_RATE, massToRadius, clamp,
} from "../shared/constants.js";
import { Cell } from "./player.js";

// Move a single cell toward its owner's target. Smaller cells are faster.
// Split boost velocity is applied on top of normal movement and is NOT
// capped by the movement speed limit — this is what makes split cells
// "fly" away from the parent like in agar.io.
export function moveCell(cell, owner, dt) {
  // --- Normal movement toward mouse target ---
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
  // Clamp normal velocity magnitude to speed
  const mag = Math.hypot(cell.vx, cell.vy);
  const cap = CELL.SPEED_BASE * 1.4;
  if (mag > cap) {
    cell.vx = (cell.vx / mag) * cap;
    cell.vy = (cell.vy / mag) * cap;
  }
  cell.x += cell.vx * dt;
  cell.y += cell.vy * dt;

  // --- Split boost velocity (decays with friction, not capped) ---
  if (cell.boostVx || cell.boostVy) {
    cell.x += cell.boostVx * dt;
    cell.y += cell.boostVy * dt;
    // Exponential friction decay per tick
    const friction = Math.pow(CELL.SPLIT_BOOST_FRICTION, dt);
    cell.boostVx *= friction;
    cell.boostVy *= friction;
    if (Math.hypot(cell.boostVx, cell.boostVy) < CELL.SPLIT_BOOST_MIN) {
      cell.boostVx = 0;
      cell.boostVy = 0;
    }
  }

  // Clamp into world
  if (cell.x < 0) { cell.x = 0; cell.vx = 0; cell.boostVx = 0; }
  if (cell.y < 0) { cell.y = 0; cell.vy = 0; cell.boostVy = 0; }
  if (cell.x > WORLD.WIDTH)  { cell.x = WORLD.WIDTH;  cell.vx = 0; cell.boostVx = 0; }
  if (cell.y > WORLD.HEIGHT) { cell.y = WORLD.HEIGHT; cell.vy = 0; cell.boostVy = 0; }
}

export function decayCell(cell, dt) {
  if (cell.mass <= CELL.MIN_MASS) return;
  // dt is in tick units (1.0 = one full 33ms tick at TICK_RATE=30).
  const dtSec = dt / TICK_RATE;

  // agar.io-style passive decay: a percentage of mass per second, so
  // small cells barely lose anything while very large cells lose more.
  //   mass 30    → 0.06/s  (was 2/s — far too aggressive before)
  //   mass 100   → 0.2/s
  //   mass 500   → 1.0/s
  //   mass 2000  → 4.0/s
  //   mass 10000 → 20/s
  let decayRate = cell.mass * CELL.DECAY_RATE;

  // Extra severe decay only at extreme sizes (near the auto-split
  // threshold) to prevent runaway growth.
  if (cell.mass > CELL.DECAY_SIZE_THRESHOLD) {
    decayRate += (cell.mass - CELL.DECAY_SIZE_THRESHOLD) * 0.005;
  }

  cell.mass -= decayRate * dtSec;
  if (cell.mass < CELL.MIN_MASS) cell.mass = CELL.MIN_MASS;
}

// Split the cell in two. The new cell launches forward (toward the mouse
// target) with a boost velocity that decays over time.  After the boost
// dies down the cell separation system keeps it sitting on the parent's
// outline until the merge cooldown expires.
//
// Returns array of new cells (0, 1, or 2).
export function splitCell(cell, owner, speedMul = 1.0, isAutoSplit = false) {
  if (owner.cells.length >= CELL.MAX_CELLS_PER_PLAYER) return [];
  if (cell.mass < CELL.SPLIT_MIN_MASS) return [];

  // --- Split direction: toward mouse target (agar.io behaviour) ---
  const tdx = owner.targetX - cell.x;
  const tdy = owner.targetY - cell.y;
  const td = Math.hypot(tdx, tdy);
  let nx, ny;
  if (td > 1) {
    nx = tdx / td;
    ny = tdy / td;
  } else {
    // No target direction — fall back to current velocity or random
    const vmag = Math.hypot(cell.vx, cell.vy);
    if (vmag > 0.1) { nx = cell.vx / vmag; ny = cell.vy / vmag; }
    else { const a = Math.random() * Math.PI * 2; nx = Math.cos(a); ny = Math.sin(a); }
  }

  // --- Mass calculation ---
  const originalMass = cell.mass;            // mass before split
  const halfMass = originalMass / 2;
  const splitLoss = CELL.SPLIT_DECAY;
  const newMass = Math.max(CELL.MIN_MASS, halfMass - splitLoss / 2);
  cell.mass = newMass;

  // --- Boost velocity (agar.io-style launch) ---
  // Total distance travelled = boostSpeed / (1 - friction).
  // Scale the desired distance with the original cell's radius so bigger
  // cells split further, just like agar.io.
  const originalRadius = massToRadius(originalMass);
  const desiredDistance = Math.max(80, originalRadius * 5);
  const boostSpeed = desiredDistance * (1 - CELL.SPLIT_BOOST_FRICTION) * speedMul;

  const newCell = new Cell(owner, cell.x, cell.y, newMass);
  newCell.boostVx = nx * boostSpeed;
  newCell.boostVy = ny * boostSpeed;
  newCell.fromSplit = true;

  // --- Merge cooldown: 30 seconds + 2.33% of mass ---
  const mergeTime = CELL.MERGE_BASE_TIME_MS + (newMass * CELL.MERGE_MASS_FACTOR * 1000);
  newCell.canMergeAt = Date.now() + mergeTime;
  cell.canMergeAt = Date.now() + mergeTime;
  newCell.splitAt = Date.now();
  cell.splitAt = Date.now();
  owner.cells.push(newCell);
  return [cell, newCell];
}

// Push same-owner cells apart while their merge cooldown is active so they
// sit on each other's outline (just touching, not overlapping) — exactly
// like agar.io.  Once the cooldown expires the separation no longer applies
// and mergeCells() can recombine them.
//
// The push is mass-weighted so bigger cells barely move while smaller ones
// get pushed more.
export function separateCells(owner) {
  if (owner.cells.length < 2) return;
  const now = Date.now();
  // Multiple passes to resolve chains of overlapping cells.
  for (let pass = 0; pass < 4; pass++) {
    let anyOverlap = false;
    const cells = owner.cells;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      if (!a || a.mass <= CELL.MIN_MASS) continue;
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        if (!b || b.mass <= CELL.MIN_MASS) continue;

        // Only separate while at least one cell is in merge cooldown.
        if (now >= a.canMergeAt && now >= b.canMergeAt) continue;

        const ar = massToRadius(a.mass);
        const br = massToRadius(b.mass);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        const minDist = ar + br;           // just touching

        if (dist < minDist) {
          anyOverlap = true;
          const overlap = minDist - dist;
          const totalMass = a.mass + b.mass;
          if (dist < 0.001) {
            // Cells are exactly stacked — push apart in a random direction.
            const angle = Math.random() * Math.PI * 2;
            const aPush = (b.mass / totalMass) * overlap;
            const bPush = (a.mass / totalMass) * overlap;
            a.x -= Math.cos(angle) * aPush;
            a.y -= Math.sin(angle) * aPush;
            b.x += Math.cos(angle) * bPush;
            b.y += Math.sin(angle) * bPush;
          } else {
            const ux = dx / dist;
            const uy = dy / dist;
            const aPush = (b.mass / totalMass) * overlap;
            const bPush = (a.mass / totalMass) * overlap;
            a.x -= ux * aPush;
            a.y -= uy * aPush;
            b.x += ux * bPush;
            b.y += uy * bPush;
          }
        }
      }
    }
    if (!anyOverlap) break;
  }
}

// Try to merge any pair of the owner's cells whose cooldown timers have
// expired.  In agar.io, same-owner split cells merge back regardless of
// size ratio — the only requirement is that the merge cooldown has elapsed
// and the cells overlap.
export function mergeCells(owner) {
  if (owner.cells.length < 2) return;
  const now = Date.now();
  // Multiple passes so chains of cells can all merge in one tick.
  let merged = true;
  while (merged) {
    merged = false;
    const cells = owner.cells;
    for (let i = 0; i < cells.length; i++) {
      const a = cells[i];
      if (!a || a.mass <= CELL.MIN_MASS) continue;
      for (let j = i + 1; j < cells.length; j++) {
        const b = cells[j];
        if (!b || b.mass <= CELL.MIN_MASS) continue;

        // Both cells must be past their merge cooldown.
        if (now < a.canMergeAt || now < b.canMergeAt) continue;

        const ar = massToRadius(a.mass);
        const br = massToRadius(b.mass);
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dist = Math.hypot(dx, dy);

        // Merge when the cells overlap (centre of the smaller within the
        // larger).  No mass-ratio requirement — same-owner cells always
        // merge back after cooldown, exactly like agar.io.
        if (dist < Math.max(ar, br)) {
          if (a.mass >= b.mass) {
            const total = a.mass + b.mass;
            a.x = (a.x * a.mass + b.x * b.mass) / total;
            a.y = (a.y * a.mass + b.y * b.mass) / total;
            a.mass = total;
            a.canMergeAt = 0;
            owner.cells = owner.cells.filter(c => c !== b);
          } else {
            const total = a.mass + b.mass;
            b.x = (b.x * b.mass + a.x * a.mass) / total;
            b.y = (b.y * b.mass + a.y * a.mass) / total;
            b.mass = total;
            b.canMergeAt = 0;
            owner.cells = owner.cells.filter(c => c !== a);
          }
          merged = true;
          break;
        }
      }
      if (merged) break;
    }
  }
}
