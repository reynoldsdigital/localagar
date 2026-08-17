// Virus entities: stationary green spiked circles that split big cells.
//
// When a virus is popped or consumed it relocates to a new random position.
// To prevent it from reappearing at the exact same spot repeatedly, each
// virus remembers its past positions and the relocate() method avoids
// placing it within MIN_RESPAWN_DISTANCE of any previously recorded spot.

import { VIRUS, WORLD, nextId, massToRadius } from "../shared/constants.js";

let __serial = 0;

// Minimum distance (in world units) between a virus's new position and
// any of its past positions.  500px is roughly one screen-width at the
// default zoom — far enough that the player who popped it won't see it
// reappear in the same spot.
const MIN_RESPAWN_DISTANCE = 500;
const MAX_PAST_POSITIONS = 20;     // ring-buffer cap

export class Virus {
  constructor(x, y, mass = VIRUS.MASS) {
    this.id = nextId("v");
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.angle = Math.random() * Math.PI * 2;
    this.serial = ++__serial;
    this.bounces = []; // visual only — {t, dir} pop animation on feed
    this.feedCount = 0; // number of times fed by players
    this.lastFedAt = 0;
    this.pastPositions = []; // [{x, y}, …] — spots this virus has occupied
  }
  get radius() { return massToRadius(this.mass); }
  feed(amount, fromX, fromY) {
    this.mass += amount;
    this.feedCount++;
    this.lastFedAt = Date.now();
    // Push back in direction of feeder for visual feedback
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    this.bounces.push({ dx: dx / d, dy: dy / d, at: Date.now() });
    if (this.bounces.length > 8) this.bounces.shift();
  }
  step(dt) {
    // Tiny wobble + bounce recovery
    this.angle += 0.5 * dt;
    const now = Date.now();
    this.bounces = this.bounces.filter(b => now - b.at < 220);
    // Reset feed count if not fed recently (decay after 10 seconds)
    if (now - this.lastFedAt > 10000) {
      this.feedCount = 0;
    }
  }
  canCreateOffspring() {
    // Can create offspring after being fed 7 times
    return this.feedCount >= 7 && this.mass >= VIRUS.MASS;
  }
  resetAfterSplit() {
    this.feedCount = 0;
    this.mass = VIRUS.MASS;
  }

  // Relocate this virus to a new random position, avoiding all previously
  // recorded past positions.  Tries up to 50 random spots; if none are far
  // enough away (extremely unlikely in a 12000×12000 world), falls back to
  // the last attempted spot.
  relocate(width = WORLD.WIDTH, height = WORLD.HEIGHT) {
    // Record current position before moving
    this._recordPosition();

    let bestX = 0, bestY = 0, bestDist = -1;
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = Math.random() * width;
      const y = Math.random() * height;
      // Find the minimum distance to any past position
      let minDist = Infinity;
      for (const p of this.pastPositions) {
        const d = Math.hypot(x - p.x, y - p.y);
        if (d < minDist) minDist = d;
      }
      // If far enough from ALL past positions, use this spot immediately
      if (minDist >= MIN_RESPAWN_DISTANCE) {
        this.x = x;
        this.y = y;
        return;
      }
      // Track the best candidate as fallback
      if (minDist > bestDist) {
        bestDist = minDist;
        bestX = x;
        bestY = y;
      }
    }
    // Fallback: use the spot that was furthest from past positions
    this.x = bestX;
    this.y = bestY;
  }

  _recordPosition() {
    this.pastPositions.push({ x: this.x, y: this.y });
    if (this.pastPositions.length > MAX_PAST_POSITIONS) {
      this.pastPositions.shift();
    }
  }
}

export function spawnViruses(count) {
  const viruses = [];
  for (let i = 0; i < count; i++) {
    viruses.push(new Virus(
      Math.random() * WORLD.WIDTH,
      Math.random() * WORLD.HEIGHT,
      VIRUS.MASS,
    ));
  }
  return viruses;
}
