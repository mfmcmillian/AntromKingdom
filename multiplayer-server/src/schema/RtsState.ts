import { ArraySchema, MapSchema, Schema, type } from '@colyseus/schema'

export type Team = 'player1' | 'player2'
export type MatchStatus = 'waiting' | 'active' | 'ended'
export type MatchResult = 'none' | 'player1Win' | 'player2Win'

export class Vec3State extends Schema {
  @type('number') x = 0
  @type('number') y = 0
  @type('number') z = 0

  set(x: number, y: number, z: number): this {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
}

export class ResourceBagState extends Schema {
  @type('number') rocks = 50
  @type('number') wood = 0
  @type('number') meat = 0
}

export class PlayerState extends Schema {
  @type('string') sessionId = ''
  @type('string') team: Team = 'player1'
  @type('string') name = ''
  @type('boolean') connected = true
  @type(ResourceBagState) resources = new ResourceBagState()
  @type('number') supplyUsed = 5
  @type('number') supplyCap = 5
  @type('number') unitsProduced = 5
  @type('number') unitsKilled = 0
  @type('number') resourcesGathered = 0
}

export class BuildingState extends Schema {
  @type('string') id = ''
  @type('string') team: Team = 'player1'
  @type('string') kind = 'temple'
  @type(Vec3State) position = new Vec3State()
  @type('number') hp = 400
  @type('number') maxHp = 400
  @type('boolean') complete = true
}

export class RtsState extends Schema {
  @type('string') status: MatchStatus = 'waiting'
  @type('string') result: MatchResult = 'none'
  @type('number') matchTime = 0
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>()
  @type([BuildingState]) buildings = new ArraySchema<BuildingState>()
}
