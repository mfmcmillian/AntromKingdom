// ---------------------------------------------------------------------------
// Optimize raw Meshy AI unit exports into game-ready GLBs.
//
//   node scripts/optimize-unit-models.mjs <sourceDir>
//
// Raw Meshy exports are ~40-55MB each (720k+ triangles, 4K PBR texture sets) -
// far beyond what an RTS scene that fields dozens of units can afford. For
// each unit this script:
//   1. Simplifies the mesh to a per-role triangle budget (meshoptimizer).
//   2. Drops the normal / metallic-roughness / emissive maps (invisible at
//      RTS camera distance) and resizes the base color texture to 512px JPEG.
//   3. Bakes a normalization transform: feet on the ground plane (minY = 0),
//      centered on X/Z, uniformly scaled to the role's in-game size so the
//      game can place them with scale (1,1,1).
//
// Output: models/units/<race>/<role>.glb
// Rerunnable: regenerate a unit in Meshy, drop the file in Downloads, rerun.
// ---------------------------------------------------------------------------

import { NodeIO, getBounds } from '@gltf-transform/core'
import { dedup, prune, simplify, textureCompress, weld } from '@gltf-transform/functions'
import { MeshoptSimplifier } from 'meshoptimizer'
import sharp from 'sharp'
import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Per-unit config. `match` finds the raw file among the Meshy downloads by
// substring. `size` is the baked in-game dimension in meters: measured on
// model height for walkers, on the larger X/Z footprint for craft/vehicles
// (whose height says nothing about their read on screen). `tris` is the
// simplification budget - bigger silhouettes keep more detail.
const UNITS = {
  human: [
    { role: 'worker', match: 'rigger', size: 0.95, mode: 'height', tris: 3500 },
    { role: 'melee', match: 'breacher', size: 1.35, mode: 'height', tris: 3500 },
    { role: 'ranged', match: 'longshot', size: 1.35, mode: 'height', tris: 3500 },
    { role: 'healer', match: 'medic', size: 1.3, mode: 'height', tris: 3500 },
    { role: 'caster', match: 'stormcaller', size: 1.45, mode: 'height', tris: 4000 },
    { role: 'antiAir', match: 'flakgunner', size: 1.4, mode: 'height', tris: 4000 },
    { role: 'flyer', match: 'kestrel', size: 2.3, mode: 'footprint', tris: 4500 },
    { role: 'transport', match: 'skyhauler', size: 2.7, mode: 'footprint', tris: 4500 },
    { role: 'heavyAir', match: 'dreadnought', size: 4.0, mode: 'footprint', tris: 7000 },
    { role: 'siege', match: 'thunderhead', size: 2.5, mode: 'footprint', tris: 5000 },
    { role: 'titan', match: 'juggernaut', size: 2.6, mode: 'height', tris: 7000 },
    { role: 'hero', match: 'kael', size: 1.9, mode: 'height', tris: 7000 }
  ],
  // Aethyr read slightly bigger than Vanguard: fewer, costlier, more imposing.
  alien: [
    { role: 'worker', match: 'seeker', size: 0.9, mode: 'height', tris: 3500 },
    { role: 'melee', match: 'sentinel', size: 1.5, mode: 'height', tris: 3500 },
    { role: 'ranged', match: 'lancer', size: 1.4, mode: 'height', tris: 3500 },
    { role: 'healer', match: 'lightmender', size: 1.35, mode: 'height', tris: 3500 },
    { role: 'caster', match: 'riftweaver', size: 1.5, mode: 'height', tris: 4000 },
    { role: 'antiAir', match: 'starlance', size: 1.45, mode: 'height', tris: 4000 },
    { role: 'flyer', match: 'zephyr', size: 2.4, mode: 'footprint', tris: 4500 },
    { role: 'transport', match: 'riftbarge', size: 2.8, mode: 'footprint', tris: 4500 },
    { role: 'heavyAir', match: 'solar_ark', size: 4.2, mode: 'footprint', tris: 7000 },
    { role: 'siege', match: 'sunlance', size: 2.6, mode: 'footprint', tris: 5000 },
    { role: 'titan', match: 'avatar', size: 2.8, mode: 'height', tris: 7000 },
    { role: 'hero', match: 'auren', size: 2.0, mode: 'height', tris: 7000 }
  ],
  // Myriad swarm reads smaller than the other races; low-slung crawlers scale
  // by footprint so a long body doesn't blow up when measured by height.
  bio: [
    { role: 'worker', match: 'grub', size: 1.0, mode: 'footprint', tris: 3500 },
    { role: 'melee', match: 'mauler', size: 1.4, mode: 'footprint', tris: 3500 },
    { role: 'ranged', match: 'spitter', size: 1.3, mode: 'footprint', tris: 3500 },
    { role: 'healer', match: 'broodtender', size: 1.1, mode: 'height', tris: 3500 },
    { role: 'caster', match: 'plagueweaver', size: 1.5, mode: 'height', tris: 4000 },
    { role: 'antiAir', match: 'sporelasher', size: 1.3, mode: 'height', tris: 4000 },
    { role: 'flyer', match: 'shrieker', size: 2.0, mode: 'footprint', tris: 4500 },
    // The broodwing is a jellyfish - its height (dome + tendrils) dwarfs its
    // footprint, so scale by height or it becomes a 4m monster.
    { role: 'transport', match: 'broodwing', size: 2.6, mode: 'height', tris: 4500 },
    { role: 'heavyAir', match: 'skyleviathan', size: 3.8, mode: 'footprint', tris: 7000 },
    { role: 'siege', match: 'acidmaw', size: 2.3, mode: 'footprint', tris: 5000 },
    { role: 'titan', match: 'behemoth', size: 2.4, mode: 'height', tris: 7000 },
    { role: 'hero', match: 'szel', size: 2.2, mode: 'height', tris: 7000 }
  ]
}

