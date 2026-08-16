// Pellets: small mass tokens scattered across the world.

import { PELLET, WORLD, nextId, massToRadius } from "../shared/constants.js";

let __serial = 0;

export class Pellet {
  constructor(x, y, mass = PELLET.MASS, ejected = false, ownerId = null) {
    this.id = nextId("p");
    this.x = x;
    this.y = y;
    this.mass = mass;
    this.ejected = ejected;
    this.ownerId = ownerId;
    this.spawnAt = Date.now();
    this.serial = ++__serial;
  }
  get radius() { return massToRadius(this.mass); }
}

export function spawnInitialPellets() {
  const pellets = [];
  for (let i = 0; i < PELLET.COUNT; i++) {
    pellets.push(new Pellet(
      Math.random() * WORLD.WIDTH,
      Math.random() * WORLD.HEIGHT,
    ));
  }
  return pellets;
}
