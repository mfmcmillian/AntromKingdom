import { Material, MeshRenderer, TextureWrapMode, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'
import { setEnvironmentTheme } from './environment'
import type { IslandZone } from './maps'
import { setClassicTerrainVisible } from './terrain'

// ---------------------------------------------------------------------------
// Island-map terrain: hides the classic battlefield and paints an ocean
// "floor" with grassy islands on top. Everything stays paper-thin (the whole
// stack lives between y 0.02 and 0.17) because fog-of-war tiles sit at ~0.18
// and gameplay assumes a flat field.
// ---------------------------------------------------------------------------

const WATER_TEXTURE = 'assets/textures/water_surface.png'
const GRASS_TEXTURE = 'assets/textures/grass_ground.png'

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

/** Build the ocean + islands overlay for the given zones (match start). */
export function buildIslandTerrain(islands: IslandZone[]): void {
  clearIslandTerrain()
  setClassicTerrainVisible(false)
  setEnvironmentTheme('ocean')
  seed = 991177

  createOceanFloor()
  createWaveLayer(islands)
  for (const island of islands) createIsland(island)
}

/** Tear the overlay down and bring the classic battlefield back. */
export function clearIslandTerrain(): void {
  for (const entity of entities) engine.removeEntity(entity)
  entities.length = 0
  setClassicTerrainVisible(true)
  setEnvironmentTheme('moon')
}

/** The sea: a water sheet covering the whole map under the islands. */
function createOceanFloor(): void {
  // 2x2 grid of textured tiles so the ripples stay crisp across 160m.
  const half = SCENE.size / 2
  for (const ox of [0, 1]) {
    for (const oz of [0, 1]) {
      const tile = spawn()
      Transform.create(tile, {
        position: Vector3.create(half / 2 + ox * half, 0.02, half / 2 + oz * half),
        rotation: Quaternion.fromEulerDegrees(90, 0, 0),
        scale: Vector3.create(half, half, 1)
      })
      MeshRenderer.setPlane(tile)
      Material.setPbrMaterial(tile, {
        texture: Material.Texture.Common({ src: WATER_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT }),
        // A touch of self-glow keeps the sea bright and readable from above.
        emissiveTexture: Material.Texture.Common({ src: WATER_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT }),
        albedoColor: Color4.create(0.85, 0.9, 1, 1),
        emissiveColor: Color4.create(0.55, 0.7, 0.9, 1),
        emissiveIntensity: 0.45,
        metallic: 0,
        roughness: 0.6,
        specularIntensity: 0.3,
        castShadows: false
      })
    }
  }
}

/** Foam flecks and lighter current patches drifting on the open water. */
function createWaveLayer(islands: IslandZone[]): void {
  const isInWater = (x: number, z: number, clearance: number): boolean =>
    !islands.some((island) => {
      const dx = x - island.x
      const dz = z - island.z
      const reach = island.radius + clearance
      return dx * dx + dz * dz < reach * reach
    })

  // A few large translucent current patches for tonal depth.
  let patches = 0
  let attempts = 0
  while (patches < 8 && attempts < 120) {
    attempts++
    const x = 6 + random() * (SCENE.size - 12)
    const z = 6 + random() * (SCENE.size - 12)
    const size = 8 + random() * 12
    if (!isInWater(x, z, size * 0.4)) continue

    const patch = spawn()
    const shallow = random() < 0.5
    Transform.create(patch, {
      position: Vector3.create(x, 0.05, z),
      scale: Vector3.create(size, 0.006, size * (0.5 + random() * 0.4))
    })
    MeshRenderer.setCylinder(patch)
    Material.setPbrMaterial(patch, {
      albedoColor: shallow ? Color4.create(0.35, 0.75, 0.85, 0.2) : Color4.create(0.1, 0.3, 0.6, 0.18),
      emissiveColor: shallow ? Color4.create(0.4, 0.8, 0.9, 1) : Color4.create(0.15, 0.35, 0.65, 1),
      emissiveIntensity: 0.35,
      metallic: 0,
      roughness: 1,
      specularIntensity: 0,
      castShadows: false
    })
    patches++
  }

  // Whitecap foam flecks scattered across the water between the islands.
  let flecks = 0
  attempts = 0
  while (flecks < 46 && attempts < 320) {
    attempts++
    const x = 3 + random() * (SCENE.size - 6)
    const z = 3 + random() * (SCENE.size - 6)
    if (!isInWater(x, z, 1.5)) continue

    const foam = spawn()
    const size = 0.25 + random() * 0.6
    Transform.create(foam, {
      position: Vector3.create(x, 0.07, z),
      scale: Vector3.create(size, 0.004, size * (0.4 + random() * 0.35))
    })
    MeshRenderer.setCylinder(foam)
    Material.setPbrMaterial(foam, {
      albedoColor: Color4.create(0.95, 0.98, 1, 0.85),
      emissiveColor: Color4.create(0.9, 0.95, 1, 1),
      emissiveIntensity: 0.7,
      metallic: 0,
      roughness: 1,
      specularIntensity: 0,
      castShadows: false
    })
    flecks++
  }
}

/** One island: sandy beach ring under a grassy surface disc. */
function createIsland(island: IslandZone): void {
  // Beach rim: pale sand peeking out under the grass, meeting the water.
  const rim = spawn()
  Transform.create(rim, {
    position: Vector3.create(island.x, 0.045, island.z),
    scale: Vector3.create(island.radius * 2 + 1.6, 0.012, island.radius * 2 + 1.6)
  })
  MeshRenderer.setCylinder(rim)
  Material.setPbrMaterial(rim, {
    albedoColor: Color4.create(0.82, 0.72, 0.5, 1),
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })

  // Surface: lush grass so the isles read as living land against the sea.
  const surface = spawn()
  Transform.create(surface, {
    position: Vector3.create(island.x, 0.06, island.z),
    scale: Vector3.create(island.radius * 2, 0.014, island.radius * 2)
  })
  MeshRenderer.setCylinder(surface)
  Material.setPbrMaterial(surface, {
    texture: Material.Texture.Common({ src: GRASS_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT }),
    albedoColor: Color4.create(0.95, 1, 0.9, 1),
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })

  // A couple of soft meadow patches per island so the grass isn't uniform.
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
      albedoColor: random() < 0.5 ? Color4.create(0.5, 0.72, 0.32, 0.55) : Color4.create(0.72, 0.82, 0.42, 0.45),
      metallic: 0,
      roughness: 1,
      specularIntensity: 0,
      castShadows: false
    })
  }
}
