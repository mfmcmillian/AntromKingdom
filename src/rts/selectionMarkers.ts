import { Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { COLORS } from './config'

// StarCraft-style selection circle: one flat plane per selected unit carrying
// a crisp ring texture (thin circle + dash accents + soft glow), tinted by
// relationship and slowly rotating so the dashes give it life.

export type SelectionMarkerTarget = {
  position: Vector3
  diameter: number
  /** Relationship color: green own, yellow ally, red enemy. */
  color?: Color4
}

const MARKER_Y = 0.06
const SPIN_DEGREES_PER_SECOND = 30
const HIDDEN_POSITION = Vector3.create(0, -20, 0)
// The ring artwork spans ~87% of the texture; overscale so the painted circle
// matches the requested diameter.
const TEXTURE_FILL = 1 / 0.875

type Marker = { entity: Entity; color: Color4 }

const markerPool: Marker[] = []
let activeMarkerCount = 0
let spinAngle = 0

/** Reposition the pool of ring markers under the given targets. Call every frame. */
export function updateSelectionMarkers(targets: SelectionMarkerTarget[]): void {
  for (let i = 0; i < targets.length; i++) {
    const marker = getOrCreateMarker(i)
    const size = targets[i].diameter * TEXTURE_FILL
    const transform = Transform.getMutable(marker.entity)
    transform.position = Vector3.create(targets[i].position.x, MARKER_Y, targets[i].position.z)
    transform.scale = Vector3.create(size, size, 1)
    transform.rotation = Quaternion.fromEulerDegrees(90, spinAngle, 0)
    tintMarker(marker, targets[i].color ?? COLORS.selected)
  }

  for (let i = targets.length; i < activeMarkerCount; i++) {
    Transform.getMutable(markerPool[i].entity).position = HIDDEN_POSITION
  }
  activeMarkerCount = targets.length
}

export function clearSelectionMarkers(): void {
  updateSelectionMarkers([])
}

function getOrCreateMarker(index: number): Marker {
  while (markerPool.length <= index) {
    markerPool.push(createRingMarker())
  }
  return markerPool[index]
}

/** Re-tints the marker when it gets recycled onto a different team's unit. */
function tintMarker(marker: Marker, color: Color4): void {
  if (marker.color.r === color.r && marker.color.g === color.g && marker.color.b === color.b) return
  marker.color = color
  applyMarkerMaterial(marker.entity, color)
}

function applyMarkerMaterial(entity: Entity, color: Color4): void {
  Material.setPbrMaterial(entity, {
    texture: Material.Texture.Common({ src: 'images/selection-ring.png' }),
    alphaTexture: Material.Texture.Common({ src: 'images/selection-ring.png' }),
    albedoColor: Color4.create(color.r, color.g, color.b, 0.9),
    emissiveColor: color,
    emissiveIntensity: 1.6,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
}

function createRingMarker(): Marker {
  const entity = engine.addEntity()
  Transform.create(entity, { position: HIDDEN_POSITION })
  MeshRenderer.setPlane(entity)
  applyMarkerMaterial(entity, COLORS.selected)
  return { entity, color: COLORS.selected }
}

function spinSelectionMarkersSystem(dt: number): void {
  spinAngle = (spinAngle + dt * SPIN_DEGREES_PER_SECOND) % 360
}

engine.addSystem(spinSelectionMarkersSystem)
