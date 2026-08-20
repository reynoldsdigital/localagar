// Spatial grid for collision broadphase. Cell size should be larger than the
// largest possible entity (viruses ~ massToRadius(very large)).

import { massToRadius, CELL, WORLD } from "../shared/constants.js";

const CELL_SIZE = 200;
const COLS = Math.ceil(WORLD.WIDTH / CELL_SIZE);
const ROWS = Math.ceil(WORLD.HEIGHT / CELL_SIZE);

export class SpatialGrid {
  constructor() {
    this.buckets = new Map(); // key "cx,cy" -> array
  }
  _key(cx, cy) { return cx * 10000 + cy; }
  clear() { this.buckets.clear(); }
  insert(entity, radius) {
    const minCx = Math.max(0, Math.floor((entity.x - radius) / CELL_SIZE));
    const maxCx = Math.min(COLS - 1, Math.floor((entity.x + radius) / CELL_SIZE));
    const minCy = Math.max(0, Math.floor((entity.y - radius) / CELL_SIZE));
    const maxCy = Math.min(ROWS - 1, Math.floor((entity.y + radius) / CELL_SIZE));
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const k = this._key(cx, cy);
        let arr = this.buckets.get(k);
        if (!arr) { arr = []; this.buckets.set(k, arr); }
        arr.push(entity);
      }
    }
  }
  query(x, y, radius, out) {
    const minCx = Math.max(0, Math.floor((x - radius) / CELL_SIZE));
    const maxCx = Math.min(COLS - 1, Math.floor((x + radius) / CELL_SIZE));
    const minCy = Math.max(0, Math.floor((y - radius) / CELL_SIZE));
    const maxCy = Math.min(ROWS - 1, Math.floor((y + radius) / CELL_SIZE));
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const arr = this.buckets.get(this._key(cx, cy));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) out.push(arr[i]);
      }
    }
    return out;
  }
}

export function distance(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// Returns true if `attacker` can consume `victim`. Cells can eat anything smaller
// than EAT_RATIO of themselves; viruses never eat players.
export function canEat(attackerMass, victimMass) {
  return attackerMass >= victimMass * CELL.EAT_RATIO;
}
