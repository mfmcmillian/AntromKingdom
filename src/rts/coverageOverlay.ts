import { Entity, Material, MaterialTransparencyMode, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'

// Ground disc + edge ring for selected utility buildings (Beacon vision,
// Obelisk haste, Spore Mound poison). No collider: it must not steal clicks.

const HIDDEN = Vector3.create(0, -20, 0)
const FILL_Y = 0.14
const RING_Y = 0.19
const RING_TEXTURE_FILL = 1 / 0.875

export type CoverageTarget = {
  position: Vector3
  radius: number
  color: Color4
}

let fillEntity: Entity | undefined
let ringEntity: Entity | undefined
let lastColor: Color4 | undefined

/** Show or hide the coverage disc. Call every frame from the match loop. */
export function updateCoverageOverlay(target: CoverageTarget | undefined): void {
  ensureOverlay()
  if (!fillEntity || !ringEntity) return

  if (!target) {
    Transform.getMutable(fillEntity).position = HIDDEN
    Transform.getMutable(ringEntity).position = HIDDEN
    return
  }

  const diameter = target.radius * 2
  const fill = Transform.getMutable(fillEntity)
  fill.position = Vector3.create(target.position.x, FILL_Y, target.position.z)
  fill.scale = Vector3.create(diameter, 0.05, diameter)

  const ring = Transform.getMutable(ringEntity)
  const ringSize = diameter * RING_TEXTURE_FILL
  ring.position = Vector3.create(target.position.x, RING_Y, target.position.z)
  ring.scale = Vector3.create(ringSize, ringSize, 1)

  tintOverlay(target.color)
}

export function clearCoverageOverlay(): void {
  updateCoverageOverlay(undefined)
}

function ensureOverlay(): void {
  if (fillEntity && ringEntity) return

  fillEntity = engine.addEntity()
  Transform.create(fillEntity, { position: HIDDEN })
  MeshRenderer.setCylinder(fillEntity)

  ringEntity = engine.addEntity()
  Transform.create(ringEntity, { position: HIDDEN, rotation: Quaternion.fromEulerDegrees(90, 0, 0) })
  MeshRenderer.setPlane(ringEntity)

  lastColor = undefined
}

function tintOverlay(color: Color4): void {
  if (lastColor && lastColor.r === color.r && lastColor.g === color.g && lastColor.b === color.b) return
  lastColor = color
  if (!fillEntity || !ringEntity) return

  Material.setPbrMaterial(fillEntity, {
    albedoColor: Color4.create(color.r, color.g, color.b, 0.16),
    emissiveColor: color,
    emissiveIntensity: 0.55,
    metallic: 0,
    roughness: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
  Material.setPbrMaterial(ringEntity, {
    texture: Material.Texture.Common({ src: 'images/selection-ring.png' }),
    alphaTexture: Material.Texture.Common({ src: 'images/selection-ring.png' }),
    albedoColor: Color4.create(color.r, color.g, color.b, 0.95),
    emissiveColor: color,
    emissiveIntensity: 1.8,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false
  })
}
