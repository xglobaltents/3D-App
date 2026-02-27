import type { Color3 } from '@babylonjs/core'

/* ─── Transform Values ────────────────────────────────────────────────────── */

export interface TransformValues {
  px: number
  py: number
  pz: number
  rx: number
  ry: number
  rz: number
  sx: number
  sy: number
  sz: number
}

export const ZERO_TRANSFORM: TransformValues = {
  px: 0, py: 0, pz: 0,
  rx: 0, ry: 0, rz: 0,
  sx: 1, sy: 1, sz: 1,
}

/* ─── Mirror System ───────────────────────────────────────────────────────── */

export type MirrorAxis = 'x' | 'z' | 'xz'

export type MirrorFlags = Record<MirrorAxis, boolean>

export const EMPTY_MIRRORS: MirrorFlags = { x: false, z: false, xz: false }

export interface MirrorConfig {
  axis: MirrorAxis
  short: string
  color: Color3
  desc: string
  posFn: (p: import('@babylonjs/core').Vector3) => import('@babylonjs/core').Vector3
  rotFn: (r: import('@babylonjs/core').Vector3) => import('@babylonjs/core').Vector3
}

export interface MirrorInstance {
  axis: MirrorAxis
  node: import('@babylonjs/core').TransformNode
  modelNode: import('@babylonjs/core').TransformNode
  meshes: import('@babylonjs/core').Mesh[]
  mat: import('@babylonjs/core').PBRMetallicRoughnessMaterial
}

/* ─── Scale ───────────────────────────────────────────────────────────────── */

export interface AxisScale {
  x: number
  y: number
  z: number
}

export const DEFAULT_SCALE: AxisScale = { x: 1, y: 1, z: 1 }
export const MIN_SCALE = 0.001
export const MAX_SCALE = 5

/** Clamp a single scale value to the allowed range */
export function clampScale(v: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))
}

/** Clamp all axes of an AxisScale to the allowed range */
export function clampAxisScale(s: AxisScale): AxisScale {
  return { x: clampScale(s.x), y: clampScale(s.y), z: clampScale(s.z) }
}

/* ─── Undo/Redo ───────────────────────────────────────────────────────────── */

export interface UndoEntry {
  transform: TransformValues
  axisScale: AxisScale
}

/* ─── Saved Configurations ────────────────────────────────────────────────── */

export interface SavedConfig {
  name: string
  partIndex: number
  transform: TransformValues
  /** @deprecated kept for backward compat with old saves */
  uniformScale?: number
  axisScale: AxisScale
  mirrors: MirrorFlags
  timestamp: number
}

/* ─── Tab Types ───────────────────────────────────────────────────────────── */

export type PanelTab = 'move' | 'rotate' | 'mirror' | 'snap' | 'saved'
