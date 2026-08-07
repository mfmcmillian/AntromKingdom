import { ColliderLayer, Material, MeshCollider, MeshRenderer, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'

// Same technique as The Long Silence's space enclosure: emissive textured panels
// boxing in the scene, so every sightline ends on painted forest/sky instead of
// the explorer's default horizon.

const WALL_HEIGHT = 90
const WALL_INSET = 0.2

export type EnvironmentTheme = 'moon' | 'ocean'

// Per-theme wall/ceiling art. Moon: lunar horizon whose regolith band matches
// the classic ground texture. Ocean: open sea meeting a clouded sky for the
// island map, with a plain sky overhead.
const THEMES: Record<EnvironmentTheme, { wall: string; ceiling: string; wallTint: Color3; wallIntensity: number }> = {
  moon: {
    wall: 'assets/textures/moon_horizon.png',
    ceiling: 'assets/textures/space_ceiling.png',
    // Slightly warm so the regolith band matches the sunlit ground tone.
    wallTint: Color3.create(1, 0.985, 0.95),
    wallIntensity: 1.3
  },
  ocean: {
    wall: 'assets/textures/ocean_horizon.png',
    ceiling: 'assets/textures/sky_ceiling.png',
    wallTint: Color3.create(1, 1, 1),
    wallIntensity: 1.15
  }
}

const wallEntities: Entity[] = []
let ceilingEntity: Entity | undefined
let activeTheme: EnvironmentTheme = 'moon'

export function buildEnvironmentEnclosure(): void {
  const size = SCENE.size
  const center = SCENE.center
  const wallMidY = WALL_HEIGHT / 2

  const panels: { pos: Vector3; rot: Quaternion; scale: Vector3; isWall: boolean }[] = [
    // Four walls, faces pointing into the map.
    {
      pos: Vector3.create(center, wallMidY, size - WALL_INSET),
      rot: Quaternion.fromEulerDegrees(0, 0, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      isWall: true
    },
    {
      pos: Vector3.create(center, wallMidY, WALL_INSET),
      rot: Quaternion.fromEulerDegrees(0, 180, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      isWall: true
    },
    {
      pos: Vector3.create(size - WALL_INSET, wallMidY, center),
      rot: Quaternion.fromEulerDegrees(0, 90, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      isWall: true
    },
    {
      pos: Vector3.create(WALL_INSET, wallMidY, center),
      rot: Quaternion.fromEulerDegrees(0, 270, 0),
      scale: Vector3.create(size, WALL_HEIGHT, 1),
      isWall: true
    },
    // Ceiling, face pointing down.
    {
      pos: Vector3.create(center, WALL_HEIGHT, center),
      rot: Quaternion.fromEulerDegrees(90, 0, 0),
      scale: Vector3.create(size, size, 1),
      isWall: false
    }
  ]

  for (const panel of panels) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: panel.pos, rotation: panel.rot, scale: panel.scale })
    MeshRenderer.setPlane(entity)
    if (panel.isWall) wallEntities.push(entity)
    else ceilingEntity = entity
  }

  applyEnvironmentTheme()
  buildBoundaryColliders()
}

/** Swap the horizon art (island maps show open sea, classic shows the moon). */
export function setEnvironmentTheme(theme: EnvironmentTheme): void {
  if (theme === activeTheme) return
  activeTheme = theme
  applyEnvironmentTheme()
}

function applyEnvironmentTheme(): void {
  const theme = THEMES[activeTheme]

  for (const wall of wallEntities) {
    Material.setPbrMaterial(wall, {
      // Emissive-only so the panels read as bright sky regardless of scene lighting.
      albedoColor: Color4.create(0, 0, 0, 1),
      emissiveTexture: Material.Texture.Common({ src: theme.wall }),
      emissiveColor: theme.wallTint,
      emissiveIntensity: theme.wallIntensity,
      metallic: 0,
      roughness: 1,
      castShadows: false
    })
  }

  if (ceilingEntity !== undefined) {
    Material.setPbrMaterial(ceilingEntity, {
      albedoColor: Color4.create(0, 0, 0, 1),
      emissiveTexture: Material.Texture.Common({ src: theme.ceiling }),
      emissiveColor: Color3.create(1, 1, 1),
      emissiveIntensity: 0.9,
      metallic: 0,
      roughness: 1,
      castShadows: false
    })
  }
}

/**
 * Invisible physics walls just inside the scene border. The horizon panels are
 * render-only, so without these an avatar can wander onto the neighbouring
 * parcel - at which point THAT scene activates and slaps its UI over our HUD.
 * Physics-only layer: bodies bounce off, but pointer rays (unit clicks, ground
 * orders near the edge) pass straight through.
 */
function buildBoundaryColliders(): void {
  const size = SCENE.size
  const center = SCENE.center
  const wallThickness = 2
  // Sunk below ground and taller than any terrain bump or jump arc.
  const wallBottom = -10
  const wallTop = WALL_HEIGHT
  const wallMidY = (wallBottom + wallTop) / 2
  const wallScaleY = wallTop - wallBottom
  const inset = wallThickness / 2 + 0.3

  const walls: { pos: Vector3; scale: Vector3 }[] = [
    { pos: Vector3.create(center, wallMidY, size - inset), scale: Vector3.create(size, wallScaleY, wallThickness) },
    { pos: Vector3.create(center, wallMidY, inset), scale: Vector3.create(size, wallScaleY, wallThickness) },
    { pos: Vector3.create(size - inset, wallMidY, center), scale: Vector3.create(wallThickness, wallScaleY, size) },
    { pos: Vector3.create(inset, wallMidY, center), scale: Vector3.create(wallThickness, wallScaleY, size) }
  ]

  for (const wall of walls) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: wall.pos, scale: wall.scale })
    MeshCollider.setBox(entity, ColliderLayer.CL_PHYSICS)
  }
}
