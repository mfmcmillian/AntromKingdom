import { Material, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'

// Same technique as The Long Silence's space enclosure: emissive textured panels
// boxing in the scene, so every sightline ends on painted forest/sky instead of
// the explorer's default horizon.

const WALL_HEIGHT = 90
const WALL_INSET = 0.2
// Walls show a lunar horizon (regolith foreground -> distant mountains -> stars)
// whose bottom tone matches the ground texture, so the map reads as one moon
// that keeps going past the playable edge instead of a floor boxed in by space.
const HORIZON_TEXTURE = 'assets/textures/moon_horizon.png'
const CEILING_TEXTURE = 'assets/textures/space_ceiling.png'

export function buildEnvironmentEnclosure(): void {
  const size = SCENE.size
  const center = SCENE.center
  const wallMidY = WALL_HEIGHT / 2

  const panels: { pos: Vector3; rot: Quaternion; scale: Vector3; src: string }[] = [
    // Four walls, faces pointing into the map.
    {
      pos: Vector3.create(center, wallMidY, size - WALL_INSET),
      rot: Quaternion.fromEulerDegrees(0, 0, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      src: HORIZON_TEXTURE
    },
    {
      pos: Vector3.create(center, wallMidY, WALL_INSET),
      rot: Quaternion.fromEulerDegrees(0, 180, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      src: HORIZON_TEXTURE
    },
    {
      pos: Vector3.create(size - WALL_INSET, wallMidY, center),
      rot: Quaternion.fromEulerDegrees(0, 90, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      src: HORIZON_TEXTURE
    },
    {
      pos: Vector3.create(WALL_INSET, wallMidY, center),
      rot: Quaternion.fromEulerDegrees(0, 270, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      src: HORIZON_TEXTURE
    },
    // Ceiling, face pointing down.
    {
      pos: Vector3.create(center, WALL_HEIGHT, center),
      rot: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(size, size, 1),
      src: CEILING_TEXTURE
    }
  ]

  for (const panel of panels) {
    const entity = engine.addEntity()
    const isWall = panel.src === HORIZON_TEXTURE
    Transform.create(entity, { position: panel.pos, rotation: panel.rot, scale: panel.scale })
    MeshRenderer.setPlane(entity)
    Material.setPbrMaterial(entity, {
      // Emissive-only so the panels read as bright sky regardless of scene lighting.
      // Walls run brighter and slightly warm so their regolith band matches the
      // tone of the sunlit ground texture instead of reading as a darker cliff.
      albedoColor: Color4.create(0, 0, 0, 1),
      emissiveTexture: Material.Texture.Common({ src: panel.src }),
      emissiveColor: isWall ? Color3.create(1, 0.985, 0.95) : Color3.create(1, 1, 1),
      emissiveIntensity: isWall ? 1.3 : 0.9,
      metallic: 0,
      roughness: 1,
      castShadows: false
    })
  }
}
