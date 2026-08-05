import { MessageBus } from '@dcl/sdk/message-bus'
import { BUS_TOPIC_COMMAND, PROTOCOL_VERSION, type CommandEnvelope, type MatchCommand } from './protocol'
import type { LocalMatchPlan } from './seatMap'
import type { Team } from '../types'

// In-match command relay. Local commands apply to the local sim immediately
// AND go out on the bus tagged with our seat; remote commands come in tagged
// with the sender's seat, get translated to a local team through the match
// plan, and are handed to the game layer to apply. The host additionally
// broadcasts its AI decisions for computer seats through the same pipe.

const bus = new MessageBus()

let plan: LocalMatchPlan | undefined
let myAddress = ''
let seq = 0

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

  bus.on(BUS_TOPIC_COMMAND, (data: CommandEnvelope) => {
    if (data.protocol !== PROTOCOL_VERSION) return
    if (data.sender.toLowerCase() === myAddress) return // our own echo
    if (!plan || !applier) return
    const team = plan.seatToTeam[data.seat]
    if (!team || team === 'player') return // unknown seat or spoofed self-command
    applier(team, data.command)
  })
}

export function stopCommandRelay(): void {
  plan = undefined
  applier = undefined
}

/** Broadcast a command for a seat we control (our own, or an AI seat if host). */
export function broadcastCommand(seatIndex: number, command: MatchCommand): void {
  if (!plan) return
  const envelope: CommandEnvelope = {
    protocol: PROTOCOL_VERSION,
    seat: seatIndex,
    sender: myAddress,
    seq: seq++,
    command
  }
  bus.emit(BUS_TOPIC_COMMAND, envelope)
}

/** Convenience: broadcast a command issued by the local player. */
export function broadcastMyCommand(command: MatchCommand): void {
  if (!plan) return
  broadcastCommand(plan.mySeatIndex, command)
}

export function isRelayActive(): boolean {
  return plan !== undefined
}
