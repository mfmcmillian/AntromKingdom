import { Schemas, engine } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

// Shared transport definitions - imported by BOTH the authoritative server
// and clients so schemas and component ids match on every peer.

/** Sync id for the lobby entity the server publishes. */
export const LOBBY_SYNC_ID = 5001

/**
 * The whole lobby as a JSON payload plus a revision counter. Written only by
 * the authoritative server (enforced via validateBeforeChange server-side);
 * clients just parse it. Living in a synced component means late joiners get
 * the current lobby without any request round-trip.
 */
export const MpLobbyState = engine.defineComponent('dc-mp-lobby-state', {
  json: Schemas.String,
  revision: Schemas.Int
})

// Anti-cheat: only the authoritative server may write the lobby.
MpLobbyState.validateBeforeChange((value) => value.senderAddress === AUTH_SERVER_PEER_ID)

export const MpMessages = {
  // Client -> server: a LobbyRequest as JSON (sender comes from the transport).
  lobbyRequest: Schemas.Map({ json: Schemas.String }),
  // Client -> server: one MatchCommand issued for a seat the sender controls.
  matchCommand: Schemas.Map({ seat: Schemas.Int, json: Schemas.String }),
  // Server -> clients: frozen lobby snapshot that launches the match everywhere.
  matchStart: Schemas.Map({ json: Schemas.String }),
  // Server -> clients: a validated command rebroadcast in canonical order.
  commandRelayed: Schemas.Map({ seat: Schemas.Int, sender: Schemas.String, json: Schemas.String })
}

export const room = registerMessages(MpMessages)
