// A single game room: holds players, pellets, viruses, runs the tick loop,
// and broadcasts snapshots to connected clients.

import {
  WORLD, TICK_RATE, CELL, PELLET, VIRUS, MODES, MODE_CONFIG, massToRadius, GOLD,
} from "../shared/constants.js";
import { Cell, Player } from "./player.js";
import { Pellet, spawnInitialPellets } from "./pellet.js";
import { Virus, spawnViruses } from "./virus.js";
import { SpatialGrid, distance, canEat } from "./collisions.js";
import {
  moveCell, decayCell, splitCell, mergeCells, separateCells,
} from "./physics.js";
import { S2C } from "./protocol.js";
import { botThink, pickBotName } from "./bot.js";
import * as accounts from "./accounts.js";

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
    this._pendingRankUps = new Map(); // playerId -> rank-up label (for client toast)
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

  // Award rank points to a real player for an objective and queue a
  // rank-up notification if they climbed a division.  Bots are ignored.
  _awardRank(player, kind) {
    if (!player || player.isBot) return;
    const res = player.awardRankPoints(kind);
    if (res && res.rankedUp) {
      this._pendingRankUps.set(player.id, res.label);
    }
  }

  // Pop (and clear) any pending rank-up notification for a player.
  _takeRankUp(playerId) {
    const label = this._pendingRankUps.get(playerId);
    if (label) this._pendingRankUps.delete(playerId);
    return label || null;
  }

  // Build the death-review payload sent to the client when a player is
  // eaten. Includes this-run stats and lifetime totals.
  _deathPayload(player) {
    const ri = player.getRankInfo();
    return {
      t: S2C.DEATH,
      run: {
        maxMass: Math.floor(player.runMaxMass || 0),
        duration: Math.max(0, Math.floor((Date.now() - (player.runStartedAt || Date.now())) / 1000)),
        kills: Math.max(0, player.kills - player.runStartKills),
        playerKills: Math.max(0, player.playerKills - player.runStartPlayerKills),
        virusesEaten: Math.max(0, player.virusesEaten - player.runStartViruses),
        goldGained: Math.max(0, player.gold - player.runStartGold),
        rpGained: Math.max(0, player.rankPoints - player.runStartRank),
      },
      lifetime: {
        gold: player.gold,
        level: player.level,
        rankPoints: player.rankPoints,
        rankLabel: ri.label,
        divIndex: ri.divIndex,
        kills: player.kills,
        playerKills: player.playerKills,
        virusesEaten: player.virusesEaten,
        totalMassEaten: Math.floor(player.totalMassEaten),
        bestScore: Math.floor(Math.max(player.bestScore || 0, player.runMaxMass || 0)),
      },
    };
  }

  addPlayer(player) {
    this.players.push(player);
    // Give every player a starter cluster of pellets so they can begin
    // growing immediately (and so they don't decay to MIN_MASS before
    // finding food in an empty patch of the world).
    player.setStarterClusterSpawner((x, y) => this._spawnStarterCluster(x, y));
    player.spawnInto(this.world, CELL.START_MASS * (1 + (this.cfg.growthMul - 1) * 0.5));
  }

  _spawnStarterCluster(x, y) {
    // Drop ~40 pellets in a 400px radius around the spawn point.
    const count = 40;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 400;
      this.pellets.push(new Pellet(
        clampX(x + Math.cos(a) * r),
        clampY(y + Math.sin(a) * r),
      ));
    }
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

    // Passive gold: every player (alive or dead, real or bot) earns gold
    // over time just for being in the game.  Fractional gold is accumulated
    // and converted to whole gold when it crosses 1.
    const dtSec = dt / TICK_RATE;
    const passiveGold = GOLD.PASSIVE_PER_SECOND * dtSec;
    for (const p of this.players) {
      if (p.isBot) continue;          // bots don't need gold
      p.addFractionalGold(passiveGold);
    }

    // Movement + decay
    for (const p of this.players) {
      if (!p.alive) continue;
      
      // First pass: clear auto-split flags
      for (const c of p.cells) {
        c._autoSplitThisTick = false;
      }
      
      // Second pass: movement, decay, auto-split
      for (const c of p.cells) {
        moveCell(c, p, dt);
        decayCell(c, dt);

        // Auto-split at 22500 mass (if under 16 cells) - only once per cell per tick
        if (c.mass >= CELL.AUTO_SPLIT_MASS && p.cells.length < CELL.MAX_CELLS_PER_PLAYER && !c._autoSplitThisTick) {
          const dx = c.vx || 1;
          const dy = c.vy || 0;
          const d = Math.hypot(dx, dy) || 1;
          p.targetX = c.x + (dx / d) * 100;
          p.targetY = c.y + (dy / d) * 100;
          splitCell(c, p, this.cfg.splitSpeed, true);
          c._autoSplitThisTick = true;
        }
        
        // Hard cap at 30000 - trim excess mass
        if (c.mass > CELL.HARD_MAX_SIZE) {
          c.mass = CELL.HARD_MAX_SIZE;
        }
      }
      // Push same-owner cells apart while merge cooldown is active so
      // split cells sit on the parent's outline (agar.io behaviour).
      separateCells(p);
      mergeCells(p);
      p.recomputeScore();
      if (p.score > p.runMaxMass) p.runMaxMass = p.score;
      if (p.runMaxMass > p.bestScore) p.bestScore = p.runMaxMass;
    }

    // Move ejected pellets (they travel and then slow down)
    for (const pellet of this.pellets) {
      if (!pellet.ejected || !pellet.vx) continue;
      pellet.x += pellet.vx * dt;
      pellet.y += pellet.vy * dt;
      // Drag/friction slows pellets down over time
      pellet.vx *= 0.92;
      pellet.vy *= 0.92;
      // Stop when very slow
      if (Math.hypot(pellet.vx, pellet.vy) < 0.5) {
        pellet.vx = 0;
        pellet.vy = 0;
      }
      // Clamp to world bounds
      if (pellet.x < 0) { pellet.x = 0; pellet.vx = 0; }
      if (pellet.y < 0) { pellet.y = 0; pellet.vy = 0; }
      if (pellet.x > WORLD.WIDTH) { pellet.x = WORLD.WIDTH; pellet.vx = 0; }
      if (pellet.y > WORLD.HEIGHT) { pellet.y = WORLD.HEIGHT; pellet.vy = 0; }
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
            // Cap mass at maximum size limit
            if (c.mass > CELL.MAX_SIZE) {
              c.mass = CELL.MAX_SIZE;
            }
            // Award XP and gold for eating other players.
            // Gold scales with the eaten player's mass — bigger prey = more
            // gold.  Real players give 3x the gold rate of bots plus a flat
            // bonus, so hunting players is far more rewarding than farming.
            if (!other.owner.isBot && p.isBot === false) {
              const xpGain = Math.floor(other.mass * 0.5);
              const goldGain = Math.floor(other.mass * GOLD.EAT_PLAYER_MULTIPLIER) + GOLD.EAT_PLAYER_BONUS;
              p.xp += xpGain;
              p.gold += goldGain;
              p.totalMassEaten += other.mass;
              // Rank points for a real-player kill
              this._awardRank(p, "kill_player");
              // Check for level up
              const xpNeeded = p.level * 100;
              if (p.xp >= xpNeeded) {
                p.level++;
                p.xp = 0;
                p.gold += GOLD.LEVEL_UP_BONUS;
              }
            } else if (other.owner.isBot && !p.isBot) {
              // Smaller rewards for eating bots
              const xpGain = Math.floor(other.mass * 0.2);
              const goldGain = Math.floor(other.mass * GOLD.EAT_BOT_MULTIPLIER);
              p.xp += xpGain;
              p.gold += goldGain;
              p.totalMassEaten += other.mass;
              // Rank points for a bot kill (counts toward hasEatenPlayer)
              this._awardRank(p, "kill_bot");
              const xpNeeded = p.level * 100;
              if (p.xp >= xpNeeded) {
                p.level++;
                p.xp = 0;
                p.gold += GOLD.LEVEL_UP_BONUS;
              }
            }
            other.owner.cells = other.owner.cells.filter(cc => cc !== other);
            if (other.owner.cells.length === 0) {
              other.owner.kill();
              // Real players: persist progress and show the death review
              // screen. They choose Respawn or Main Menu from the client.
              if (!other.owner.isBot && this.realPlayers.has(other.owner.id)) {
                accounts.savePlayer(other.owner);
                const conn = this._conns.get(other.owner.id);
                if (conn && conn.readyState === 1) {
                  try { conn.send(JSON.stringify(this._deathPayload(other.owner))); } catch (_) {}
                }
              }
            }
            // Remove from grid (it was inserted this tick)
          }
        }
      }
    }

    // Pellet pickups + virus feeding.
    // Ejected mass can be shot INTO a virus: the virus absorbs the pellet,
    // nudges in the direction it was fed, and after a random 10–15 pellets
    // it shoots itself toward where you aimed (and can pop a player it hits).
    for (const pellet of this.pellets) {
      const candidates = [];
      grid.query(pellet.x, pellet.y, pellet.radius + 50, candidates);
      let eaten = false;
      if (pellet.ejected) {
        for (const e of candidates) {
          if (!(e instanceof Virus)) continue;
          if (distance(pellet.x, pellet.y, e.x, e.y) < e.radius) {
            const pvx = pellet.vx || 0, pvy = pellet.vy || 0;
            // Feeder is behind the pellet's travel direction.
            e.feed(CELL.EJECT_MASS_GAIN, e.x - pvx, e.y - pvy);
            pellet._dead = true;
            eaten = true;
            if (e.canShoot()) {
              // DUPLICATE: spawn a new virus that flies out in the feed
              // direction (the original stays put and resets). Capped so
              // the arena doesn't fill with viruses indefinitely.
              if (this.viruses.length < this.cfg.virusCount + 10) {
                const dm = Math.hypot(pvx, pvy) || 1;
                const nx = pvx / dm, ny = pvy / dm;
                const child = new Virus(
                  clampX(e.x + nx * (e.radius + 12)),
                  clampY(e.y + ny * (e.radius + 12)),
                  VIRUS.MASS,
                );
                child.vx = nx * VIRUS.SHOOT_SPEED;
                child.vy = ny * VIRUS.SHOOT_SPEED;
                this.viruses.push(child);
              }
              e.shoot();
            }
            break;
          }
        }
        if (eaten) continue;
        // Slow decay of ejected mass that hits nothing.
        if (Math.random() < 0.001) pellet._dead = true;
      }
      // Cell absorbs an ambient/ejected pellet when surfaces touch.
      for (const c of candidates) {
        if (!(c instanceof Cell)) continue;
        if (!c.owner.alive) continue;
        const r = c.radius + pellet.radius * 0.6;
        if (distance(c.x, c.y, pellet.x, pellet.y) < r) {
          c.mass += pellet.mass;
          if (c.mass > CELL.MAX_SIZE) c.mass = CELL.MAX_SIZE;
          pellet._dead = true;
          break;
        }
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
          // Check if player has reached max cells - can eat virus without splitting
          if (c.owner.cells.length >= CELL.MAX_CELLS_PER_PLAYER) {
            // Consume virus: gain +100 mass, no splitting
            c.mass += CELL.VIRUS_MASS_GAIN;
            if (c.mass > CELL.HARD_MAX_SIZE) c.mass = CELL.HARD_MAX_SIZE;
            // Rank points for eating a virus
            this._awardRank(c.owner, "virus");
            // Virus consumed — relocate to a new spot (avoiding past positions)
            v.relocate(WORLD.WIDTH, WORLD.HEIGHT);
            v.resetAfterSplit();
            continue;
          }

          if (c.mass >= v.mass * VIRUS.SPLIT_THRESHOLD) {
            // Check size milestone: must be >= 150 mass to pop virus
            if (c.mass < CELL.MILESTONE_VIRUS_POP) {
              continue; // Too small to be split by virus
            }
            // Pop into 8-16 pieces (virus pop)
            const targetCells = CELL.VIRUS_POP_MIN_CELLS + 
              Math.floor(Math.random() * (CELL.VIRUS_POP_MAX_CELLS - CELL.VIRUS_POP_MIN_CELLS + 1));
            const max = Math.min(CELL.MAX_CELLS_PER_PLAYER, c.owner.cells.length + targetCells - 1);
            let safety = 16;
            while (c.owner.cells.length < max && c.mass >= CELL.SPLIT_MIN_MASS && safety-- > 0) {
              // Aim split away from virus center
              const dx = c.x - v.x;
              const dy = c.y - v.y;
              const d = Math.hypot(dx, dy) || 1;
              c.owner.targetX = c.x + dx / d * 100;
              c.owner.targetY = c.y + dy / d * 100;
              splitCell(c, c.owner, this.cfg.splitSpeed);
            }
            // Rank points for popping a virus
            this._awardRank(c.owner, "virus");
            // Virus is consumed by the pop — relocate to a new spot
            // (avoiding past positions so it never returns to the exact
            // same spot more than once, like agar.io).
            v.relocate(WORLD.WIDTH, WORLD.HEIGHT);
            v.resetAfterSplit();
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

    // Periodically persist real players' progress to their accounts.
    if (now - (this._lastAccountSaveAt || 0) > 5000) {
      this._lastAccountSaveAt = now;
      for (const p of this.players) {
        if (!p.isBot && p.accountName && this.realPlayers.has(p.id)) accounts.savePlayer(p);
      }
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
    // Sort cells by split time (oldest first) so when player has >8 cells,
    // the ones that split earliest are the ones that can split again
    const cells = player.cells.slice().sort((a, b) => {
      const aTime = a.splitAt || 0;
      const bTime = b.splitAt || 0;
      return aTime - bTime;  // oldest first
    });
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

  // Eject mass: W = single pellet, E = fast shooting (all cells eject)
  ejectMass(player, key) {
    if (!player.alive) return;

    if (key === "w") {
      // Single pellet: eject from the largest cell only
      let largestCell = null;
      let largestMass = 0;
      for (const c of player.cells) {
        // Must be at least 32 mass to eject (milestone) and have enough mass
        if (c.mass > largestMass && c.mass >= CELL.MILESTONE_EJECT && c.mass >= CELL.EJECT_MIN_MASS) {
          largestMass = c.mass;
          largestCell = c;
        }
      }
      if (!largestCell) return;

      const dir = this._getEjectDirection(largestCell);
      const pellet = new Pellet(
        largestCell.x + dir.x * largestCell.radius,
        largestCell.y + dir.y * largestCell.radius,
        CELL.EJECT_MASS_GAIN,  // 90% of 16 = 14.4
        true,
        player.id,
      );
      pellet.vx = dir.x * CELL.EJECT_SPEED;
      pellet.vy = dir.y * CELL.EJECT_SPEED;
      largestCell.mass -= CELL.EJECT_MASS_LOSS;  // lose 16 mass
      this.pellets.push(pellet);
      player.recomputeScore();
    } else if (key === "e") {
      // Fast shooting: eject from all cells that can afford it
      for (const c of player.cells) {
        // Must be at least 32 mass to eject (milestone)
        if (c.mass < CELL.MILESTONE_EJECT || c.mass < CELL.EJECT_MIN_MASS) continue;
        const dir = this._getEjectDirection(c);
        const pellet = new Pellet(
          c.x + dir.x * c.radius,
          c.y + dir.y * c.radius,
          CELL.EJECT_MASS_GAIN,  // 90% efficiency
          true,
          player.id,
        );
        pellet.vx = dir.x * CELL.EJECT_SPEED;
        pellet.vy = dir.y * CELL.EJECT_SPEED;
        c.mass -= CELL.EJECT_MASS_LOSS;  // lose 16
        this.pellets.push(pellet);
      }
      player.recomputeScore();
    }
  }

  // Get eject direction: toward mouse target by default
  _getEjectDirection(cell) {
    const dx = cell.owner.targetX - cell.x;
    const dy = cell.owner.targetY - cell.y;
    const d = Math.hypot(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  macroFeed(player) {
    if (!player.alive) return;
    // Force-feed: rapidly eject from every cell toward their own current target
    const cells = player.cells.slice();
    for (const c of cells) {
      if (c.mass < CELL.EJECT_MIN_MASS) continue;
      c.mass -= CELL.EJECT_MASS_LOSS;
      const vmag = Math.hypot(c.vx, c.vy);
      const dx = vmag > 0.1 ? c.vx / vmag : 1;
      const dy = vmag > 0.1 ? c.vy / vmag : 0;
      const pellet = new Pellet(
        c.x + dx * c.radius,
        c.y + dy * c.radius,
        CELL.EJECT_MASS_GAIN,
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
    // Gold-to-mass is locked until the player has eaten at least one
    // other player AND banked more than MASS_GATE_MIN_GOLD gold.  This
    // pushes players to hunt instead of farming pellets for free mass.
    const unlocked = player.hasEatenPlayer && player.gold > GOLD.MASS_GATE_MIN_GOLD;
    if (!unlocked) return;
    if (player.gold <= 0) return;
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
      // Compute viewport: union of all owned cells, expanded by their radii.
      // Use a generous padding so the player always sees enough pellets to
      // grow — small cells + tiny padding produced a viewport of 800x800
      // which had <1 pellet on average.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of player.cells) {
        if (c.x - c.radius < minX) minX = c.x - c.radius;
        if (c.y - c.radius < minY) minY = c.y - c.radius;
        if (c.x + c.radius > maxX) maxX = c.x + c.radius;
        if (c.y + c.radius > maxY) maxY = c.y + c.radius;
      }
      // Padding scales with the cell's biggest radius — bigger cells need
      // wider padding to see further, smaller cells just need enough to find
      // their next pellet.
      const cellR = player.cells.reduce((m, c) => Math.max(m, c.radius), 0);
      // Larger viewport padding so the player sees more surrounding
      // players/pellets/viruses, matching the wider zoomed-out view.
      // Capped to avoid sending the whole world for very large cells.
      const pad = Math.min(4000, Math.max(1300, cellR * 18));
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
      let pellets = [];
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
            s: e.owner.skin || "solid",
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

      // Cap ambient pellets per snapshot (stable thinning by id) so big
      // viewports don't flood the client. Ejected mass is always kept.
      if (pellets.length > PELLET.MAX_PER_SNAPSHOT) {
        const step = Math.ceil(pellets.length / PELLET.MAX_PER_SNAPSHOT);
        const kept = [];
        for (const pl of pellets) {
          if (pl.e || (hashId(pl.id) % step === 0)) kept.push(pl);
        }
        pellets = kept;
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
          gold: player.gold,
          level: player.level,
          xp: player.xp,
          xpNeeded: player.level * 100,
          rank: (() => {
            const ri = player.getRankInfo();
            return {
              divIndex: ri.divIndex,
              label: ri.label,
              rank: ri.rank,
              division: ri.division,
              progress: ri.progress,
              currentAt: ri.currentAt,
              nextAt: ri.nextAt,
              atTop: ri.atTop,
              rp: player.rankPoints,
              kills: player.kills,
              playerKills: player.playerKills,
              virusesEaten: player.virusesEaten,
              hasEatenPlayer: player.hasEatenPlayer,
              massUnlocked: player.hasEatenPlayer && player.gold > GOLD.MASS_GATE_MIN_GOLD,
            };
          })(),
          rankUp: this._takeRankUp(player.id),
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
// Stable 32-bit hash of an entity id (used to thin pellets consistently
// across frames so the same pellets stay visible until the viewport changes).
function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}
