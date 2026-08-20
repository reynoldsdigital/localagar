// Pellets: small mass tokens scattered across the world.
//
// Ambient pellets now vary slightly in size and inherit a colour from the
// shared PALETTE (derived deterministically on the client from the pellet
// id, so we don't waste bandwidth sending a colour per pellet). Ejected
// pellets (mass shot out by players) keep a fixed mass and render gold.

import { PELLET, WORLD, nextId, massToRadius } from "../shared/constants.js";

let __serial = 0;

function randomPelletMass() {
  return PELLET.MASS_MIN + Math.random() * (PELLET.MASS_MAX - PELLET.MASS_MIN);
}

export class Pellet {
  constructor(x, y, mass, ejected = false, ownerId = null) {
    this.id = nextId("p");
    this.x = x;
    this.y = y;
    this.ejected = !!ejected;
    if (this.ejected) {
      // Ejected mass: fixed mass (player-fired), rendered gold on client.
      this.mass = mass != null ? mass : PELLET.MASS;
    } else {
      // Ambient pellet: varied size for visual variety.
      this.mass = mass != null ? mass : randomPelletMass();
    }
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
