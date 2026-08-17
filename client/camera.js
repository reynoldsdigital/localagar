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
    // Velocity for smoother camera movement
    this.vx = 0;
    this.vy = 0;
    this.vzoom = 0;
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
    // Smoother camera with acceleration/deceleration (less jittery)
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const dz = this.targetZoom - this.zoom;
    
    // Accelerate toward target, with damping
    const accel = 15.0;
    const damping = 0.88;
    
    this.vx += dx * accel * dtSec;
    this.vy += dy * accel * dtSec;
    this.vzoom += dz * accel * dtSec * 0.5;
    
    // Apply damping
    this.vx *= damping;
    this.vy *= damping;
    this.vzoom *= damping;
    
    // Clamp velocities
    const maxVel = 8000;
    const vmag = Math.hypot(this.vx, this.vy);
    if (vmag > maxVel) {
      this.vx = (this.vx / vmag) * maxVel;
      this.vy = (this.vy / vmag) * maxVel;
    }
    
    // Integrate position
    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;
    this.zoom += this.vzoom * dtSec;
    
    // Snap to target when very close (prevents micro-jitter)
    const snapDist = 0.5;
    if (Math.abs(dx) < snapDist && Math.abs(dy) < snapDist) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.vx = 0;
      this.vy = 0;
    }
    if (Math.abs(dz) < 0.001) {
      this.zoom = this.targetZoom;
      this.vzoom = 0;
    }
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
