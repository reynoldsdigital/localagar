// A single game room: holds players, pellets, viruses, runs the tick loop,
// and broadcasts snapshots to connected clients.

import {
  WORLD, TICK_RATE, CELL, PELLET, VIRUS, MODES, MODE_CONFIG, massToRadius,
} from "../shared/constants.js";
import { Cell, Player } from "./player.js";
import { Pellet, spawnInitialPellets } from "./pellet.js";
import { Virus, spawnViruses } from "./virus.js";
import { SpatialGrid, distance, canEat } from "./collisions.js";
import {
  moveCell, decayCell, splitCell, mergeCells,
} from "./physics.js";
import { S2C } from "./protocol.js";
import { botThink, pickBotName } from "./bot.js";

const TICK_MS = 1000 / TICK_RATE;
const SNAPSHOT_INTERVAL_MS = 1000 / 30;

let __roomSerial = 0;

export class Room {
  constructor({ mode, id }) {
    this.id = id || `room_${++__roomSerial}`;
    this.mode = mode;
    this.cfg = MODE_CONFIG[mode] || MODE_CONFIG[MODES.FFA];
    this.world = { WIDTH: WORLD.WIDTH, HEIGHT: WORLD.HEIGHT };
    this.players = [];           // Player[] (real + bots)
    this.realPlayers = new Set();// connected sockets
    this.pellets = spawnInitialPellets();
    this.viruses = spawnViruses(this.cfg.virusCount);
    this.lastTickAt = Date.now();
    this.lastSnapshotAt = 0;
    this.running = false;
    this._loop = null;
    this._grid = new SpatialGrid();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop = setInterval(() => this._tick(), TICK_MS);
  }

  stop() {
    this.running = false;
    if (this._loop) { clearInterval(this._loop); this._loop = null; }
  }

  hasRoom() {
    return this.players.length < this.cfg.maxPlayers;
  }

  addPlayer(player) {
    this.players.push(player);
    player.spawnInto(this.world, CELL.START_MASS * (1 + (this.cfg.growthMul - 1) * 0.5));
  }

