// Constants shared between client and server.
// Keep this file side-effect-free so it can be imported in both environments.

export const WORLD = Object.freeze({
  WIDTH: 12000,
  HEIGHT: 12000,
});

export const TICK_RATE = 30;            // server ticks per second
export const BROADCAST_RATE = 30;       // snapshots per second (per player)
export const INTERP_DELAY_MS = 100;     // client interpolation buffer

export const CELL = Object.freeze({
  START_MASS: 30,
  MIN_MASS: 10,
  MAX_CELLS_PER_PLAYER: 16,
  MERGE_MIN_MASS_RATIO: 1.2,   // cells must be at least 1.2x smaller to merge back
  MERGE_TIME_MS: 15000,        // 15s before pieces can re-merge
  DECAY_PER_MIN: 1,            // mass lost per minute per cell
  EAT_RATIO: 1.15,             // attacker must be 1.15x bigger to eat
  SPEED_BASE: 4.5,             // base pixels per tick at START_MASS
  SPEED_MIN: 1.5,              // minimum speed for biggest cells
  SPLIT_MIN_MASS: 36,
  SPLIT_SPEED: 18,
  SPLIT_DECAY: 12,             // mass lost per split (per piece)
  EJECT_MIN_MASS: 35,
  EJECT_MASS: 16,
  EJECT_SPEED: 26,
  EJECT_DECAY_PER_MIN: 2,      // ejected pellets decay
  EJECT_PELLET_LIFETIME_MS: 6000,
});

export const PELLET = Object.freeze({
  COUNT: 1500,
  MASS: 2,
  RADIUS: 6,
  PICKUP_RADIUS: 20,
  EJECTED_PICKUP_RADIUS: 28,
});

export const VIRUS = Object.freeze({
  COUNT_FFA: 12,
  COUNT_CFFA: 10,
  COUNT_EVENT: 24,
  MASS: 100,
  RADIUS: 50,
  SPLIT_THRESHOLD: 1.2,        // cell >= 1.2x virus mass gets split into max pieces
  MAX_CHILDREN: 8,
  FEED_GROW: 14,               // mass required to grow a virus by 1
  PUSH_SPEED: 12,              // bounce speed applied to viruses when fed
});

export const MODES = Object.freeze({
  FFA: "ffa",
  CFFA: "cffa",
  EVENT: "event",
});

export const MODE_CONFIG = Object.freeze({
  [MODES.FFA]:   { label: "FFA",      maxPlayers: 50, botCount: 8,  virusCount: VIRUS.COUNT_FFA,   growthMul: 1.0, splitSpeed: 1.0 },
  [MODES.CFFA]:  { label: "CFFA",     maxPlayers: 60, botCount: 10, virusCount: VIRUS.COUNT_CFFA,  growthMul: 1.0, splitSpeed: 1.0 },
  [MODES.EVENT]: { label: "Etkinlik", maxPlayers: 80, botCount: 12, virusCount: VIRUS.COUNT_EVENT, growthMul: 1.5, splitSpeed: 1.2 },
});

export const CLAN_TAGS = Object.freeze([
  "RED", "BLU", "GRN", "YEL", "PRP", "ORG", "CYN", "MAG",
]);

export const COLORS = Object.freeze({
  BACKGROUND: "#11131a",
  GRID: "rgba(255,255,255,0.04)",
  PELLET: "#b3e5a1",
  PELLET_EJECTED: "#ffd166",
  VIRUS_FILL: "rgba(80, 220, 100, 0.55)",
  VIRUS_STROKE: "rgba(40, 160, 60, 0.95)",
  VIRUS_SPIKE: "rgba(30, 120, 50, 0.95)",
  HUD_TEXT: "#ffffff",
  HUD_BG: "rgba(0,0,0,0.45)",
  LEADER_BG: "rgba(0,0,0,0.55)",
  MINIMAP_BG: "rgba(0,0,0,0.4)",
  MINIMAP_BORDER: "rgba(255,255,255,0.25)",
});

// Deterministic-ish ID generator (server side). Each cell/player gets a unique id.
let __idCounter = 1;
export function nextId(prefix = "e") {
  return `${prefix}${(__idCounter++).toString(36)}`;
}

export function massToRadius(mass) {
  // agar.io-style radius from mass
  return Math.sqrt(mass) * 4;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