const sourceDir = process.argv[2]
if (!sourceDir) {
  console.error('Usage: node scripts/optimize-unit-models.mjs <sourceDir>')
  process.exit(1)
}

const io = new NodeIO()
await MeshoptSimplifier.ready

const sourceFiles = readdirSync(sourceDir).filter((name) => name.toLowerCase().endsWith('.glb'))

function countTriangles(doc) {
  let total = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const indices = prim.getIndices()
      total += indices ? indices.getCount() / 3 : prim.getAttribute('POSITION').getCount() / 3
    }
  }
  return total
}

for (const [race, units] of Object.entries(UNITS)) {
  const outDir = join('models', 'units', race)
  mkdirSync(outDir, { recursive: true })

  for (const unit of units) {
    const fileName = sourceFiles.find((name) => name.toLowerCase().includes(unit.match))
    if (!fileName) {
      console.log(`SKIP  ${race}/${unit.role}: no file matching "${unit.match}" in ${sourceDir}`)
      continue
    }

    const sourcePath = join(sourceDir, fileName)
    const doc = await io.read(sourcePath)

    const before = countTriangles(doc)
    const ratio = Math.min(1, unit.tris / before)
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.25 }))

    // Base color carries the whole look at RTS zoom; everything else is dead
    // weight. Fixed factors replace the dropped metallic-roughness map.
    for (const material of doc.getRoot().listMaterials()) {
      material.setNormalTexture(null)
      material.setMetallicRoughnessTexture(null)
      material.setEmissiveTexture(null)
      material.setEmissiveFactor([0, 0, 0])
      material.setMetallicFactor(0)
      material.setRoughnessFactor(0.85)
    }

    await doc.transform(
      textureCompress({ encoder: sharp, targetFormat: 'jpeg', quality: 80, resize: [512, 512] }),
      dedup(),
      prune()
    )

    // Bake feet-on-ground centering and in-game scale into a wrapper node.
    const scene = doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]
    const bounds = getBounds(scene)
    const sizeX = bounds.max[0] - bounds.min[0]
    const sizeY = bounds.max[1] - bounds.min[1]
    const sizeZ = bounds.max[2] - bounds.min[2]
    const measured = unit.mode === 'height' ? sizeY : Math.max(sizeX, sizeZ)
    const scale = unit.size / measured
    const centerX = (bounds.min[0] + bounds.max[0]) / 2
    const centerZ = (bounds.min[2] + bounds.max[2]) / 2

    const wrapper = doc
      .createNode(`${race}-${unit.role}`)
      .setScale([scale, scale, scale])
      .setTranslation([-centerX * scale, -bounds.min[1] * scale, -centerZ * scale])
    for (const child of scene.listChildren()) wrapper.addChild(child)
    scene.addChild(wrapper)

    const outPath = join(outDir, `${unit.role}.glb`)
    await io.write(outPath, doc)

    const outKb = Math.round(statSync(outPath).size / 1024)
    const after = countTriangles(doc)
    console.log(
      `OK    ${race}/${unit.role}: ${Math.round(before / 1000)}k -> ${Math.round(after)} tris, ` +
        `${outKb} KB, ${sizeX.toFixed(2)}x${sizeY.toFixed(2)}x${sizeZ.toFixed(2)} raw -> ${unit.size}m ${unit.mode}`
    )
  }
}

console.log('Done.')
