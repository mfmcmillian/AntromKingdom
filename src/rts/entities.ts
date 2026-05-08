import {
  Animator,
  AudioSource,
  Billboard,
  BillboardMode,
  ColliderLayer,
  Entity,
  GltfContainer,
  Material,
  MeshCollider,
  MeshRenderer,
  TextAlignMode,
  TextShape,
  Transform,
  engine
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import type { BoxConfig, ModelConfig } from './types'
import { cloneVector } from './math'

export type RallyMarker = { root: Entity; pole: Entity; flag: Entity; base: Entity }

const UIColors = {
  rallyPole: Color4.create(0.95, 0.9, 0.65, 1),
  rallyFlag: Color4.create(0.2, 0.85, 0.35, 0.95),
  rallyBase: Color4.create(0.2, 0.6, 1, 0.45)
}

export function createModelEntity(config: ModelConfig): Entity {
  const entity = engine.addEntity()

  Transform.create(entity, {
    position: cloneVector(config.position),
    rotation: Quaternion.fromEulerDegrees(0, config.rotationY ?? 0, 0),
    scale: cloneVector(config.scale)
  })
  GltfContainer.create(entity, {
    src: config.src,
    visibleMeshesCollisionMask: ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS,
    invisibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS
  })

  if (config.animations) {
    Animator.create(entity, { states: config.animations })
  }

  if (config.audioClipUrl) {
    AudioSource.create(entity, {
      audioClipUrl: config.audioClipUrl,
      playing: false,
      loop: false,
      volume: 0.55
    })
  }

  return entity
}

export function createModelColliderEntity(parent: Entity, config: ModelConfig): Entity {
  const collider = engine.addEntity()
  const colliderScale = Vector3.create(
    config.colliderScale?.x ?? config.scale.x,
    config.colliderScale?.y ?? config.scale.y,
    config.colliderScale?.z ?? config.scale.z
  )

  Transform.create(collider, {
    parent,
    position: Vector3.create(0, colliderScale.y / (2 * config.scale.y), 0),
    scale: Vector3.create(colliderScale.x / config.scale.x, colliderScale.y / config.scale.y, colliderScale.z / config.scale.z)
  })
  MeshCollider.setBox(collider)

  return collider
}

export function createBoxEntity(config: BoxConfig): Entity {
  const entity = createVisualBoxEntity(config)

  MeshCollider.setBox(entity)
  return entity
}

export function createVisualBoxEntity(config: BoxConfig): Entity {
  const entity = engine.addEntity()

  Transform.create(entity, {
    position: cloneVector(config.position),
    scale: cloneVector(config.scale)
  })
  MeshRenderer.setBox(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: config.color,
    emissiveColor: config.emissive ?? Color4.Black(),
    transparencyMode: config.transparent ? 1 : 0
  })

  return entity
}

export function createRallyMarker(): RallyMarker {
  const root = engine.addEntity()

  Transform.create(root, {
    position: Vector3.create(0, -10, 0),
    scale: Vector3.create(1, 1, 1)
  })

  return {
    root,
    pole: createRallyMarkerPart(root, Vector3.create(0, 0.75, 0), Vector3.create(0.08, 1.5, 0.08), UIColors.rallyPole),
    flag: createRallyMarkerPart(root, Vector3.create(0.34, 1.35, 0), Vector3.create(0.68, 0.34, 0.06), UIColors.rallyFlag),
    base: createRallyMarkerPart(root, Vector3.create(0, 0.03, 0), Vector3.create(0.55, 0.06, 0.55), UIColors.rallyBase)
  }
}

export function createLabel(parent: Entity, text: string, offsetY: number): Entity {
  const label = engine.addEntity()

  Transform.create(label, {
    parent,
    position: Vector3.create(0, offsetY, 0),
    scale: Vector3.create(1, 1, 1)
  })
  TextShape.create(label, {
    text,
    fontSize: 2,
    textColor: Color4.White(),
    outlineColor: Color4.Black(),
    outlineWidth: 0.15,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })

  return label
}

export function hideEntity(entity: Entity): void {
  const transform = Transform.getMutable(entity)
  transform.position = Vector3.create(transform.position.x, -10, transform.position.z)
}

function createRallyMarkerPart(parent: Entity, position: Vector3, scale: Vector3, color: Color4): Entity {
  const entity = engine.addEntity()

  Transform.create(entity, { parent, position, scale })
  MeshRenderer.setBox(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: color,
    emissiveColor: color,
    transparencyMode: color.a < 1 ? 1 : 0
  })

  return entity
}
