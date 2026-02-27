import type { Mesh, TransformNode, Material, AbstractMesh } from '@babylonjs/core'

/* ─── Math Helpers ────────────────────────────────────────────────────────── */

/** Round radians to degrees (2 decimal places). */
export function radToDeg(r: number): number {
  return Math.round((r * 180) / Math.PI * 100) / 100
}

/** Convert degrees to radians. */
export function degToRad(d: number): number {
  return (d * Math.PI) / 180
}

/** Round to 4 decimal places. */
export function roundTo4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** Snap a value to the nearest grid increment. */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize
}

/* ─── Disposal Helpers ────────────────────────────────────────────────────── */

type Disposable = Mesh | TransformNode | Material | AbstractMesh | null | undefined

/** Safely dispose one or more Babylon.js objects, swallowing errors. */
export function safeDispose(...nodes: Disposable[]): void {
  for (const n of nodes) {
    try {
      n?.dispose()
    } catch {
      /* already disposed */
    }
  }
}

/** Safely dispose an array of meshes/nodes and clear the array. */
export function safeDisposeArray(arr: Disposable[]): void {
  for (const n of arr) {
    safeDispose(n)
  }
  arr.length = 0
}

/* ─── LocalStorage Helpers ────────────────────────────────────────────────── */

const STORAGE_KEY = 'pb-configs'

import type { SavedConfig } from './types'

export function loadConfigs(): SavedConfig[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function saveConfigs(configs: SavedConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
}
