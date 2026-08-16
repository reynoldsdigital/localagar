// Virus entities: stationary green spiked circles that split big cells.

import { VIRUS, WORLD, nextId, massToRadius } from "../shared/constants.js";

let __serial = 0;

export class Virus {
  constructor(x, y, mass = VIRUS.MASS) {
    this.id = nextId("v");
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.angle = Math.random() * Math.PI * 2;
    this.serial = ++__serial;
    this.bounces = []; // visual only — {t, dir} pop animation on feed
  }
  get radius() { return massToRadius(this.mass); }
  feed(amount, fromX, fromY) {
    this.mass += amount;
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
