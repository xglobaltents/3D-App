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

/* ─── Undo/Redo ───────────────────────────────────────────────────────────── */

export interface UndoEntry {
  transform: TransformValues
  uniformScale: number
}

/* ─── Saved Configurations ────────────────────────────────────────────────── */

export interface SavedConfig {
  name: string
  partIndex: number
  transform: TransformValues
  uniformScale: number
  mirrors: MirrorFlags
  timestamp: number
}

/* ─── Tab Types ───────────────────────────────────────────────────────────── */

export type PanelTab = 'move' | 'rotate' | 'mirror' | 'snap' | 'saved'
