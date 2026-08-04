import { Entity, Material, MeshRenderer, Transform, VisibilityComponent, engine } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

// Pooled one-shot combat effects:
//   impact flash - small glowing burst where a hit lands.
//   blast ring   - flat expanding disc for caster splash and titan stomps.
// Effects animate scale + fade, then return to the pool. Nothing here allocates
// entities mid-fight once the pools are warm.

type EffectShape = 'flash' | 'ring'

type Effect = {
  entity: Entity
  shape: EffectShape
  age: number
  duration: number
  startScale: number
  endScale: number
  color: Color4
  active: boolean
}

const effects: Effect[] = []

export function spawnImpactFlash(position: Vector3, color: Color4): void {
  const effect = obtainEffect('flash')
  effect.age = 0
  effect.duration = 0.28
  effect.startScale = 0.28
  effect.endScale = 1.1
  effect.color = color
  effect.active = true

  Transform.getMutable(effect.entity).position = Vector3.create(position.x, position.y + 0.9, position.z)
  MeshRenderer.setSphere(effect.entity)
  applyEffectMaterial(effect, 1)
  VisibilityComponent.createOrReplace(effect.entity, { visible: true })
}

/** Unit death: a bright expanding burst plus a ground shockwave, scaled to the victim. */
export function spawnDeathBurst(position: Vector3, color: Color4, size = 1): void {
  const burst = obtainEffect('flash')
  burst.age = 0
  burst.duration = 0.45
  burst.startScale = 0.5 * size
  burst.endScale = 2.2 * size
  burst.color = color
  burst.active = true

  Transform.getMutable(burst.entity).position = Vector3.create(position.x, position.y + 0.8, position.z)
  MeshRenderer.setSphere(burst.entity)
  applyEffectMaterial(burst, 1)
  VisibilityComponent.createOrReplace(burst.entity, { visible: true })

  spawnBlastRing(position, color, 1.1 * size)
}

/** Flat expanding shockwave disc at ground level. */
export function spawnBlastRing(position: Vector3, color: Color4, radius: number): void {
  const effect = obtainEffect('ring')
  effect.age = 0
  effect.duration = 0.5
  effect.startScale = radius * 0.35
  effect.endScale = radius * 2
  effect.color = color
  effect.active = true

  Transform.getMutable(effect.entity).position = Vector3.create(position.x, 0.12, position.z)
  MeshRenderer.setCylinder(effect.entity)
  applyEffectMaterial(effect, 1)
  VisibilityComponent.createOrReplace(effect.entity, { visible: true })
}

function obtainEffect(shape: EffectShape): Effect {
  const idle = effects.find((candidate) => !candidate.active)
  if (idle) {
    idle.shape = shape
    return idle
  }

  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(0, -10, 0) })
  VisibilityComponent.create(entity, { visible: false })
  const effect: Effect = {
    entity,
    shape,
    age: 0,
    duration: 0.3,
    startScale: 0.3,
    endScale: 1,
    color: Color4.White(),
    active: false
  }
  effects.push(effect)
  return effect
}

function applyEffectMaterial(effect: Effect, alpha: number): void {
  Material.setPbrMaterial(effect.entity, {
    albedoColor: Color4.create(effect.color.r, effect.color.g, effect.color.b, alpha * 0.85),
    emissiveColor: effect.color,
    emissiveIntensity: 2.5 * alpha,
    transparencyMode: 2,
    metallic: 0,
    roughness: 1,
    castShadows: false
  })
}

function impactVfxSystem(dt: number): void {
  for (const effect of effects) {
    if (!effect.active) continue

    effect.age += dt
    const progress = effect.age / effect.duration
    if (progress >= 1) {
      effect.active = false
      VisibilityComponent.createOrReplace(effect.entity, { visible: false })
      continue
    }

    const scale = effect.startScale + (effect.endScale - effect.startScale) * progress
    const transform = Transform.getMutable(effect.entity)
    transform.scale = effect.shape === 'ring' ? Vector3.create(scale, 0.08, scale) : Vector3.create(scale, scale, scale)
    applyEffectMaterial(effect, 1 - progress)
  }
}

engine.addSystem(impactVfxSystem)
