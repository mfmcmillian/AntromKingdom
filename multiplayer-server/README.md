# Kingdom of Antrom Multiplayer Server

Colyseus authoritative server for RTS multiplayer.

## Commands

```bash
npm run dev
npm run build
npm start
```

The server listens on `ws://localhost:2567` by default and exposes `GET /health`.

## Room

The first room is `rts_room`. It currently:

- Assigns up to two players to `player1` and `player2`.
- Creates starting Temple state at the player and enemy base positions.
- Starts the match when two players join, or when a client sends `{ type: 'startMatch' }`.
- Advances authoritative match time on the server.
- Ends the match when a client sends `{ type: 'endMatch' }`.

Future slices will move resources, units, production, construction, gathering, combat, and AI from the Decentraland client into this room.
