import { Client, Room } from 'colyseus'
import { BuildingState, PlayerState, RtsState, type MatchResult, type Team } from '../schema/RtsState.js'

const MAX_PLAYERS = 2
const MATCH_TICK_MS = 100
const PLAYER_1_TEMPLE = { x: 8.54, y: 5, z: 3.48 }
const PLAYER_2_TEMPLE = { x: 142.89, y: 5, z: 136.75 }

type ClientCommand =
  | { type: 'startMatch' }
  | { type: 'endMatch' }
  | { type: 'ping' }

export class RtsRoom extends Room<{ state: RtsState }> {
  maxClients = MAX_PLAYERS

  onCreate(): void {
    this.setState(new RtsState())
    this.createStartingTemples()
    this.setSimulationInterval((dt) => this.update(dt / 1000), MATCH_TICK_MS)

    this.onMessage('command', (client, command: ClientCommand) => {
      this.handleCommand(client, command)
    })
  }

  onJoin(client: Client, options?: { name?: string }): void {
    const team = this.getOpenTeam()
    const player = new PlayerState()
    player.sessionId = client.sessionId
    player.team = team
    player.name = options?.name || `Player ${team === 'player1' ? '1' : '2'}`
    this.state.players.set(client.sessionId, player)

    if (this.state.players.size === MAX_PLAYERS && this.state.status === 'waiting') {
      this.startMatch()
    }
  }

  onLeave(client: Client): void {
    const player = this.state.players.get(client.sessionId)
    if (!player) return

    player.connected = false
  }

  private update(dt: number): void {
    if (this.state.status !== 'active') return

    this.state.matchTime += dt
  }

  private handleCommand(client: Client, command: ClientCommand): void {
    const player = this.state.players.get(client.sessionId)
    if (!player) return

    if (command.type === 'startMatch') {
      this.startMatch()
      return
    }

    if (command.type === 'endMatch') {
      this.endMatch(player.team === 'player1' ? 'player2Win' : 'player1Win')
      return
    }
  }

  private startMatch(): void {
    if (this.state.status === 'active') return

    this.state.status = 'active'
    this.state.result = 'none'
    this.state.matchTime = 0
  }

  private endMatch(result: MatchResult): void {
    if (this.state.status === 'ended') return

    this.state.status = 'ended'
    this.state.result = result
  }

  private getOpenTeam(): Team {
    const teams = Array.from(this.state.players.values() as Iterable<PlayerState>).map((player) => player.team)
    return teams.includes('player1') ? 'player2' : 'player1'
  }

  private createStartingTemples(): void {
    this.state.buildings.push(this.createTemple('temple-player-1', 'player1', PLAYER_1_TEMPLE))
    this.state.buildings.push(this.createTemple('temple-player-2', 'player2', PLAYER_2_TEMPLE))
  }

  private createTemple(id: string, team: Team, position: { x: number; y: number; z: number }): BuildingState {
    const temple = new BuildingState()
    temple.id = id
    temple.team = team
    temple.kind = 'temple'
    temple.position.set(position.x, position.y, position.z)
    return temple
  }
}
