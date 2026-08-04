import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { Team } from './types'

// Procedurally "generated" mining robot built from primitives, so it needs no GLB
// or rigged animations. A small system drives hover-bob, tilt, and drill spin to
// mirror the worker animation clips (idle / walk / talk).

type RobotState = 'idle' | 'walk' | 'talk'

interface RobotRig {
  bodyRoot: Entity
  drillCollar: Entity
  parts: Entity[]
  state: RobotState
  time: number
}

const rigs = new Map<Entity, RobotRig>()

const METAL_DARK = Color4.create(0.16, 0.17, 0.2, 1)
const METAL_LIGHT = Color4.create(0.42, 0.44, 0.5, 1)
const DRILL_STEEL = Color4.create(0.55, 0.5, 0.42, 1)

const TEAM_HULL: Record<Team, Color4> = {
  player: Color4.create(0.22, 0.32, 0.45, 1),
  enemy: Color4.create(0.42, 0.2, 0.2, 1)
}

const TEAM_GLOW: Record<Team, Color4> = {
  player: Color4.create(0.2, 0.85, 0.95, 1),
  enemy: Color4.create(1, 0.3, 0.2, 1)
}

export function buildMinerRobot(root: Entity, team: Team): void {
  const hull = TEAM_HULL[team]
  const glow = TEAM_GLOW[team]

  const bodyRoot = engine.addEntity()
  Transform.create(bodyRoot, { parent: root })

  const parts: Entity[] = [bodyRoot]
  const addPart = (
    position: Vector3,
    scale: Vector3,
    color: Color4,
    options: { emissive?: Color4; emissiveIntensity?: number; cylinder?: boolean; cone?: boolean; rotation?: Quaternion } = {}
  ): Entity => {
    const part = engine.addEntity()
    Transform.create(part, {
      parent: bodyRoot,
      position,
      scale,
      rotation: options.rotation ?? Quaternion.Identity()
    })
    if (options.cone) MeshRenderer.setCylinder(part, 0.5, 0.03)
    else if (options.cylinder) MeshRenderer.setCylinder(part)
    else MeshRenderer.setBox(part)
    Material.setPbrMaterial(part, {
      albedoColor: color,
      emissiveColor: options.emissive ?? Color4.Black(),
      emissiveIntensity: options.emissiveIntensity ?? 0,
      metallic: 0.6,
      roughness: 0.4,
      castShadows: false
    })
    parts.push(part)
    return part
  }

  // Hover base with glow disc underneath.
  addPart(Vector3.create(0, 0.16, 0), Vector3.create(0.46, 0.05, 0.46), glow, { cylinder: true, emissive: glow, emissiveIntensity: 2.2 })
  addPart(Vector3.create(0, 0.32, 0), Vector3.create(0.56, 0.2, 0.56), METAL_DARK, { cylinder: true })

  // Torso with a glowing chest core.
  addPart(Vector3.create(0, 0.78, 0), Vector3.create(0.52, 0.55, 0.38), hull)
  addPart(Vector3.create(0, 0.84, 0.18), Vector3.create(0.14, 0.14, 0.05), glow, { emissive: glow, emissiveIntensity: 2 })

  // Head with visor and antenna.
  addPart(Vector3.create(0, 1.22, 0), Vector3.create(0.36, 0.26, 0.32), METAL_LIGHT)
  addPart(Vector3.create(0, 1.24, 0.15), Vector3.create(0.26, 0.07, 0.05), glow, { emissive: glow, emissiveIntensity: 2.6 })
  addPart(Vector3.create(0.12, 1.46, 0), Vector3.create(0.03, 0.2, 0.03), METAL_DARK)
  addPart(Vector3.create(0.12, 1.58, 0), Vector3.create(0.07, 0.07, 0.07), glow, { cylinder: true, emissive: glow, emissiveIntensity: 2.6 })

  // Left arm.
  addPart(Vector3.create(-0.34, 0.82, 0), Vector3.create(0.13, 0.42, 0.15), METAL_DARK)

  // Right arm is the mining rig: shoulder, housing, spinning collar, and drill cone.
  addPart(Vector3.create(0.34, 0.9, 0), Vector3.create(0.16, 0.22, 0.18), METAL_DARK)
  addPart(Vector3.create(0.34, 0.72, 0.1), Vector3.create(0.13, 0.13, 0.3), METAL_LIGHT)
  const drillCollar = addPart(Vector3.create(0.34, 0.72, 0.28), Vector3.create(0.18, 0.18, 0.08), hull, {
    emissive: glow,
    emissiveIntensity: 0.8
  })
  addPart(Vector3.create(0.34, 0.72, 0.5), Vector3.create(0.12, 0.34, 0.12), DRILL_STEEL, {
    cone: true,
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })

  rigs.set(root, { bodyRoot, drillCollar, parts, state: 'idle', time: Math.random() * 10 })
}

export function isRobot(root: Entity): boolean {
  return rigs.has(root)
}

/** Maps worker animation clips onto procedural motion: walk = fast bob, talk = mining drill spin. */
export function setRobotAnimation(root: Entity, clipName: string): void {
  const rig = rigs.get(root)
  if (!rig) return

  rig.state = clipName === 'walk' ? 'walk' : clipName === 'talk' ? 'talk' : 'idle'
}

/** Visibility doesn't cascade to children, so fog of war toggles every part. */
export function setRobotVisible(root: Entity, visible: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  for (const part of rig.parts) {
    VisibilityComponent.createOrReplace(part, { visible })
  }
}

/** Unregisters the rig; optionally removes the part entities (children aren't removed with their root). */
export function disposeRobot(root: Entity, removeParts: boolean): void {
  const rig = rigs.get(root)
  if (!rig) return

  if (removeParts) {
    for (const part of rig.parts) engine.removeEntity(part)
  }
  rigs.delete(root)
}

const BOB = {
  idle: { amplitude: 0.03, speed: 2, tilt: 0, drillSpeed: 0 },
  walk: { amplitude: 0.06, speed: 7, tilt: 6, drillSpeed: 90 },
  talk: { amplitude: 0.02, speed: 16, tilt: 14, drillSpeed: 720 }
}

function robotAnimationSystem(dt: number): void {
  for (const rig of rigs.values()) {
    rig.time += dt
    const profile = BOB[rig.state]

    const bodyTransform = Transform.getMutable(rig.bodyRoot)
    bodyTransform.position = Vector3.create(0, profile.amplitude * Math.sin(rig.time * profile.speed) + profile.amplitude, 0)
    bodyTransform.rotation = Quaternion.fromEulerDegrees(profile.tilt, 0, 0)

    if (profile.drillSpeed > 0) {
      const collarTransform = Transform.getMutable(rig.drillCollar)
      collarTransform.rotation = Quaternion.fromEulerDegrees(0, 0, (rig.time * profile.drillSpeed) % 360)
    }
  }
}

engine.addSystem(robotAnimationSystem)
