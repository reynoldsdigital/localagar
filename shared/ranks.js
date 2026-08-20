// Shared ranking system for LocalAgar.
//
// Modelled on Rocket League's competitive ladder:
//   Bronze -> Silver -> Gold -> Platinum -> Diamond
// with three divisions per rank (I, II, III), giving 15 total divisions.
//
// Players climb the ladder by earning "rank points" (RP). RP is awarded
// for completing combat objectives:
//   - eating another real player  (a "kill")           -> KILL_PLAYER_RP
//   - eating a bot                                        -> KILL_BOT_RP
//   - eating/popping a virus                              -> VIRUS_RP
//
// This file is side-effect free so it can be imported on both the server
// (for tracking) and the client (for display).

export const RANKS = Object.freeze([
  { name: "Bronze",   color: "#cd7f32", short: "B" },
  { name: "Silver",   color: "#cfd8e6", short: "S" },
  { name: "Gold",     color: "#ffd166", short: "G" },
  { name: "Platinum", color: "#7fdbff", short: "P" },
  { name: "Diamond",  color: "#b388ff", short: "D" },
]);

export const DIVISIONS_PER_RANK = 3;
export const TOTAL_DIVISIONS = RANKS.length * DIVISIONS_PER_RANK; // 15

// RP awarded per objective.
export const RANK_RP = Object.freeze({
  KILL_PLAYER_RP: 15,   // eat a real player
  KILL_BOT_RP: 6,       // eat a bot
  VIRUS_RP: 8,          // eat / pop a virus
});

// Cumulative RP required to *reach* a given division index (0 = Bronze I).
// Division 0 is the starting rank (0 RP). The cost of each step grows so
// the higher divisions take noticeably longer, like a real ladder.
//   threshold(d) = 50*d + 5*d^2
// which yields roughly:
//   B1=0  B2=55  B3=120 | S1=195  S2=280  S3=375
//   G1=480 G2=595 G3=720 | P1=855 P2=1000 P3=1155
//   D1=1320 D2=1495 D3=1680
export function rankPointsForDivision(divIndex) {
  if (divIndex <= 0) return 0;
  return Math.floor(50 * divIndex + 5 * divIndex * divIndex);
}

// Convert a raw RP total into a { rank, division, progress, nextAt } struct.
//   rank         -> index into RANKS (0..4)
//   division     -> 1..3 within the rank
//   divIndex     -> global 0..14 index (rank*3 + division-1)
//   progress     -> 0..1 fraction toward the NEXT division
//   currentAt    -> RP threshold of the current division
//   nextAt       -> RP threshold of the next division (or null if maxed)
//   atTop        -> true when the player has reached Diamond III
export function rankFromPoints(rp) {
  let divIndex = 0;
  for (let d = TOTAL_DIVISIONS - 1; d >= 0; d--) {
    if (rp >= rankPointsForDivision(d)) { divIndex = d; break; }
  }
  const atTop = divIndex >= TOTAL_DIVISIONS - 1;
  const currentAt = rankPointsForDivision(divIndex);
  const nextAt = atTop ? null : rankPointsForDivision(divIndex + 1);
  const span = nextAt != null ? nextAt - currentAt : 1;
  const into = rp - currentAt;
  const progress = atTop ? 1 : Math.max(0, Math.min(1, into / span));
  return {
    divIndex,
    rank: Math.floor(divIndex / DIVISIONS_PER_RANK),
    division: (divIndex % DIVISIONS_PER_RANK) + 1,
    progress,
    currentAt,
    nextAt,
    atTop,
  };
}

// Human-friendly label, e.g. "Gold II".
export function rankLabel(divIndex) {
  const r = Math.floor(divIndex / DIVISIONS_PER_RANK);
  const d = (divIndex % DIVISIONS_PER_RANK) + 1;
  const roman = ["I", "II", "III"][d - 1] || "I";
  return `${RANKS[r] ? RANKS[r].name : "Bronze"} ${roman}`;
}
