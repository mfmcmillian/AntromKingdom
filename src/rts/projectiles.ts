import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { isPlayerAlly } from './state'
import type { Team } from './types'

// Fast glowing bolts fired by ranged units. Pooled so combat never allocates
// entities mid-fight; a bolt flies from muzzle to target and hides on arrival.

const BOLT_SPEED = 22
const BOLT_HEIGHT = 0.85

type Bolt = {
  entity: Entity
  from: Vector3
  to: Vector3
  progress: number
  duration: number
  active: boolean
}

const bolts: Bolt[] = []

const TEAM_BOLT_COLORS: Record<Team, Color4> = {
  player: Color4.create(0.3, 0.9, 1, 1),
  enemy1: Color4.create(1, 0.35, 0.2, 1),
  enemy2: Color4.create(1, 0.62, 0.15, 1),
  enemy3: Color4.create(0.85, 0.3, 0.95, 1)
}
const ALLY_BOLT_COLOR = Color4.create(0.98, 0.85, 0.35, 1)

function getBoltColor(team: Team): Color4 {
  return isPlayerAlly(team) ? ALLY_BOLT_COLOR : TEAM_BOLT_COLORS[team]
}

export function fireProjectile(from: Vector3, to: Vector3, team: Team): void {
  const bolt = bolts.find((candidate) => !candidate.active) ?? createBolt()
  const start = Vector3.create(from.x, from.y + BOLT_HEIGHT, from.z)
  const end = Vector3.create(to.x, to.y + BOLT_HEIGHT * 0.8, to.z)
  const distance = Vector3.distance(start, end)

  bolt.from = start
  bolt.to = end
  bolt.progress = 0
  bolt.duration = Math.max(0.05, distance / BOLT_SPEED)
  bolt.active = true

  Transform.getMutable(bolt.entity).position = start
  const color = getBoltColor(team)
  Material.setPbrMaterial(bolt.entity, {
    albedoColor: color,
    emissiveColor: color,
    emissiveIntensity: 3,
    metallic: 0,
    roughness: 0.3,
    castShadows: false
  })
  VisibilityComponent.createOrReplace(bolt.entity, { visible: true })
}

function createBolt(): Bolt {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(0, -10, 0),
    scale: Vector3.create(0.09, 0.09, 0.28)
  })
  MeshRenderer.setBox(entity)
  VisibilityComponent.create(entity, { visible: false })

  const bolt: Bolt = { entity, from: Vector3.Zero(), to: Vector3.Zero(), progress: 0, duration: 0.1, active: false }
  bolts.push(bolt)
  return bolt
}

function projectileSystem(dt: number): void {
  for (const bolt of bolts) {
    if (!bolt.active) continue

    bolt.progress += dt / bolt.duration
    if (bolt.progress >= 1) {
      bolt.active = false
      VisibilityComponent.createOrReplace(bolt.entity, { visible: false })
      continue
    }

    Transform.getMutable(bolt.entity).position = Vector3.lerp(bolt.from, bolt.to, bolt.progress)
  }
}

engine.addSystem(projectileSystem)
