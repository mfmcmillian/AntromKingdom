import { AvatarModifierArea, AvatarModifierType, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { SCENE } from './config'

// This is an RTS. No Decentraland body should ever stand on the battlefield.
// One oversized hide volume is often ignored by the explorer, so the map is
// tiled with smaller boxes that actually apply. A follow volume tracks the
// local player. The body is parked in the corner with movePlayerTo (direct
// Transform writes on PlayerEntity are ignored by the runtime).

const TILE = 48
const TILE_HEIGHT = 48
const MARGIN = 24
const HIDE_MODIFIERS = [
  AvatarModifierType.AMT_HIDE_AVATARS,
  AvatarModifierType.AMT_HIDE_NAMETAGS,
  AvatarModifierType.AMT_DISABLE_PASSPORTS
]

let tiles: ReturnType<typeof engine.addEntity>[] = []
let followHider: ReturnType<typeof engine.addEntity> | undefined
let started = false
let parkTimer = 0
let parking = false

export function ensureAvatarsHidden(): void {
  ensureTiles()
  ensureFollowHider()
  void parkLocalAvatar()
}

function ensureTiles(): void {
  if (tiles.length > 0) return

  const min = -MARGIN
  const max = SCENE.size + MARGIN
  for (let x = min + TILE / 2; x < max; x += TILE) {
    for (let z = min + TILE / 2; z < max; z += TILE) {
      const tile = engine.addEntity()
      Transform.create(tile, { position: Vector3.create(x, 8, z) })
      AvatarModifierArea.create(tile, {
        area: Vector3.create(TILE + 4, TILE_HEIGHT, TILE + 4),
        modifiers: HIDE_MODIFIERS,
        excludeIds: []
      })
      tiles.push(tile)
    }
  }
}

function ensureFollowHider(): void {
  if (!followHider) {
    followHider = engine.addEntity()
    Transform.create(followHider, { position: Vector3.create(SCENE.center, 8, SCENE.center) })
  }

  const player = Transform.getOrNull(engine.PlayerEntity)
  const transform = Transform.getMutable(followHider)
  if (player) {
    transform.position = Vector3.create(player.position.x, player.position.y + 4, player.position.z)
  }
  AvatarModifierArea.createOrReplace(followHider, {
    area: Vector3.create(24, 24, 24),
    modifiers: HIDE_MODIFIERS,
    excludeIds: []
  })
}

async function parkLocalAvatar(): Promise<void> {
  if (parking) return
  parking = true
  try {
    await movePlayerTo({
      newRelativePosition: Vector3.create(2, 0.05, 2)
    })
  } catch {
    // Preview or missing permission: hide volumes still cover the spawn.
  } finally {
    parking = false
  }
}

export function startAvatarHideSystem(): void {
  if (started) {
    ensureAvatarsHidden()
    return
  }
  started = true
  ensureAvatarsHidden()
  engine.addSystem((dt) => {
    parkTimer += dt
    if (parkTimer < 0.6) return
    parkTimer = 0
    ensureAvatarsHidden()
  })
}
