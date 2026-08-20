// Constants shared between client and server.
// Keep this file side-effect-free so it can be imported in both environments.

export const WORLD = Object.freeze({
  WIDTH: 16000,
  HEIGHT: 16000,
});

export const TICK_RATE = 30;            // server ticks per second
export const BROADCAST_RATE = 30;       // snapshots per second (per player)
export const INTERP_DELAY_MS = 100;     // client interpolation buffer

export const CELL = Object.freeze({
  START_MASS: 30,
  MIN_MASS: 10,
  MAX_CELLS_PER_PLAYER: 16,   // maximum number of cells
  MERGE_MIN_MASS_RATIO: 1.3,  // must be 33% larger to eat split cells (vs 25% for single cells)
  MERGE_BASE_TIME_MS: 30000,  // 30 seconds base merge cooldown
  MERGE_MASS_FACTOR: 0.0233,  // 2.33% of mass added to cooldown
  DECAY_RATE: 0.0008,         // passive mass loss: 0.08% of mass per second (slower, more forgiving)
  DECAY_MIN_RATE: 0,          // minimum flat decay per second (0 = pure percentage)
  DECAY_SIZE_THRESHOLD: 22500,// size where extra severe decay kicks in
  EAT_RATIO: 1.25,            // must be 25% larger in mass to eat another cell
  SPEED_BASE: 4.5,            // base pixels per tick at START_MASS
  SPEED_MIN: 1.5,             // minimum speed for biggest cells
  SPLIT_MIN_MASS: 35,         // minimum mass to split
  SPLIT_SPEED: 18,
  SPLIT_BOOST_FRICTION: 0.82, // per-tick friction decay for split boost velocity (lower = stops faster)
  SPLIT_BOOST_MIN: 0.3,       // boost velocity below this is zeroed out
  SPLIT_DECAY: 12,            // mass lost per split (per piece)
  SPLIT_HOLD_BONUS: 2.5,      // bonus split distance when holding space
  SPLIT_DISTANCE: 12,         // grid spaces traveled on split
  EJECT_MIN_MASS: 35,         // minimum mass to eject
  EJECT_MASS_LOSS: 16,        // mass lost when ejecting
  EJECT_MASS_GAIN: 14.4,      // 90% of 16 = 14.4 mass for pellet
  EJECT_SPEED: 32,
  EJECT_DECAY_PER_MIN: 2,
  EJECT_PELLET_LIFETIME_MS: 6000,
  // Size milestones
  MILESTONE_EJECT: 32,        // can eject mass
  MILESTONE_VIRUS_FEED: 150,  // can feed virus to create new one
  MILESTONE_VIRUS_POP: 150,   // can pop viruses
  AUTO_SPLIT_MASS: 22500,     // mass where auto-split occurs
  MAX_SIZE: 22500,            // maximum size limit (soft cap, auto-split triggers)
  HARD_MAX_SIZE: 30000,       // absolute maximum size
  // Virus mechanics
  VIRUS_MASS_GAIN: 100,       // mass gained from eating virus
  VIRUS_POP_MIN_CELLS: 8,     // minimum pieces from virus pop
  VIRUS_POP_MAX_CELLS: 16,    // maximum pieces from virus pop
});

export const PELLET = Object.freeze({
  COUNT: 7000,
  MASS: 3,                  // legacy average (used by ejected pellets)
  MASS_MIN: 2,              // ambient pellets vary in size for visual variety
  MASS_MAX: 6,
  RADIUS: 7,
  PICKUP_RADIUS: 20,
  EJECTED_PICKUP_RADIUS: 28,
  // Cap on ambient pellets sent per snapshot so very large viewports
  // (big cells) don't flood the client with thousands of pellets — the
  // main cause of "the bigger I get, the slower it gets".
  MAX_PER_SNAPSHOT: 1000,
});

export const VIRUS = Object.freeze({
  COUNT_FFA: 18,
  COUNT_CFFA: 14,
  COUNT_EVENT: 30,
  MASS: 100,
  RADIUS: 50,
  SPLIT_THRESHOLD: 1.2,        // cell >= 1.2x virus mass gets split into max pieces
  MAX_CHILDREN: 8,
  FEED_GROW: 14,               // mass required to grow a virus by 1
  PUSH_SPEED: 12,              // bounce speed applied to viruses when fed
  // Feeding a virus with ejected mass: it absorbs each pellet, nudges in the
  // direction it was fed, and once it has eaten a RANDOM number of pellets in
  // this range it "shoots" — launching itself toward where you aimed (and can
  // pop another player it flies into). Threshold is re-rolled after each shot.
  FEED_MIN: 10,
  FEED_MAX: 15,
  FEED_NUDGE: 6,               // small velocity kick per pellet fed
  SHOOT_SPEED: 42,             // launch speed when a virus shoots
  SHOOT_FRICTION: 0.95,        // per-tick velocity decay while flying
});

export const MODES = Object.freeze({
  FFA: "ffa",
  CFFA: "cffa",
  EVENT: "event",
});

export const MODE_CONFIG = Object.freeze({
  [MODES.FFA]:   { label: "FFA",      maxPlayers: 60, botCount: 50, virusCount: VIRUS.COUNT_FFA,   growthMul: 1.0, splitSpeed: 1.0 },
  [MODES.CFFA]:  { label: "CFFA",     maxPlayers: 60, botCount: 10, virusCount: VIRUS.COUNT_CFFA,  growthMul: 1.0, splitSpeed: 1.0 },
  [MODES.EVENT]: { label: "Etkinlik", maxPlayers: 80, botCount: 12, virusCount: VIRUS.COUNT_EVENT, growthMul: 1.5, splitSpeed: 1.2 },
});

export const CLAN_TAGS = Object.freeze([
  "RED", "BLU", "GRN", "YEL", "PRP", "ORG", "CYN", "MAG",
]);

// Shared colour palette used for cell skins AND ambient pellets, so the
// collectable mass blends in with the player colours.
export const PALETTE = Object.freeze([
  "#ff6b6b", "#4ecdc4", "#ffe066", "#a78bfa", "#fb7185",
  "#34d399", "#60a5fa", "#f472b6", "#fbbf24", "#22d3ee",
  "#f97316", "#10b981", "#e879f9", "#fb923c", "#84cc16",
]);

export const GOLD = Object.freeze({
  PASSIVE_PER_SECOND: 0.5,    // gold earned per second just for being in the game
  EAT_PLAYER_MULTIPLIER: 0.3, // 30% of eaten player's mass → gold (real players)
  EAT_BOT_MULTIPLIER: 0.12,   // 12% of eaten bot's mass → gold
  EAT_PLAYER_BONUS: 5,        // flat bonus gold for eating any real player
  LEVEL_UP_BONUS: 50,         // flat bonus gold on level up
  // --- Gold-to-mass gating ---
  // Players cannot convert gold into mass until they have actually
  // eaten at least one other player AND banked more than this much
  // gold. Encourages hunting instead of farming pellets.
  MASS_GATE_MIN_GOLD: 10,     // must have strictly more than this much gold
  MASS_GATE_NEEDS_KILL: true, // must have eaten a player first
});

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
