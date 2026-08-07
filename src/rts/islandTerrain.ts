import { Material, MeshRenderer, TextureWrapMode, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'
import type { IslandZone } from './maps'
import { setClassicTerrainVisible } from './terrain'

// ---------------------------------------------------------------------------
// Island-map terrain: hides the classic battlefield and paints a sky "floor"
// with floating rock islands on top. Everything stays paper-thin (the whole
// stack lives between y 0.02 and 0.17) because fog-of-war tiles sit at ~0.18
// and gameplay assumes a flat field.
// ---------------------------------------------------------------------------

const GROUND_TEXTURE = 'assets/textures/moon_ground.png'

const entities: Entity[] = []

let seed = 991177
function random(): number {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647
}

function spawn(): Entity {
  const entity = engine.addEntity()
  entities.push(entity)
  return entity
}

/** Build the sky + islands overlay for the given zones (match start). */
export function buildIslandTerrain(islands: IslandZone[]): void {
  clearIslandTerrain()
  setClassicTerrainVisible(false)
  seed = 991177

  createSkyFloor()
  createCloudLayer(islands)
  for (const island of islands) createIsland(island)
}

/** Tear the overlay down and bring the classic battlefield back. */
export function clearIslandTerrain(): void {
  for (const entity of entities) engine.removeEntity(entity)
  entities.length = 0
  setClassicTerrainVisible(true)
}

/** The void: a bright sky sheet covering the whole map under the islands. */
function createSkyFloor(): void {
  const sky = spawn()
  Transform.create(sky, {
    position: Vector3.create(SCENE.center, 0.02, SCENE.center),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0),
    scale: Vector3.create(SCENE.size, SCENE.size, 1)
  })
  MeshRenderer.setPlane(sky)
  Material.setPbrMaterial(sky, {
    albedoColor: Color4.create(0.36, 0.58, 0.85, 1),
    emissiveColor: Color4.create(0.22, 0.38, 0.6, 1),
    emissiveIntensity: 0.55,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })

  // A softer haze ring toward the middle so the sheet doesn't read as flat paint.
  const haze = spawn()
  Transform.create(haze, {
    position: Vector3.create(SCENE.center, 0.035, SCENE.center),
    scale: Vector3.create(SCENE.size * 0.7, 0.004, SCENE.size * 0.7)
  })
  MeshRenderer.setCylinder(haze)
  Material.setPbrMaterial(haze, {
    albedoColor: Color4.create(0.5, 0.7, 0.92, 1),
    emissiveColor: Color4.create(0.32, 0.48, 0.68, 1),
    emissiveIntensity: 0.4,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })
}

/** Flat white cloud puffs drifting in the void between the islands. */
function createCloudLayer(islands: IslandZone[]): void {
  const isInVoid = (x: number, z: number, clearance: number): boolean =>
    !islands.some((island) => {
      const dx = x - island.x
      const dz = z - island.z
      const reach = island.radius + clearance
      return dx * dx + dz * dz < reach * reach
    })

  let placed = 0
  let attempts = 0
  while (placed < 34 && attempts < 260) {
    attempts++
    const x = 4 + random() * (SCENE.size - 8)
    const z = 4 + random() * (SCENE.size - 8)
    const size = 3 + random() * 7
    if (!isInVoid(x, z, size * 0.5 + 1)) continue

    // Each puff is a cluster of 2-3 overlapping flat discs, so the shape
    // reads as a cloud from the top-down camera instead of a perfect circle.
    const discs = 2 + Math.floor(random() * 2)
    for (let i = 0; i < discs; i++) {
      const disc = spawn()
      const discSize = size * (0.55 + random() * 0.5)
      Transform.create(disc, {
        position: Vector3.create(x + (random() - 0.5) * size * 0.7, 0.08 + random() * 0.06, z + (random() - 0.5) * size * 0.7),
        scale: Vector3.create(discSize, 0.01, discSize * (0.6 + random() * 0.4))
      })
      MeshRenderer.setCylinder(disc)
      Material.setPbrMaterial(disc, {
        albedoColor: Color4.create(0.96, 0.98, 1, 1),
        emissiveColor: Color4.create(0.6, 0.64, 0.7, 1),
        emissiveIntensity: 0.35,
        metallic: 0,
        roughness: 1,
        specularIntensity: 0,
        castShadows: false
      })
    }
    placed++
  }
}

/** One floating island: dark cliff rim ring under a moon-rock surface disc. */
function createIsland(island: IslandZone): void {
  // Cliff rim: slightly wider and darker, peeking out under the surface.
  const rim = spawn()
  Transform.create(rim, {
    position: Vector3.create(island.x, 0.045, island.z),
    scale: Vector3.create(island.radius * 2 + 1.6, 0.012, island.radius * 2 + 1.6)
  })
  MeshRenderer.setCylinder(rim)
  Material.setPbrMaterial(rim, {
    albedoColor: Color4.create(0.16, 0.15, 0.19, 1),
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })

  // Surface: the same moon-rock texture as the classic map, so units and
  // buildings sit on familiar ground.
  const surface = spawn()
  Transform.create(surface, {
    position: Vector3.create(island.x, 0.06, island.z),
    scale: Vector3.create(island.radius * 2, 0.014, island.radius * 2)
  })
  MeshRenderer.setCylinder(surface)
  Material.setPbrMaterial(surface, {
    texture: Material.Texture.Common({ src: GROUND_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT }),
    albedoColor: Color4.create(0.9, 0.9, 0.96, 1),
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })

  // A couple of soft tone patches per island so the surface isn't uniform.
  const patches = 2 + Math.floor(random() * 2)
  for (let i = 0; i < patches; i++) {
    const patch = spawn()
    const patchSize = island.radius * (0.35 + random() * 0.4)
    const angle = random() * Math.PI * 2
    const reach = random() * (island.radius - patchSize * 0.6)
    Transform.create(patch, {
      position: Vector3.create(island.x + Math.cos(angle) * reach, 0.075 + i * 0.004, island.z + Math.sin(angle) * reach),
      scale: Vector3.create(patchSize, 0.008, patchSize)
    })
    MeshRenderer.setCylinder(patch)
    Material.setPbrMaterial(patch, {
      albedoColor: random() < 0.5 ? Color4.create(0.78, 0.78, 0.85, 1) : Color4.create(0.95, 0.93, 0.9, 1),
      metallic: 0,
      roughness: 1,
      specularIntensity: 0,
      castShadows: false
    })
  }
}
