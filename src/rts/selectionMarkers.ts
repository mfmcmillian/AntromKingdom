import { Entity, Material, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { COLORS } from './config'

export type SelectionMarkerTarget = {
  position: Vector3
  diameter: number
}

const RING_SEGMENTS = 8
const SEGMENT_SIZE = 0.14
const MARKER_Y = 0.08
const SPIN_DEGREES_PER_SECOND = 45
const HIDDEN_POSITION = Vector3.create(0, -20, 0)

const markerPool: Entity[] = []
let activeMarkerCount = 0
let spinAngle = 0

/** Reposition the pool of ring markers under the given targets. Call every frame. */
export function updateSelectionMarkers(targets: SelectionMarkerTarget[]): void {
  for (let i = 0; i < targets.length; i++) {
    const marker = getOrCreateMarker(i)
    const transform = Transform.getMutable(marker)
    transform.position = Vector3.create(targets[i].position.x, MARKER_Y, targets[i].position.z)
    transform.scale = Vector3.create(targets[i].diameter, 1, targets[i].diameter)
    transform.rotation = Quaternion.fromEulerDegrees(0, spinAngle, 0)
  }

  for (let i = targets.length; i < activeMarkerCount; i++) {
    Transform.getMutable(markerPool[i]).position = HIDDEN_POSITION
  }
  activeMarkerCount = targets.length
}

export function clearSelectionMarkers(): void {
  updateSelectionMarkers([])
}

function getOrCreateMarker(index: number): Entity {
  while (markerPool.length <= index) {
    markerPool.push(createRingMarker())
  }
  return markerPool[index]
}

function createRingMarker(): Entity {
  const root = engine.addEntity()
  Transform.create(root, { position: HIDDEN_POSITION })

  for (let i = 0; i < RING_SEGMENTS; i++) {
    const angle = (i / RING_SEGMENTS) * Math.PI * 2
    const segment = engine.addEntity()
    Transform.create(segment, {
      parent: root,
      // Radius 0.5 so the root's scale equals the ring's diameter.
      position: Vector3.create(Math.cos(angle) * 0.5, 0, Math.sin(angle) * 0.5),
      rotation: Quaternion.fromEulerDegrees(0, -(angle * 180) / Math.PI, 0),
      scale: Vector3.create(SEGMENT_SIZE, 0.045, SEGMENT_SIZE * 2)
    })
    MeshRenderer.setBox(segment)
    Material.setPbrMaterial(segment, {
      albedoColor: COLORS.selected,
      emissiveColor: COLORS.selected,
      emissiveIntensity: 2.4
    })
  }

  return root
}

function spinSelectionMarkersSystem(dt: number): void {
  spinAngle = (spinAngle + dt * SPIN_DEGREES_PER_SECOND) % 360
}

engine.addSystem(spinSelectionMarkersSystem)
