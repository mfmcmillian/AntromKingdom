import { Schemas, engine } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// Shared transport definitions - imported by BOTH the authoritative server
// and clients so schemas and component ids match on every peer.

/** Sync id for the lobby entity the server publishes. */
export const LOBBY_SYNC_ID = 5001

/** Sync id for the ranked ladder entity the server publishes. */
export const RANKED_SYNC_ID = 5002

/**
 * Every lobby room as one JSON payload (a LobbyConfig[] in room-id order)
 * plus a revision counter. Written only by the authoritative server (enforced
 * via validateBeforeChange server-side); clients just parse it. Living in a
 * synced component means late joiners get all rooms without a round-trip.
 */
export const MpLobbyState = engine.defineComponent('dc-mp-lobby-state', {
  json: Schemas.String,
  revision: Schemas.Int
})

/**
 * The ranked Elo ladder as one JSON payload (a RankedLadder). Persisted in
 * world Storage server-side and republished after every ranked result, so the
 * leaderboard survives restarts and late joiners see it immediately.
 */
export const MpRankedState = engine.defineComponent('dc-mp-ranked-state', {
  json: Schemas.String,
  revision: Schemas.Int
})

// Anti-cheat: only the authoritative server may write the lobby and the ladder.
MpLobbyState.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)
MpRankedState.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)

// Every message carries the room id it belongs to, so concurrent matches
// never hear each other's traffic.
export const MpMessages = {
  // Client -> server: a LobbyRequest as JSON (sender comes from the transport).
  lobbyRequest: Schemas.Map({ lobbyId: Schemas.Int, json: Schemas.String }),
  // Client -> server: one MatchCommand issued for a seat the sender controls.
  matchCommand: Schemas.Map({ lobbyId: Schemas.Int, seat: Schemas.Int, json: Schemas.String }),
  // Server -> clients: frozen lobby snapshot that launches that room's match.
  matchStart: Schemas.Map({ lobbyId: Schemas.Int, json: Schemas.String }),
  // Server -> clients: a validated command rebroadcast in canonical order.
  commandRelayed: Schemas.Map({ lobbyId: Schemas.Int, seat: Schemas.Int, sender: Schemas.String, json: Schemas.String })
}

export const room = registerMessages(MpMessages)
