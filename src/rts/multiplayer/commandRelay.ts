import { room } from './transport'
import type { MatchCommand } from './protocol'
import type { LocalMatchPlan } from './seatMap'
import type { Team } from '../types'

// In-match command relay (client side). Commands go to the authoritative
// server, which validates seat ownership and rebroadcasts them to every
// client in one canonical order. Local commands apply to the local sim
// immediately; the server echo is skipped for the sender. Remote commands
// are translated seat -> local team through the match plan and handed to the
// game layer.

let plan: LocalMatchPlan | undefined
let myAddress = ''

/** The game layer registers this to apply remote commands to its sim. */
type CommandApplier = (team: Team, command: MatchCommand) => void
let applier: CommandApplier | undefined

let listening = false

export function startCommandRelay(matchPlan: LocalMatchPlan, address: string, apply: CommandApplier): void {
  plan = matchPlan
  myAddress = address.toLowerCase()
  applier = apply
  if (listening) return
  listening = true

  room.onMessage('commandRelayed', (data) => {
    if (!plan || !applier) return
    if (data.lobbyId !== plan.lobbyId) return // another room's match; not ours
    if (data.sender.toLowerCase() === myAddress) return // we already applied it locally
    const team = plan.seatToTeam[data.seat]
    if (!team || team === 'player') return
    try {
      const command = JSON.parse(data.json) as MatchCommand
      applier(team, command)
    } catch {
      // Malformed payload; server should have filtered this.
    }
  })
}

export function stopCommandRelay(): void {
  plan = undefined
  applier = undefined
}

/** Broadcast a command for a seat we control (our own, or an AI seat if leader). */
export function broadcastCommand(seatIndex: number, command: MatchCommand): void {
  if (!plan) return
  room.send('matchCommand', { lobbyId: plan.lobbyId, seat: seatIndex, json: JSON.stringify(command) })
}

/** Convenience: broadcast a command issued by the local player. */
export function broadcastMyCommand(command: MatchCommand): void {
  if (!plan) return
  broadcastCommand(plan.mySeatIndex, command)
}

export function isRelayActive(): boolean {
  return plan !== undefined
}
