import { Entity, Material, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const DURATION = 1.1
const START_SCALE = 2.4
const END_SCALE = 0.5
// Above the flat fog tiles, below unit feet.
const MARKER_Y = 0.2
const HIDDEN_POSITION = Vector3.create(0, -10, 0)
const MARKER_COLOR = Color4.create(0.2, 1, 0.35, 0.75)

let marker: Entity | null = null
let timer = 0
let target = { x: 0, z: 0 }

/** Flash a shrinking green disc on the ground where units were ordered to go. */
export function showMoveMarker(position: { x: number; z: number }): void {
  getOrCreateMarker()
  target = { x: position.x, z: position.z }
  timer = DURATION
}

function getOrCreateMarker(): Entity {
  if (marker) return marker

  marker = engine.addEntity()
  Transform.create(marker, {
    position: HIDDEN_POSITION,
    scale: Vector3.create(START_SCALE, 0.04, START_SCALE)
  })
  MeshRenderer.setCylinder(marker)
  Material.setPbrMaterial(marker, {
    albedoColor: MARKER_COLOR,
    emissiveColor: MARKER_COLOR,
    emissiveIntensity: 1.6,
    transparencyMode: 2,
    castShadows: false
  })
  return marker
}

function moveMarkerSystem(dt: number): void {
  if (!marker || timer <= 0) return

  timer = Math.max(0, timer - dt)
  const transform = Transform.getMutable(marker)

  if (timer === 0) {
    transform.position = HIDDEN_POSITION
    return
  }

  const progress = 1 - timer / DURATION
  const scale = START_SCALE + (END_SCALE - START_SCALE) * progress
  transform.position = Vector3.create(target.x, MARKER_Y, target.z)
  transform.scale = Vector3.create(scale, 0.04, scale)
}

engine.addSystem(moveMarkerSystem)
