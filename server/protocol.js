// Wire format for client <-> server messages.
// Server -> client messages use `type`. Client -> server uses `t` for compactness.

export const S2C = Object.freeze({
  WELCOME: "welcome",           // { selfId, roomId, mode, world, constants }
  SNAPSHOT: "snapshot",         // { t, you, cells: [{id,owner,x,y,mass,color}], pellets: [{id,x,y}], viruses: [{id,x,y,mass}] }
  PING: "ping",                 // { t }
  PONG: "pong",                 // { t }
  PLAYER_JOINED: "player_joined",
  PLAYER_LEFT: "player_left",
  LEADERBOARD: "leaderboard",   // { rows: [{id,name,score}] }
});

export const C2S = Object.freeze({
  JOIN: { t: "join", payload: { name: "string", mode: "string", clan: "string|null" } },
  INPUT: { t: "input", payload: { x: "number", y: "number" } },
  SPLIT: { t: "split" },
  EJECT: { t: "eject", payload: { key: "w"|"e" } },
  MACRO: { t: "macro", payload: { key: "z"|"x" } },
  GOLD: { t: "gold", payload: { key: "a"|"s" } },
  PONG: { t: "pong", payload: { t: "number" } },
});
