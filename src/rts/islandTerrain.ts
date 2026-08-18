import { Material, MeshRenderer, TextureWrapMode, Transform, engine, type Entity } from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { SCENE } from './config'
import { setEnvironmentTheme } from './environment'
import { islandHalfX, islandHalfZ, type IslandZone, type MapDefinition, type MapVisuals } from './maps'
import { setClassicGroundTexture, setClassicTerrainVisible } from './terrain'

// ---------------------------------------------------------------------------
// Island-map terrain: hides the classic battlefield and paints an ocean
// "floor" with grassy islands on top. Everything stays paper-thin (the whole
// stack lives between y 0.02 and 0.17) because fog-of-war tiles sit at ~0.18
// and gameplay assumes a flat field.
// ---------------------------------------------------------------------------

const DEFAULT_WATER = 'assets/textures/water_surface.png'
const DEFAULT_GROUND = 'assets/textures/grass_ground.png'
const DEFAULT_MOON_GROUND = 'assets/textures/moon_ground.png'

type IslandPalette = {
  theme: NonNullable<MapVisuals['theme']>
  ground: string
  water: string
  rim: Color4
  surfaceTint: Color4
  meadowA: Color4
  meadowB: Color4
  waterAlbedo: Color4
  waterEmissive: Color4
  waterGlow: number
  skipWaves?: boolean
}

const OCEAN_PALETTE: IslandPalette = {
  theme: 'ocean',
  ground: DEFAULT_GROUND,
  water: DEFAULT_WATER,
  rim: Color4.create(0.82, 0.72, 0.5, 1),
  surfaceTint: Color4.create(0.95, 1, 0.9, 1),
  meadowA: Color4.create(0.5, 0.72, 0.32, 0.55),
  meadowB: Color4.create(0.72, 0.82, 0.42, 0.45),
  waterAlbedo: Color4.create(0.85, 0.9, 1, 1),
  waterEmissive: Color4.create(0.55, 0.7, 0.9, 1),
  waterGlow: 0.45
}

const ASHEN_PALETTE: IslandPalette = {
  theme: 'ashen',
  ground: 'assets/textures/ashen_ground.png',
  water: 'assets/textures/ashen_water.png',
  rim: Color4.create(0.28, 0.24, 0.2, 1),
  surfaceTint: Color4.create(0.92, 0.88, 0.82, 1),
  meadowA: Color4.create(0.35, 0.28, 0.2, 0.45),
  meadowB: Color4.create(0.48, 0.38, 0.26, 0.4),
  waterAlbedo: Color4.create(0.55, 0.52, 0.5, 1),
  waterEmissive: Color4.create(0.28, 0.3, 0.32, 1),
  waterGlow: 0.35
}

const INFERNO_PALETTE: IslandPalette = {
  theme: 'inferno',
  ground: 'assets/textures/blackstone_ground.png',
  water: 'assets/textures/lava_water.png',
  rim: Color4.create(0.12, 0.08, 0.06, 1),
  surfaceTint: Color4.create(0.88, 0.86, 0.84, 1),
  meadowA: Color4.create(0.55, 0.16, 0.05, 0.4),
  meadowB: Color4.create(0.18, 0.1, 0.08, 0.45),
  waterAlbedo: Color4.create(1, 0.85, 0.55, 1),
  waterEmissive: Color4.create(1, 0.45, 0.12, 1),
  waterGlow: 1.15,
  skipWaves: true
}

const STORM_PALETTE: IslandPalette = {
  theme: 'storm',
  ground: 'assets/textures/colony_ground.png',
  water: 'assets/textures/storm_water.png',
  rim: Color4.create(0.22, 0.24, 0.28, 1),
  surfaceTint: Color4.create(0.9, 0.92, 0.95, 1),
  meadowA: Color4.create(0.35, 0.38, 0.42, 0.4),
  meadowB: Color4.create(0.22, 0.28, 0.36, 0.35),
  waterAlbedo: Color4.create(0.7, 0.78, 0.88, 1),
  waterEmissive: Color4.create(0.25, 0.35, 0.5, 1),
  waterGlow: 0.4
}

const RIFT_PALETTE: IslandPalette = {
  theme: 'rift',
  ground: 'assets/textures/rift_ground.png',
  water: 'assets/textures/rift_water.png',
  rim: Color4.create(0.35, 0.22, 0.45, 1),
  surfaceTint: Color4.create(0.95, 0.9, 1, 1),
  meadowA: Color4.create(0.55, 0.3, 0.75, 0.4),
  meadowB: Color4.create(0.75, 0.55, 0.25, 0.35),
  waterAlbedo: Color4.create(0.85, 0.7, 1, 1),
  waterEmissive: Color4.create(0.55, 0.25, 0.9, 1),
  waterGlow: 0.95,
  skipWaves: true
}

let palette = OCEAN_PALETTE

