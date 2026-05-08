import { Entity, Transform } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function cloneVector(vector: Vector3): Vector3 {
  return Vector3.create(vector.x, vector.y, vector.z)
}

export function distanceToPoint(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z

  return Math.sqrt(dx * dx + dz * dz)
}

export function distanceToPosition(entity: Entity, position: Vector3): number {
  const current = Transform.get(entity).position
  return distanceToPoint(current, position)
}

export function moveTowardPosition(entity: Entity, target: Vector3, speed: number, dt: number): void {
  const transform = Transform.getMutable(entity)
  const current = transform.position
  const direction = Vector3.create(target.x - current.x, 0, target.z - current.z)
  const distance = Math.sqrt(direction.x * direction.x + direction.z * direction.z)

  if (distance <= 0.01) return

  const step = Math.min(distance, speed * dt)
  transform.position = Vector3.create(current.x + (direction.x / distance) * step, current.y, current.z + (direction.z / distance) * step)
  transform.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(direction.x, direction.z) * 180) / Math.PI, 0)
}

export function getFormationPosition(center: Vector3, slot: number, radius: number): Vector3 {
  const angle = slot * 2.399963229728653
  const ring = Math.floor(slot / 6)
  const slotRadius = radius + ring * 0.45

  return Vector3.create(center.x + Math.cos(angle) * slotRadius, center.y, center.z + Math.sin(angle) * slotRadius)
}

export function offsetSpawn(position: Vector3, index: number): Vector3 {
  const offset = (index % 5) * 0.35

  return Vector3.create(position.x + offset, position.y, position.z + Math.floor(index / 5) * 0.35)
}
