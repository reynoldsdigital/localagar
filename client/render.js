// Renderer: applies server snapshots, draws to the canvas. Interpolation is
// implicit because snapshots arrive every ~33ms and we redraw every animation
// frame — positions look smooth enough at 30Hz updates.

import { Camera } from "./camera.js";
import { COLORS, massToRadius } from "../shared/constants.js";

const VIRUS_SPIKES = 20;

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.minimapCanvas = minimapCanvas;
    this.minimapCtx = minimapCanvas.getContext("2d");
    this.camera = new Camera();
    this.cells = new Map();       // id -> { x, y, m, o, c, n, cl }
    this.pellets = new Map();     // id -> { x, y, m, e }
    this.viruses = new Map();     // id -> { x, y, m }
    this.you = [];                // [{ id, x, y, m }] from server (your own cells)
    this.leaderboard = [];
    this.snapshotTs = 0;
    this.alive = true;
    this._deathAtLocal = 0;
    this._raf = 0;
    this._last = 0;
    this._lastWorldX = 0;
    this._lastWorldY = 0;
    this._hasLast = false;
    this.view = { x: 0, y: 0, w: 0, h: 0 };
    this.world = { WIDTH: 12000, HEIGHT: 12000 };
    this._resize();
    window.addEventListener("resize", () => this._resize());
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.minimapCanvas.width = 180;
    this.minimapCanvas.height = 180;
  }

  applyLeaderboard(rows) {
    this.leaderboard = rows || [];
  }
  getLeaderboard() { return this.leaderboard; }

  applySnapshot(msg) {
    this.snapshotTs = msg.ts;
    this.view = msg.view;
    if (msg.you) {
      this.you = msg.you;
      this.alive = msg.you.length > 0;
      if (!this.alive) {
        if (!this._deathAtLocal) this._deathAtLocal = Date.now();
      } else {
        this._deathAtLocal = 0;
      }
    }
    if (msg.cells) {
      const seen = new Set();
      for (const c of msg.cells) {
        seen.add(c.id);
        const prev = this.cells.get(c.id);
        if (prev) {
          prev.x = c.x; prev.y = c.y; prev.m = c.m;
          prev.o = c.o; prev.c = c.c; prev.n = c.n; prev.cl = c.cl;
        } else {
          this.cells.set(c.id, { x: c.x, y: c.y, m: c.m, o: c.o, c: c.c, n: c.n, cl: c.cl });
        }
      }
      for (const id of this.cells.keys()) {
        if (!seen.has(id)) this.cells.delete(id);
      }
    }
    if (msg.pellets) {
      const seen = new Set();
      for (const p of msg.pellets) {
        seen.add(p.id);
        const prev = this.pellets.get(p.id);
        if (prev) { prev.x = p.x; prev.y = p.y; prev.m = p.m; prev.e = p.e; }
        else this.pellets.set(p.id, { x: p.x, y: p.y, m: p.m, e: p.e });
      }
      for (const id of this.pellets.keys()) {
        if (!seen.has(id)) this.pellets.delete(id);
      }
    }
    if (msg.viruses) {
      const seen = new Set();
      for (const v of msg.viruses) {
        seen.add(v.id);
        const prev = this.viruses.get(v.id);
        if (prev) { prev.x = v.x; prev.y = v.y; prev.m = v.m; }
        else this.viruses.set(v.id, { x: v.x, y: v.y, m: v.m });
      }
      for (const id of this.viruses.keys()) {
        if (!seen.has(id)) this.viruses.delete(id);
      }
    }
  }

  getLatestSnapshot() {
    return this.snapshotTs
      ? { ts: this.snapshotTs, you: this.you, cells: [...this.cells.values()] }
      : null;
  }

  totalMass() {
    let s = 0;
    for (const c of this.you) s += c.m;
    return s;
  }

  getRank() {
    const score = this.totalMass();
    let rank = 1;
    for (const r of this.leaderboard) {
      if (r.score > score) rank++;
    }
    return rank;
  }
  isAlive() { return this.alive; }
  getDeathAt() { return this._deathAtLocal || 0; }
  getGold() { return 0; }

  start() {
    const tick = (t) => {
      this._raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (t - this._last) / 1000 || 0);
      this._last = t;
      this._update(dt);
      this._draw();
    };
    this._raf = requestAnimationFrame(tick);
  }

  _update(dt) {
    if (this.you.length > 0) {
      let cx = 0, cy = 0, totalM = 0;
      for (const c of this.you) { cx += c.x * c.m; cy += c.y * c.m; totalM += c.m; }
      cx /= totalM; cy /= totalM;
      this.camera.setTargetCenter(cx, cy, totalM, window.innerWidth, window.innerHeight);
      this.camera.step(dt);
      this._lastWorldX = cx; this._lastWorldY = cy; this._hasLast = true;
    } else if (this._hasLast) {
      this.camera.setTargetCenter(this._lastWorldX, this._lastWorldY, 100, window.innerWidth, window.innerHeight);
      this.camera.step(dt);
    }
  }

  _draw() {
    const ctx = this.ctx;
    const w = window.innerWidth, h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);

    this._drawGrid(ctx, w, h);

    // World border
    const [bx, by] = this._worldToScreen(0, 0, w, h);
    const [bx2, by2] = this._worldToScreen(this.world.WIDTH, this.world.HEIGHT, w, h);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.strokeRect(bx, by, bx2 - bx, by2 - by);

    // Pellets
    for (const p of this.pellets.values()) {
      const [sx, sy] = this._worldToScreen(p.x, p.y, w, h);
      const r = Math.max(2, massToRadius(p.m) * this.camera.zoom);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = p.e ? COLORS.PELLET_EJECTED : COLORS.PELLET;
      ctx.fill();
    }

    // Viruses
    for (const v of this.viruses.values()) {
      const [sx, sy] = this._worldToScreen(v.x, v.y, w, h);
      const r = massToRadius(v.m) * this.camera.zoom;
      drawVirus(ctx, sx, sy, r);
    }

    // Cells — sorted so big ones draw first (smaller on top of bigger)
    const cells = [...this.cells.values()];
    cells.sort((a, b) => b.m - a.m);
    for (const c of cells) {
      const [sx, sy] = this._worldToScreen(c.x, c.y, w, h);
      const r = massToRadius(c.m) * this.camera.zoom;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = c.c || "#888";
      ctx.fill();
      if (this.you.find(y => y.id === c.id)) {
        ctx.lineWidth = Math.max(2, 4 * this.camera.zoom);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.stroke();
      }
      const fontSize = Math.max(10, Math.min(28, r * 0.55));
      ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 4;
      ctx.fillText(c.n || "", sx, sy - fontSize * 0.4);
      ctx.font = `500 ${fontSize * 0.7}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillText(String(Math.floor(c.m)), sx, sy + fontSize * 0.35);
      ctx.shadowBlur = 0;
    }

    this._drawMinimap();
  }

  _worldToScreen(x, y, w, h) {
    return [
      (x - this.camera.x) * this.camera.zoom + w / 2,
      (y - this.camera.y) * this.camera.zoom + h / 2,
    ];
  }

  _drawGrid(ctx, w, h) {
    const gridSize = 100;
    const cs = gridSize * this.camera.zoom;
    if (cs < 12) {
      ctx.fillStyle = COLORS.BACKGROUND;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    ctx.fillStyle = COLORS.BACKGROUND;
    ctx.fillRect(0, 0, w, h);

    const left = this.camera.x - w / 2 / this.camera.zoom;
    const top  = this.camera.y - h / 2 / this.camera.zoom;
    const right = this.camera.x + w / 2 / this.camera.zoom;
    const bottom = this.camera.y + h / 2 / this.camera.zoom;

    const startX = Math.floor(left / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;
    ctx.strokeStyle = COLORS.GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = startX; x <= right; x += gridSize) {
      const sx = (x - this.camera.x) * this.camera.zoom + w / 2;
      ctx.moveTo(sx + 0.5, 0);
      ctx.lineTo(sx + 0.5, h);
    }
    for (let y = startY; y <= bottom; y += gridSize) {
      const sy = (y - this.camera.y) * this.camera.zoom + h / 2;
      ctx.moveTo(0, sy + 0.5);
      ctx.lineTo(w, sy + 0.5);
    }
    ctx.stroke();
  }

  _drawMinimap() {
    const ctx = this.minimapCtx;
    const W = this.minimapCanvas.width;
    const H = this.minimapCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, W, H);

    const sx = W / this.world.WIDTH;
    const sy = H / this.world.HEIGHT;

    ctx.fillStyle = "rgba(80,220,100,0.8)";
    for (const v of this.viruses.values()) {
      ctx.beginPath();
      ctx.arc(v.x * sx, v.y * sy, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const c of this.cells.values()) {
      ctx.beginPath();
      ctx.arc(c.x * sx, c.y * sy, Math.max(0.5, Math.sqrt(c.m) * 0.15), 0, Math.PI * 2);
      ctx.fillStyle = c.c || "#888";
      ctx.globalAlpha = 0.85;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 1;
    ctx.strokeRect(W / 2 - 1, H / 2 - 1, 2, 2);
  }
}

function drawVirus(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < VIRUS_SPIKES; i++) {
    const a0 = (i / VIRUS_SPIKES) * Math.PI * 2;
    const a1 = ((i + 0.5) / VIRUS_SPIKES) * Math.PI * 2;
    const a2 = ((i + 1) / VIRUS_SPIKES) * Math.PI * 2;
    const r0 = r * 0.95;
    const r1 = r * 1.12;
    ctx.lineTo(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0);
    ctx.lineTo(x + Math.cos(a1) * r1, y + Math.sin(a1) * r1);
    ctx.lineTo(x + Math.cos(a2) * r0, y + Math.sin(a2) * r0);
  }
  ctx.closePath();
  ctx.fillStyle = COLORS.VIRUS_FILL;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.04);
  ctx.strokeStyle = COLORS.VIRUS_STROKE;
  ctx.stroke();
}