function paletteFor(visuals: MapVisuals | undefined): IslandPalette {
  if (visuals?.theme === 'ashen') {
    return {
      ...ASHEN_PALETTE,
      ground: visuals.ground || ASHEN_PALETTE.ground,
      water: visuals.water || ASHEN_PALETTE.water
    }
  }
  if (visuals?.theme === 'inferno') {
    return {
      ...INFERNO_PALETTE,
      ground: visuals.ground || INFERNO_PALETTE.ground,
      water: visuals.water || INFERNO_PALETTE.water
    }
  }
  if (visuals?.theme === 'storm') {
    return {
      ...STORM_PALETTE,
      ground: visuals.ground || STORM_PALETTE.ground,
      water: visuals.water || STORM_PALETTE.water
    }
  }
  if (visuals?.theme === 'rift') {
    return {
      ...RIFT_PALETTE,
      ground: visuals.ground || RIFT_PALETTE.ground,
      water: visuals.water || RIFT_PALETTE.water
    }
  }
  return {
    ...OCEAN_PALETTE,
    ground: visuals?.ground || OCEAN_PALETTE.ground,
    water: visuals?.water || OCEAN_PALETTE.water
  }
}

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

/** Apply the map's ground, water and horizon. Call at every match start. */
export function applyMapAppearance(map: MapDefinition): void {
  if (map.islands) {
    buildIslandTerrain(map.islands, map.visuals)
    return
  }
  clearIslandTerrain()
  setEnvironmentTheme(map.visuals?.theme ?? 'moon')
  setClassicGroundTexture(map.visuals?.ground ?? DEFAULT_MOON_GROUND)
}

/** Build the ocean + islands overlay for the given zones (match start). */
export function buildIslandTerrain(islands: IslandZone[], visuals?: MapVisuals): void {
  clearIslandTerrain()
  palette = paletteFor(visuals)
  setClassicTerrainVisible(false)
  setEnvironmentTheme(palette.theme)
  seed = 991177

  createOceanFloor()
  if (!palette.skipWaves) createWaveLayer(islands)
  for (const island of islands) createIsland(island)
}

/** Tear the overlay down and bring the classic battlefield back. */
export function clearIslandTerrain(): void {
  for (const entity of entities) engine.removeEntity(entity)
  entities.length = 0
  setClassicTerrainVisible(true)
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
        texture: Material.Texture.Common({ src: palette.water, wrapMode: TextureWrapMode.TWM_REPEAT }),
        // A touch of self-glow keeps the sea bright and readable from above.
        emissiveTexture: Material.Texture.Common({ src: palette.water, wrapMode: TextureWrapMode.TWM_REPEAT }),
        albedoColor: palette.waterAlbedo,
        emissiveColor: palette.waterEmissive,
        emissiveIntensity: palette.waterGlow,
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
    !islands.some((island) => Math.abs(x - island.x) < islandHalfX(island) + clearance && Math.abs(z - island.z) < islandHalfZ(island) + clearance)

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

/** One island: a grass plate over a sandy beach border - flat edges make building placement predictable. */
function createIsland(island: IslandZone): void {
  const width = islandHalfX(island) * 2
  const depth = islandHalfZ(island) * 2

  // Beach rim: pale sand peeking out under the grass, meeting the water.
  const rim = spawn()
  Transform.create(rim, {
    position: Vector3.create(island.x, 0.045, island.z),
    scale: Vector3.create(width + 1.6, 0.012, depth + 1.6)
  })
  MeshRenderer.setBox(rim)
  Material.setPbrMaterial(rim, {
    albedoColor: palette.rim,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })

  // Surface: lush grass so the isles read as living land against the sea.
  const surface = spawn()
  Transform.create(surface, {
    position: Vector3.create(island.x, 0.06, island.z),
    scale: Vector3.create(width, 0.014, depth)
  })
  MeshRenderer.setBox(surface)
  Material.setPbrMaterial(surface, {
    texture: Material.Texture.Common({ src: palette.ground, wrapMode: TextureWrapMode.TWM_REPEAT }),
    albedoColor: palette.surfaceTint,
    metallic: 0,
    roughness: 1,
    specularIntensity: 0,
    castShadows: false
  })

  // A couple of soft meadow patches per island so the grass isn't uniform
  // (still round - they're vegetation, not land).
  const patches = 2 + Math.floor(random() * 2)
  for (let i = 0; i < patches; i++) {
    const patch = spawn()
    const patchSize = Math.min(islandHalfX(island), islandHalfZ(island)) * (0.35 + random() * 0.4)
    const reachX = Math.max(0, islandHalfX(island) - patchSize * 0.6)
    const reachZ = Math.max(0, islandHalfZ(island) - patchSize * 0.6)
    Transform.create(patch, {
      position: Vector3.create(island.x + (random() * 2 - 1) * reachX, 0.075 + i * 0.004, island.z + (random() * 2 - 1) * reachZ),
      scale: Vector3.create(patchSize, 0.008, patchSize)
    })
    MeshRenderer.setCylinder(patch)
    Material.setPbrMaterial(patch, {
      albedoColor: random() < 0.5 ? palette.meadowA : palette.meadowB,
      metallic: 0,
      roughness: 1,
      specularIntensity: 0,
      castShadows: false
    })
  }
}
