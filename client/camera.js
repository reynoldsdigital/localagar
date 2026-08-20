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
    this.userZoom = 1.0;        // scroll-wheel zoom multiplier (in-game only)
  }
  setTargetCenter(cx, cy, mass, viewW, viewH, boxW = 0, boxH = 0) {
    this.targetX = cx;
    this.targetY = cy;
    // Base auto-zoom from total mass (smaller player => more world visible).
    const r = massToRadius(mass);
    const desired = Math.min(viewW, viewH) / (r * 36);
    let zoom = Math.max(0.15, Math.min(1.15, desired));
    // After splitting your cells spread out; zoom out enough to keep ALL of
    // them on screen (agar.io-style). This only zooms OUT further than the
    // mass-based view, never in, so a single cell keeps its normal zoom.
    if (boxW > 0 && boxH > 0) {
      const zoomFit = Math.min(viewW / (boxW * 1.35), viewH / (boxH * 1.35));
      zoom = Math.min(zoom, zoomFit);
    }
    // Apply the player's scroll-wheel zoom preference (in-game only).
    zoom = zoom * this.userZoom;
    this.targetZoom = Math.max(0.10, Math.min(2.0, zoom));
  }

  // Scroll-wheel zoom: multiply the auto-zoom by a clamped factor.
  // factor > 1 zooms in, < 1 zooms out.
  adjustZoom(factor) {
    this.userZoom = Math.max(0.45, Math.min(2.5, this.userZoom * factor));
  }
  resetZoom() { this.userZoom = 1.0; }
  step(dtSec) {
    // --- Zoom: smooth, frame-rate-independent exponential approach (no
    //     overshoot, no jitter). This is the "auto zoom in/out" curve. ---
    const dz = this.targetZoom - this.zoom;
    if (Math.abs(dz) < 0.0005) {
      this.zoom = this.targetZoom;
      this.vzoom = 0;
    } else {
      const zk = 1 - Math.exp(-dtSec * 6);   // higher = snappier
      this.zoom += dz * zk;
    }

    // --- Position: velocity-based smoothing toward the target. ---
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const accel = 14.0;
    const damping = 0.86;

    this.vx += dx * accel * dtSec;
    this.vy += dy * accel * dtSec;
    this.vx *= damping;
    this.vy *= damping;

    const maxVel = 9000;
    const vmag = Math.hypot(this.vx, this.vy);
    if (vmag > maxVel) {
      this.vx = (this.vx / vmag) * maxVel;
      this.vy = (this.vy / vmag) * maxVel;
    }

    this.x += this.vx * dtSec;
    this.y += this.vy * dtSec;

    // Snap when very close to avoid micro-jitter.
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
      this.x = this.targetX;
      this.y = this.targetY;
      this.vx = 0;
      this.vy = 0;
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
