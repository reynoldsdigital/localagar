// Room registry. Picks (or creates) a room for a given mode and tracks sockets.

import { Room } from "./room.js";
import { MODES } from "../shared/constants.js";

class Server {
  constructor() {
    this.rooms = new Map(); // mode -> Room
  }

  getRoomFor(mode) {
    if (!this.rooms.has(mode)) {
      const room = new Room({ mode });
      room.start();
      this.rooms.set(mode, room);
    }
    return this.rooms.get(mode);
  }

  // Join a player to a mode room. Returns { room, player }.
  joinPlayer(player) {
    const room = this.getRoomFor(player.mode);
    room.realPlayers.add(player.id);
    room._conns = room._conns || new Map();
    room.addPlayer(player);
    // Ensure bot population even if room started before any humans
    room.fillWithBots();
    return room;
  }

  removePlayer(playerId, room) {
    if (!room) return;
    room.realPlayers.delete(playerId);
    if (room._conns) room._conns.delete(playerId);
    const player = room.players.find(p => p.id === playerId);
    if (player) room.removePlayer(player);
  }

  shutdown() {
    for (const r of this.rooms.values()) r.stop();
  }
}

export const server = new Server();