  removePlayer(player) {
    if (!player) return;
    // Convert all their cells into pellets so their mass isn't lost
    for (const c of player.cells) {
      const n = Math.min(20, Math.floor(c.mass / 12));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * c.radius;
        this.pellets.push(new Pellet(
          clampX(c.x + Math.cos(a) * r),
          clampY(c.y + Math.sin(a) * r),
          12,
          true,
        ));
      }
    }
    this.players = this.players.filter(p => p !== player);
  }

  fillWithBots() {
    const target = this.cfg.botCount;
    while (this.players.filter(p => p.isBot).length < target && this.hasRoom()) {
      const id = `bot_${this.players.length + 1}_${Math.floor(Math.random() * 100000)}`;
      const bot = new Player({
        id,
        name: pickBotName(this.players.length),
        mode: this.mode,
        clan: this.mode === MODES.CFFA
          ? (["RED","BLU","GRN","YEL","PRP","ORG","CYN","MAG"][Math.floor(Math.random() * 8)])
          : null,
        isBot: true,
      });
      this.addPlayer(bot);
    }
  }

  _tick() {
    const now = Date.now();
    // dt is expressed in "tick units" — 1.0 means one full 33ms tick has
    // elapsed. Capped at 2 so a slow tick doesn't catapult cells across the
    // world. Without this cap, drops in the event loop would apply huge
    // distances per tick.
    const dt = Math.min(2, (now - this.lastTickAt) / 1000 * TICK_RATE);
    this.lastTickAt = now;

    // Maintain bot count (in case real players drop and free slots)
    this.fillWithBots();

    // Bot AI
    for (const p of this.players) {
      if (p.isBot) botThink(p, this);
    }

    // Movement + decay
    for (const p of this.players) {
      if (!p.alive) continue;
      for (const c of p.cells) {
        moveCell(c, p, dt);
        decayCell(c, dt);
      }
      mergeCells(p);
      p.recomputeScore();
    }

    // Rebuild grid
    const grid = this._grid;
    grid.clear();
    for (const p of this.players) for (const c of p.cells) grid.insert(c, c.radius);
    for (const pellet of this.pellets) grid.insert(pellet, pellet.radius);
    for (const v of this.viruses) grid.insert(v, v.radius);

    // Cell-cell collisions (one cell may eat another)
    for (const p of this.players) {
      if (!p.alive || p.cells.length === 0) continue;
      // Check pairs of cells owned by same player (re-merge is handled by mergeCells above)
      // Now check against other players' cells via grid
      for (const c of p.cells) {
        const candidates = [];
        grid.query(c.x, c.y, c.radius + 500, candidates);
        for (const other of candidates) {
          if (other === c) continue;
          if (other instanceof Cell === false) continue;
          if (other.owner === p) continue;
          if (!other.owner.alive) continue;
          if (!canEat(c.mass, other.mass)) continue;
          const dist = distance(c.x, c.y, other.x, other.y);
          if (dist < c.radius * 0.8) {
            c.mass += other.mass;
            other.owner.cells = other.owner.cells.filter(cc => cc !== other);
            if (other.owner.cells.length === 0) {
              other.owner.kill();
              // Real players respawn after a short delay
              if (!other.owner.isBot && this.realPlayers.has(other.owner.id)) {
                setTimeout(() => {
                  if (!other.owner.alive && this.realPlayers.has(other.owner.id)) {
                    other.owner.alive = true;
                    other.owner.spawnInto(this.world, CELL.START_MASS);
                  }
                }, 1500);
              }
            }
            // Remove from grid (it was inserted this tick)
          }
        }
      }
    }

    // Pellet pickups
    const pelletDecay = [];
    for (const pellet of this.pellets) {
      const candidates = [];
      grid.query(pellet.x, pellet.y, pellet.radius + 20, candidates);
      for (const c of candidates) {
        if (!(c instanceof Cell)) continue;
        if (!c.owner.alive) continue;
        const r = c.radius * 0.7;
        if (distance(c.x, c.y, pellet.x, pellet.y) < r) {
          c.mass += pellet.mass;
          pellet._dead = true;
          break;
        }
      }
      if (pellet.ejected) {
        // Slow decay of ejected mass
        if (Math.random() < 0.001) pellet._dead = true;
      }
    }
    this.pellets = this.pellets.filter(p => !p._dead);

    // Virus collisions (split player into many cells)
    for (const v of this.viruses) {
      v.step(dt);
      const candidates = [];
      grid.query(v.x, v.y, v.radius + 100, candidates);
      for (const c of candidates) {
        if (!(c instanceof Cell)) continue;
        if (!c.owner.alive) continue;
        if (distance(c.x, c.y, v.x, v.y) < v.radius) {
          if (c.mass >= v.mass * VIRUS.SPLIT_THRESHOLD) {
            // Split this cell as many times as possible
            const max = Math.min(CELL.MAX_CELLS_PER_PLAYER, c.owner.cells.length + VIRUS.MAX_CHILDREN - 1);
            let safety = 8;
            while (c.owner.cells.length < max && c.mass >= CELL.SPLIT_MIN_MASS && safety-- > 0) {
              // Aim split away from virus center
              const dx = c.x - v.x;
              const dy = c.y - v.y;
              const d = Math.hypot(dx, dy) || 1;
              c.owner.targetX = c.x + dx / d * 100;
              c.owner.targetY = c.y + dy / d * 100;
              splitCell(c, c.owner, this.cfg.splitSpeed);
            }
            // Bounce the virus a bit
            const dx = c.x - v.x;
            const dy = c.y - v.y;
            const d = Math.hypot(dx, dy) || 1;
            v.x -= (dx / d) * 20;
            v.y -= (dy / d) * 20;
          }
        }
      }
    }

    // Pellet count maintenance — keep world topped up
    while (this.pellets.length < PELLET.COUNT) {
      this.pellets.push(new Pellet(
        Math.random() * WORLD.WIDTH,
        Math.random() * WORLD.HEIGHT,
      ));
    }

    // Broadcast
    const sinceSnapshot = now - this.lastSnapshotAt;
    if (sinceSnapshot >= SNAPSHOT_INTERVAL_MS) {
      this.lastSnapshotAt = now;
      this._broadcast();
    }
  }

  // ---- Player input handling ----
  setTarget(player, x, y) {
    player.targetX = clampX(x);
    player.targetY = clampY(y);
    player.lastInputAt = Date.now();
  }

  split(player) {
    if (!player.alive) return;
    const cells = player.cells.slice();
    for (const c of cells) {
      if (player.cells.length >= CELL.MAX_CELLS_PER_PLAYER) break;
      splitCell(c, player, this.cfg.splitSpeed);
    }
    player.recomputeScore();
  }

  macroSplit(player) {
    if (!player.alive) return;
    // Split every cell roughly toward their own current target (chaotic)
    const cells = player.cells.slice();
    for (const c of cells) {
      if (player.cells.length >= CELL.MAX_CELLS_PER_PLAYER) break;
      splitCell(c, player, this.cfg.splitSpeed * 1.2);
    }
    player.recomputeScore();
  }

  ejectMass(player, key) {
    if (!player.alive) return;
    for (const c of player.cells) {
      if (c.mass < CELL.EJECT_MIN_MASS) continue;
      c.mass -= CELL.EJECT_MASS;
      const dx = (key === "w" ? 0 : 1);
      const dy = 0;
      const d = Math.hypot(dx, dy) || 1;
      const pellet = new Pellet(
        c.x + (dx / d) * c.radius,
        c.y + (dy / d) * c.radius,
        CELL.EJECT_MASS,
        true,
        player.id,
      );
      pellet.vx = (dx / d) * CELL.EJECT_SPEED;
      pellet.vy = (dy / d) * CELL.EJECT_SPEED;
      // For real W/E keys we send from the client; default to direction of travel
      // (this fallback is only used by bots or invalid input)
      if (player.isBot) {
        const vmag = Math.hypot(c.vx, c.vy);
        if (vmag > 0.1) {
          pellet.vx = (c.vx / vmag) * CELL.EJECT_SPEED;
          pellet.vy = (c.vy / vmag) * CELL.EJECT_SPEED;
        }
      }
      this.pellets.push(pellet);
    }
    player.recomputeScore();
  }

  macroFeed(player) {
    if (!player.alive) return;
    // Force-feed: rapidly eject from every cell toward their own current target
    const cells = player.cells.slice();
    for (const c of cells) {
      if (c.mass < CELL.EJECT_MIN_MASS) continue;
      c.mass -= CELL.EJECT_MASS;
      const vmag = Math.hypot(c.vx, c.vy);
      const dx = vmag > 0.1 ? c.vx / vmag : 1;
      const dy = vmag > 0.1 ? c.vy / vmag : 0;
      const pellet = new Pellet(
        c.x + dx * c.radius,
        c.y + dy * c.radius,
        CELL.EJECT_MASS,
        true,
        player.id,
      );
      pellet.vx = dx * CELL.EJECT_SPEED;
      pellet.vy = dy * CELL.EJECT_SPEED;
      this.pellets.push(pellet);
    }
    player.recomputeScore();
  }

  spendGold(player, key) {
    if (!player.alive) return;
    if (player.gold <= 0) {
      // Bots and humans gain gold passively
      player.gold += 1;
      return;
    }
    player.gold -= 1;
    const amount = key === "s" ? CELL.START_MASS / 2 : CELL.START_MASS / 4;
    for (const c of player.cells) c.mass += amount;
    player.recomputeScore();
  }

  // ---- Snapshot / network ----
  _broadcast() {
    if (this.realPlayers.size === 0) return;
    const leaderboard = this._leaderboard();
    const t = Date.now();

    for (const playerId of this.realPlayers) {
      const player = this.players.find(p => p.id === playerId);
      if (!player || !player.alive) {
        // Still send a leaderboard-only update so the client can render the empty world
        const conn = this._conns.get(playerId);
        if (conn && conn.readyState === 1) {
          conn.send(JSON.stringify({ t: S2C.LEADERBOARD, rows: leaderboard }));
        }
        continue;
      }
      // Compute viewport: union of all owned cells, expanded by their radii
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of player.cells) {
        if (c.x - c.radius < minX) minX = c.x - c.radius;
        if (c.y - c.radius < minY) minY = c.y - c.radius;
        if (c.x + c.radius > maxX) maxX = c.x + c.radius;
        if (c.y + c.radius > maxY) maxY = c.y + c.radius;
      }
      const pad = 400;
      const viewMinX = Math.max(0, minX - pad);
      const viewMinY = Math.max(0, minY - pad);
      const viewMaxX = Math.min(WORLD.WIDTH, maxX + pad);
      const viewMaxY = Math.min(WORLD.HEIGHT, maxY + pad);

      // Collect nearby entities via grid (cheaper than scanning whole room)
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const r = Math.max(viewMaxX - viewMinX, viewMaxY - viewMinY) / 2;
      const nearby = [];
      this._grid.query(cx, cy, r + 200, nearby);

      const cells = [];
      const pellets = [];
      const viruses = [];
      const seen = new Set();
      for (const e of nearby) {
        if (e instanceof Cell) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (e.x < viewMinX || e.x > viewMaxX || e.y < viewMinY || e.y > viewMaxY) continue;
          if (!e.owner.alive) continue;
          cells.push({
            id: e.id,
            o: e.owner.id,
            x: e.x, y: e.y, m: e.mass,
            c: e.owner.color,
            n: e.owner.name,
            cl: e.owner.clan || "",
          });
        } else if (e instanceof Pellet) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (e.x < viewMinX || e.x > viewMaxX || e.y < viewMinY || e.y > viewMaxY) continue;
          pellets.push({ id: e.id, x: e.x, y: e.y, m: e.mass, e: e.ejected ? 1 : 0 });
        } else if (e instanceof Virus) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          if (e.x < viewMinX || e.x > viewMaxX || e.y < viewMinY || e.y > viewMaxY) continue;
          viruses.push({ id: e.id, x: e.x, y: e.y, m: e.mass });
        }
      }

      const you = player.cells.map(c => ({ id: c.id, x: c.x, y: c.y, m: c.mass }));

      const conn = this._conns.get(playerId);
      if (conn && conn.readyState === 1) {
        const msg = JSON.stringify({
          t: S2C.SNAPSHOT,
          ts: t,
          you,
          cells, pellets, viruses,
          view: { x: viewMinX, y: viewMinY, w: viewMaxX - viewMinX, h: viewMaxY - viewMinY },
        });
        try { conn.send(msg); } catch (_) {}
        // Leaderboard every other snapshot to save bandwidth
        if ((t % 600) < 33) {
          try { conn.send(JSON.stringify({ t: S2C.LEADERBOARD, rows: leaderboard })); } catch (_) {}
        }
      }
    }
  }

  _leaderboard() {
    const rows = this.players
      .filter(p => p.alive)
      .map(p => ({ id: p.id, name: p.name, score: p.score | 0, clan: p.clan || "", bot: p.isBot ? 1 : 0 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    return rows;
  }
}

function clampX(x) { return x < 0 ? 0 : x > WORLD.WIDTH ? WORLD.WIDTH : x; }
function clampY(y) { return y < 0 ? 0 : y > WORLD.HEIGHT ? WORLD.HEIGHT : y; }
