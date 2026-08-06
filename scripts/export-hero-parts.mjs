/* Extracts the exact primitive parts of the three hero models by running the
 * real unitModels.ts builders against stubbed SDK modules, then writes
 * scripts/hero-parts.json for the three.js reference renderer.
 * Usage: node scripts/export-hero-parts.mjs
 */
import { build } from 'esbuild'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')

// --- Stub sources ----------------------------------------------------------

const mathStub = `
export const Vector3 = {
  create: (x = 0, y = 0, z = 0) => ({ x, y, z }),
  Zero: () => ({ x: 0, y: 0, z: 0 }),
  One: () => ({ x: 1, y: 1, z: 1 })
}
export const Color4 = {
  create: (r, g, b, a = 1) => ({ r, g, b, a }),
  Black: () => ({ r: 0, g: 0, b: 0, a: 1 }),
  White: () => ({ r: 1, g: 1, b: 1, a: 1 })
}
// DCL uses Unity-style YXZ intrinsic euler order.
export const Quaternion = {
  Identity: () => ({ x: 0, y: 0, z: 0, w: 1 }),
  fromEulerDegrees: (xDeg, yDeg, zDeg) => {
    const x = (xDeg * Math.PI) / 360
    const y = (yDeg * Math.PI) / 360
    const z = (zDeg * Math.PI) / 360
    const cx = Math.cos(x), sx = Math.sin(x)
    const cy = Math.cos(y), sy = Math.sin(y)
    const cz = Math.cos(z), sz = Math.sin(z)
    return {
      x: sx * cy * cz + cx * sy * sz,
      y: cx * sy * cz - sx * cy * sz,
      z: cx * cy * sz - sx * sy * cz,
      w: cx * cy * cz + sx * sy * sz
    }
  }
}
`

const ecsStub = `
let nextEntity = 1
export const registry = new Map()
function rec(entity) {
  if (!registry.has(entity)) registry.set(entity, { transform: null, mesh: null, material: null })
  return registry.get(entity)
}
export const engine = {
  addEntity: () => { const e = nextEntity++; rec(e); return e },
  removeEntity: () => {},
  addSystem: () => {},
  CameraEntity: 0,
  PlayerEntity: 0
}
export const Transform = {
  create: (e, data = {}) => { rec(e).transform = data },
  createOrReplace: (e, data = {}) => { rec(e).transform = data },
  get: (e) => rec(e).transform ?? { position: { x: 0, y: 0, z: 0 } },
  getMutable: (e) => rec(e).transform ?? (rec(e).transform = {})
}
export const MeshRenderer = {
  setBox: (e) => { rec(e).mesh = { kind: 'box' } },
  setSphere: (e) => { rec(e).mesh = { kind: 'sphere' } },
  setPlane: (e) => { rec(e).mesh = { kind: 'plane' } },
  setCylinder: (e, radiusBottom = 0.5, radiusTop = 0.5) => { rec(e).mesh = { kind: 'cylinder', radiusBottom, radiusTop } }
}
export const Material = {
  setPbrMaterial: (e, mat) => { rec(e).material = mat },
  setBasicMaterial: (e, mat) => { rec(e).material = mat }
}
export const VisibilityComponent = {
  create: () => {},
  createOrReplace: () => {},
  getOrNull: () => null,
  deleteFrom: () => {}
}
export const Animator = {}
export const GltfContainer = {}
`

const stateStub = `
export const isPlayerAlly = () => false
export const gameState = { playerRace: 'human', enemyRaces: {} }
export const areHostile = () => true
`

// --- Bundle unitModels with the stubs --------------------------------------

const tmp = mkdtempSync(path.join(tmpdir(), 'hero-export-'))
writeFileSync(path.join(tmp, 'math-stub.mjs'), mathStub)
writeFileSync(path.join(tmp, 'ecs-stub.mjs'), ecsStub)
writeFileSync(path.join(tmp, 'state-stub.mjs'), stateStub)

const entry = `
import { registry, engine } from 'ecs-stub'
import { buildUnitModel } from '${pathToFileURL(path.join(root, 'src/rts/unitModels.ts')).href.replace('file:///', '').replaceAll('%20', ' ')}'

const heroes = {}
for (const race of ['human', 'alien', 'bio']) {
  const before = new Set(registry.keys())
  const root = engine.addEntity()
  buildUnitModel(root, race, 'hero', 'player')
  const parts = []
  for (const [entity, data] of registry) {
    if (before.has(entity) || entity === root) continue
    parts.push({ entity, ...data })
  }
  heroes[race] = { root, parts }
}
globalThis.__heroExport = heroes
`
writeFileSync(path.join(tmp, 'entry.mjs'), entry)

const result = await build({
  entryPoints: [path.join(tmp, 'entry.mjs')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  alias: {
    '@dcl/sdk/math': path.join(tmp, 'math-stub.mjs'),
    '@dcl/sdk/ecs': path.join(tmp, 'ecs-stub.mjs'),
    'ecs-stub': path.join(tmp, 'ecs-stub.mjs')
  },
  plugins: [
    {
      name: 'state-stub',
      setup(buildApi) {
        buildApi.onResolve({ filter: /^\.\/state$/ }, () => ({ path: path.join(tmp, 'state-stub.mjs') }))
      }
    }
  ]
})

const outFile = path.join(tmp, 'bundle.mjs')
writeFileSync(outFile, result.outputFiles[0].text)
await import(pathToFileURL(outFile).href)

const heroes = globalThis.__heroExport
const out = {}
for (const [race, data] of Object.entries(heroes)) {
  out[race] = data.parts
    .filter((p) => p.transform)
    .map((p) => ({
      id: p.entity,
      parent: p.transform.parent ?? null,
      position: p.transform.position ?? { x: 0, y: 0, z: 0 },
      scale: p.transform.scale ?? { x: 1, y: 1, z: 1 },
      rotation: p.transform.rotation ?? { x: 0, y: 0, z: 0, w: 1 },
      mesh: p.mesh,
      material: p.material
    }))
  console.log(race, out[race].length, 'parts')
}

writeFileSync(path.join(__dirname, 'hero-parts.json'), JSON.stringify(out))
console.log('wrote scripts/hero-parts.json')
