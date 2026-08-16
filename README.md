# LocalAgar

A local, self-hosted clone of [agarz.com](https://agarz.com) — a real-time multiplayer agar.io-style game.

Players control a circular cell on a 2D arena, eat pellets and smaller players to grow, split to attack or escape, and watch out for viruses (green spiky circles) that split you if you're too big.

## Features

- Real-time multiplayer via WebSockets (`ws`)
- HTML5 Canvas rendering at 60 FPS with client-side interpolation
- Cells, splitting (`Space`), mass ejection (`W`/`E`), macro split/feed (`Z`/`X`), gold-to-mass (`A`/`S`)
- Pellets, viruses, leaderboard, minimap
- Game modes: Free-For-All (FFA), Clan FFA (CFFA), and Event ("Etkinlik") rooms
- Bot players so rooms stay populated even when running solo
- Spatial partitioning (grid) for efficient collision checks
- No external services required — fully local

## Requirements

- Node.js **>= 18**

## Quick Start

```bash
npm install
npm start
```

Then open **http://localhost:3000** in one or more browser tabs (or different machines on the same LAN).

To change the port: `PORT=8080 npm start`

## Controls

| Action            | Key       |
| ----------------- | --------- |
| Move cell         | Mouse     |
| Split cell        | `Space`   |
| Eject mass (W)    | `W`       |
| Eject mass (E)    | `E`       |
| Macro split       | `Z`       |
| Macro feed        | `X`       |
| Gain mass (gold)  | `A` / `S` |
| Toggle leaderboard | `Tab`    |

## Game Modes

- **FFA** — last cell standing wins; everyone fights everyone.
- **CFFA** — choose a clan tag at spawn; only same-clan cells can merge; cross-clan combat.
- **Etkinlik** — periodic event mode with tweaked rules (faster growth, more viruses).

Pick a mode from the home screen.

## Architecture

```
server/        Node.js WebSocket game server
  index.js       Entry point (HTTP + ws, static hosting)
  server.js      Room registry / lifecycle
  room.js        Per-room game loop, state, broadcasting
  physics.js     Movement, splitting, merging, decay
  collisions.js  Pellet/cell/virus collisions + grid partitioning
  player.js      Player + cell state
  virus.js       Virus entities
  pellet.js      Pellet entities
  bot.js         AI-controlled filler players
  protocol.js    Wire format (client <-> server messages)
client/        Browser-side JS
  main.js        Bootstraps game, connects to ws
  net.js         WebSocket client
  input.js       Mouse + keyboard handling
  render.js      Canvas rendering
  camera.js      View transform (follow player, world->screen)
  ui.js          HUD, menus, leaderboard
public/        Static HTML / CSS served by the server
  index.html
  styles.css
shared/        Constants shared between client and server
  constants.js
```

The server runs the authoritative game loop and broadcasts a snapshot of visible state to each client at ~30 Hz. The client interpolates between snapshots and renders at the browser's refresh rate.

## Running on a LAN

Start the server on one machine, then point other machines at `http://<host-ip>:3000`. The client connects via `ws://<host-ip>:3000/ws` automatically (uses the page's host).

## License

MIT
