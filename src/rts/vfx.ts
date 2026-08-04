import { Entity, ParticleSystem, Transform, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const PARTICLE_BLEND_ALPHA = 0
const PARTICLE_BLEND_ADD = 1

type DamageVfx = {
  fire: Entity
  smoke: Entity
  level: number
}

const damageVfxByFire = new Map<Entity, DamageVfx>()

export function createBuildingDamageVfx(position: Vector3, level: number): Entity {
  const fire = createParticleEmitter(position, createFireOptions(level))
  const smoke = createParticleEmitter(Vector3.create(position.x, position.y + 0.35, position.z), createSmokeOptions(level))
  damageVfxByFire.set(fire, { fire, smoke, level })
  return fire
}

export function updateBuildingDamageVfx(fire: Entity, position: Vector3, level: number): void {
  const vfx = damageVfxByFire.get(fire)
  if (!vfx) return

  Transform.getMutable(vfx.fire).position = Vector3.create(position.x, position.y, position.z)
  Transform.getMutable(vfx.smoke).position = Vector3.create(position.x, position.y + 0.35, position.z)

  if (vfx.level === level) return
  vfx.level = level
  updateParticleEmitter(vfx.fire, createFireOptions(level))
  updateParticleEmitter(vfx.smoke, createSmokeOptions(level))
}

export function removeBuildingDamageVfx(fire: Entity | undefined): void {
  if (!fire) return

  const vfx = damageVfxByFire.get(fire)
  if (!vfx) return

  removeParticleEmitter(vfx.fire)
  removeParticleEmitter(vfx.smoke)
  damageVfxByFire.delete(fire)
}

function createFireOptions(level: number) {
  const power = Math.max(0.7, level)
  return {
    rate: 18 * power,
    maxParticles: Math.round(45 * power),
    lifetime: 0.7,
    gravity: -0.35,
    initialSize: { start: 0.08 * power, end: 0.24 * power },
    sizeOverTime: { start: 0.9, end: 0.2 },
    initialVelocitySpeed: { start: 0.35 * power, end: 0.9 * power },
    initialColor: {
      start: Color4.create(1, 0.2, 0.02, 0.95),
      end: Color4.create(1, 0.75, 0.12, 0.85)
    },
    colorOverTime: {
      start: Color4.create(1, 0.35, 0.02, 0.9),
      end: Color4.create(0.35, 0.02, 0.01, 0)
    },
    blendMode: PARTICLE_BLEND_ADD,
    shape: ParticleSystem.Shape.Cone({ angle: 16, radius: 0.25 * power }),
    loop: true,
    prewarm: true
  }
}

function createSmokeOptions(level: number) {
  const power = Math.max(0.7, level)
  return {
    rate: 8 * power,
    maxParticles: Math.round(24 * power),
    lifetime: 1.5,
    gravity: -0.12,
    initialSize: { start: 0.16 * power, end: 0.42 * power },
    sizeOverTime: { start: 0.5, end: 1.35 },
    initialVelocitySpeed: { start: 0.15 * power, end: 0.45 * power },
    initialColor: {
      start: Color4.create(0.16, 0.14, 0.13, 0.45),
      end: Color4.create(0.05, 0.05, 0.05, 0.2)
    },
    colorOverTime: {
      start: Color4.create(0.12, 0.11, 0.1, 0.35),
      end: Color4.create(0.04, 0.04, 0.04, 0)
    },
    blendMode: PARTICLE_BLEND_ALPHA,
    shape: ParticleSystem.Shape.Sphere({ radius: 0.2 * power }),
    loop: true,
    prewarm: true
  }
}

function createParticleEmitter(position: Vector3, options: ReturnType<typeof createFireOptions> | ReturnType<typeof createSmokeOptions>): Entity {
  const entity = engine.addEntity()
  Transform.create(entity, { position })
  ParticleSystem.create(entity, options)
  return entity
}

function updateParticleEmitter(entity: Entity, options: ReturnType<typeof createFireOptions> | ReturnType<typeof createSmokeOptions>): void {
  ParticleSystem.createOrReplace(entity, options)
}

function removeParticleEmitter(entity: Entity): void {
  if (Transform.getOrNull(entity)) {
    engine.removeEntity(entity)
  }
}
