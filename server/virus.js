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

// Random pellet count in [FEED_MIN, FEED_MAX] before a virus shoots.
function rollFeedThreshold() {
  return VIRUS.FEED_MIN + Math.floor(Math.random() * (VIRUS.FEED_MAX - VIRUS.FEED_MIN + 1));
}

export class Virus {
  constructor(x, y, mass = VIRUS.MASS) {
    this.id = nextId("v");
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.angle = Math.random() * Math.PI * 2;
    this.serial = ++__serial;
    this.bounces = []; // visual only — {t, dir} pop animation on feed
    this.feedCount = 0; // number of pellets eaten since last reset
    this.feedThreshold = rollFeedThreshold(); // pellets needed before it shoots
    this.lastFedAt = 0;
    this.vx = 0;            // velocity when shot/launched
    this.vy = 0;
    this.pastPositions = []; // [{x, y}, …] — spots this virus has occupied
  }

  // Random 10–15 pellet threshold before this virus shoots.
  static rollThreshold() { return rollFeedThreshold(); }
  get radius() { return massToRadius(this.mass); }
  feed(amount, fromX, fromY) {
    this.mass += amount;
    this.feedCount++;
    this.lastFedAt = Date.now();
    // Visual bounce toward the feed direction only — the original virus
    // stays in place; duplication (a new flying virus) is handled by the
    // room when the feed threshold is reached.
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const d = Math.hypot(dx, dy) || 1;
    this.bounces.push({ dx: dx / d, dy: dy / d, at: Date.now() });
    if (this.bounces.length > 8) this.bounces.shift();
  }
  step(dt) {
    this.angle += 0.5 * dt;
    const now = Date.now();
    this.bounces = this.bounces.filter(b => now - b.at < 220);
    // Reset feed count if not fed recently (decay after 10 seconds)
    if (now - this.lastFedAt > 10000 && this.feedCount !== 0) {
      this.feedCount = 0;
    }
    // Fly when shot (velocity from shoot()). Friction slows it until it
    // settles and becomes a normal stationary virus again.
    if (this.vx || this.vy) {
      this.x += this.vx * dt;
      this.y += this.vy * dt;
      const fr = Math.pow(VIRUS.SHOOT_FRICTION, dt);
      this.vx *= fr;
      this.vy *= fr;
      if (Math.hypot(this.vx, this.vy) < 0.3) { this.vx = 0; this.vy = 0; }
      if (this.x < 0) { this.x = 0; this.vx = 0; }
      if (this.y < 0) { this.y = 0; this.vy = 0; }
      if (this.x > WORLD.WIDTH) { this.x = WORLD.WIDTH; this.vx = 0; }
      if (this.y > WORLD.HEIGHT) { this.y = WORLD.HEIGHT; this.vy = 0; }
    }
  }
  // True once the virus has eaten its (random) pellet threshold.
  canShoot() {
    return this.feedCount >= this.feedThreshold && this.mass >= VIRUS.MASS;
  }
  // Reset the original virus in place after it has duplicated (the room
  // creates the new flying virus). The original keeps its position.
  shoot() {
    this.feedCount = 0;
    this.mass = VIRUS.MASS;
    this.vx = 0;
    this.vy = 0;
    this.feedThreshold = rollFeedThreshold();
  }
  resetAfterSplit() {
    this.feedCount = 0;
    this.mass = VIRUS.MASS;
    this.vx = 0;
    this.vy = 0;
    this.feedThreshold = rollFeedThreshold();
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
