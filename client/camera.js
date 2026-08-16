// Camera math: smooth follow of the player's center cell, zoom out as you grow.

import { massToRadius } from "../shared/constants.js";

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetX = 0;
    this.targetY = 0;
    this.targetZoom = 1;
  }
  setTargetCenter(cx, cy, mass, viewW, viewH) {
    this.targetX = cx;
    this.targetY = cy;
    // Pick zoom so the cell takes ~8% of the screen width
    const r = massToRadius(mass);
    const desired = Math.min(viewW, viewH) / (r * 24);
    this.targetZoom = Math.max(0.25, Math.min(1.5, desired));
  }
  step(dtSec) {
    // Smooth chase
    const lerp = 1 - Math.pow(0.001, dtSec);
    this.x += (this.targetX - this.x) * lerp;
    this.y += (this.targetY - this.y) * lerp;
    this.zoom += (this.targetZoom - this.zoom) * lerp;
  }
  worldToScreen(x, y, viewW, viewH) {
    return [
      (x - this.x) * this.zoom + viewW / 2,
      (y - this.y) * this.zoom + viewH / 2,
    ];
  }
  screenToWorld(sx, sy, viewW, viewH) {
    return [
      (sx - viewW / 2) / this.zoom + this.x,
      (sy - viewH / 2) / this.zoom + this.y,
    ];
  }
}
