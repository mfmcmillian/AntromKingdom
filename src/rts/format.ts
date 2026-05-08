import type { Vector3 } from '@dcl/sdk/math'

export function formatPosition(position: Vector3): string {
  return `x:${formatNumber(position.x)} y:${formatNumber(position.y)} z:${formatNumber(position.z)}`
}

export function formatVectorForPaste(position: Vector3): string {
  return `Vector3.create(${formatNumber(position.x)}, ${formatNumber(position.y)}, ${formatNumber(position.z)})`
}

export function formatNumber(value: number): string {
  return value.toFixed(2)
}
