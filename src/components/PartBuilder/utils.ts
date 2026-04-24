import { Vector3 } from '@babylonjs/core'
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

/** Wrap an angle in radians to the [-PI, PI] range for stable display/export. */
export function wrapRadians(angle: number): number {
  const wrapped = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  if (Math.abs(wrapped) < 1e-6) return 0
  if (Math.abs(Math.abs(wrapped) - Math.PI) < 1e-6) return wrapped < 0 ? -Math.PI : Math.PI
  return wrapped
}

/**
 * Euler angles are not unique. Choose the equivalent representation with the
 * smaller total rotation magnitude so mirrored part output stays human-readable.
 */
export function canonicalizeEulerDisplay(rotation: Vector3): Vector3 {
  const primary = new Vector3(
    wrapRadians(rotation.x),
    wrapRadians(rotation.y),
    wrapRadians(rotation.z),
  )

  const alternate = new Vector3(
    wrapRadians(primary.x + Math.PI),
    wrapRadians(Math.PI - primary.y),
    wrapRadians(primary.z + Math.PI),
  )

  const primaryScore = Math.abs(primary.x) + Math.abs(primary.y) + Math.abs(primary.z)
  const alternateScore = Math.abs(alternate.x) + Math.abs(alternate.y) + Math.abs(alternate.z)

  return alternateScore + 1e-6 < primaryScore ? alternate : primary
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

import type { SavedConfig, TransformValues, AxisScale, MirrorFlags } from './types'

const TRANSFORM_KEYS: (keyof TransformValues)[] = ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz']
const AXIS_KEYS: (keyof AxisScale)[] = ['x', 'y', 'z']
const MIRROR_KEYS: (keyof MirrorFlags)[] = ['x', 'z', 'xz']

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isTransformValues(v: unknown): v is TransformValues {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return TRANSFORM_KEYS.every((k) => isFiniteNumber(o[k]))
}

function isAxisScale(v: unknown): v is AxisScale {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return AXIS_KEYS.every((k) => isFiniteNumber(o[k]))
}

function isMirrorFlags(v: unknown): v is MirrorFlags {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return MIRROR_KEYS.every((k) => typeof o[k] === 'boolean')
}

function isSavedConfig(v: unknown): v is SavedConfig {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.name === 'string' &&
    isFiniteNumber(o.partIndex) &&
    isTransformValues(o.transform) &&
    isAxisScale(o.axisScale) &&
    isMirrorFlags(o.mirrors) &&
    isFiniteNumber(o.timestamp)
  )
}

export function loadConfigs(): SavedConfig[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(isSavedConfig)
  } catch {
    return []
  }
}

export function saveConfigs(configs: SavedConfig[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(configs))
}

/* ─── Semantic Position Analyzer ──────────────────────────────────────────── */

import type { TentSpecs } from '@/types'

/**
 * Tolerance for floating-point comparisons when matching positions
 * to known structural references (frame lines, eave height, etc.).
 */
const MATCH_TOL = 0.02

/** Description of where a position sits relative to the tent structure. */
export interface PositionContext {
  /** X-axis: which side of the tent */
  side: string
  /** X-axis: formula using specs values */
  sideFormula: string
  /** Y-axis: height level description */
  level: string
  /** Y-axis: formula using specs values */
  levelFormula: string
  /** Z-axis: which frame line or position along length */
  frameLine: string
  /** Z-axis: formula using specs values */
  frameLineFormula: string
  /** Rotation description in human terms */
  orientation: string
  /** Summary string for quick reading */
  summary: string
}

/**
 * Analyze a transform against the tent specs and produce a human-readable
 * description of the placement, alignment, level, orientation, etc.
 */
export function analyzePosition(
  v: TransformValues,
  specs: TentSpecs,
  numBays: number,
  baseplateTop: number,
  lineZs: number[],
): PositionContext {
  const halfLength = (numBays * specs.bayDistance) / 2

  // ── X axis (side) ──────────────────────────────────────────────────────
  let side: string
  let sideFormula: string

  if (Math.abs(v.px - (-specs.halfWidth)) < MATCH_TOL) {
    side = 'Right side (−X)'
    sideFormula = '-specs.halfWidth'
  } else if (Math.abs(v.px - specs.halfWidth) < MATCH_TOL) {
    side = 'Left side (+X)'
    sideFormula = 'specs.halfWidth'
  } else if (Math.abs(v.px) < MATCH_TOL) {
    side = 'Center X'
    sideFormula = '0'
  } else {
    // Check if it's at a known purlin X position
    const purlinMatch = [...specs.mainPurlinX, ...specs.intermediatePurlinX].find(
      px => Math.abs(v.px - px) < MATCH_TOL
    )
    if (purlinMatch !== undefined) {
      const isMain = specs.mainPurlinX.includes(purlinMatch)
      side = `${isMain ? 'Main' : 'Intermediate'} purlin line X=${purlinMatch}m (${purlinMatch < 0 ? 'right' : 'left'} of center)`
      sideFormula = `${isMain ? 'specs.mainPurlinX' : 'specs.intermediatePurlinX'}[${purlinMatch}]`
    } else {
      // Check gable support positions
      const gableMatch = specs.gableSupportPositions.find(
        gp => Math.abs(v.px - gp) < MATCH_TOL
      )
      if (gableMatch !== undefined) {
        side = `Gable support X=${gableMatch}m (${gableMatch < 0 ? 'right' : 'left'} of center)`
        sideFormula = `specs.gableSupportPositions[${gableMatch}]`
      } else {
        // Express as offset from nearest known reference
        const absX = Math.abs(v.px)
        const offsetFromEdge = roundTo4(absX - specs.halfWidth)
        if (Math.abs(offsetFromEdge) < 1) {
          side = `${v.px < 0 ? 'Right' : 'Left'} side ${offsetFromEdge >= 0 ? '+' : ''}${roundTo4(offsetFromEdge)}m from edge`
          sideFormula = `${v.px < 0 ? '-' : ''}specs.halfWidth ${offsetFromEdge >= 0 ? '+' : ''}${roundTo4(offsetFromEdge)}`
        } else {
          side = `X=${v.px}m (${v.px < 0 ? 'right' : v.px > 0 ? 'left' : 'center'} region)`
          sideFormula = `${v.px}`
        }
      }
    }
  }

  // ── Y axis (level) ─────────────────────────────────────────────────────
  let level: string
  let levelFormula: string

  const eaveTop = baseplateTop + specs.eaveHeight
  const ridgeTop = baseplateTop + specs.ridgeHeight

  if (Math.abs(v.py - baseplateTop) < MATCH_TOL) {
    level = 'Ground level (top of baseplate)'
    levelFormula = 'baseplateTop'
  } else if (Math.abs(v.py - eaveTop) < MATCH_TOL) {
    level = 'Eave height (top of uprights)'
    levelFormula = 'baseplateTop + specs.eaveHeight'
  } else if (Math.abs(v.py - ridgeTop) < MATCH_TOL) {
    level = 'Ridge height (apex)'
    levelFormula = 'baseplateTop + specs.ridgeHeight'
  } else if (Math.abs(v.py) < MATCH_TOL) {
    level = 'Floor level (Y=0)'
    levelFormula = '0'
  } else if (v.py > baseplateTop && v.py < eaveTop) {
    const pct = Math.round(((v.py - baseplateTop) / specs.eaveHeight) * 100)
    const offset = roundTo4(v.py - baseplateTop)
    level = `${pct}% up the upright (${offset}m above baseplate)`
    levelFormula = `baseplateTop + ${offset}`
  } else if (v.py > eaveTop && v.py < ridgeTop) {
    const offset = roundTo4(v.py - eaveTop)
    level = `${offset}m above eave (in arch zone)`
    levelFormula = `baseplateTop + specs.eaveHeight + ${offset}`
  } else if (v.py < baseplateTop) {
    level = `${roundTo4(baseplateTop - v.py)}m below baseplate`
    levelFormula = `baseplateTop - ${roundTo4(baseplateTop - v.py)}`
  } else {
    level = `${roundTo4(v.py - ridgeTop)}m above ridge`
    levelFormula = `baseplateTop + specs.ridgeHeight + ${roundTo4(v.py - ridgeTop)}`
  }

  // ── Z axis (frame line) ────────────────────────────────────────────────
  let frameLine: string
  let frameLineFormula: string

  const lineMatch = lineZs.findIndex(z => Math.abs(v.pz - z) < MATCH_TOL)
  if (lineMatch !== -1) {
    const isFirst = lineMatch === 0
    const isLast = lineMatch === lineZs.length - 1
    const endLabel = isFirst ? ' (front gable)' : isLast ? ' (back gable)' : ''
    frameLine = `Frame line ${lineMatch}${endLabel} at Z=${lineZs[lineMatch]}m`
    frameLineFormula = `lineZs[${lineMatch}]  // bay ${lineMatch} × specs.bayDistance − halfLength`
  } else if (Math.abs(v.pz) < MATCH_TOL) {
    frameLine = 'Center Z (midpoint of tent length)'
    frameLineFormula = '0'
  } else if (Math.abs(v.pz - (-halfLength)) < MATCH_TOL) {
    frameLine = 'Front end'
    frameLineFormula = '-halfLength'
  } else if (Math.abs(v.pz - halfLength) < MATCH_TOL) {
    frameLine = 'Back end'
    frameLineFormula = 'halfLength'
  } else {
    // Check if between two frame lines
    let betweenDesc = ''
    for (let i = 0; i < lineZs.length - 1; i++) {
      if (v.pz >= lineZs[i] - MATCH_TOL && v.pz <= lineZs[i + 1] + MATCH_TOL) {
        const offset = roundTo4(v.pz - lineZs[i])
        betweenDesc = `Between frame lines ${i} and ${i + 1} (+${offset}m from line ${i})`
        break
      }
    }
    frameLine = betweenDesc || `Z=${v.pz}m (${v.pz < 0 ? 'front' : 'back'} half)`
    frameLineFormula = `${v.pz}`
  }

  // ── Rotation (orientation) ─────────────────────────────────────────────
  const orientParts: string[] = []
  const rx = radToDeg(v.rx)
  const ry = radToDeg(v.ry)
  const rz = radToDeg(v.rz)

  if (Math.abs(rx) < 0.5 && Math.abs(ry) < 0.5 && Math.abs(rz) < 0.5) {
    orientParts.push('No rotation (default orientation)')
  } else {
    if (Math.abs(rx) >= 0.5) {
      if (Math.abs(rx - 90) < 1) orientParts.push('Pitch: +90deg (tilted forward)')
      else if (Math.abs(rx + 90) < 1) orientParts.push('Pitch: -90deg (tilted backward)')
      else if (Math.abs(Math.abs(rx) - 180) < 1) orientParts.push('Pitch: 180deg (flipped)')
      else orientParts.push(`Pitch: ${rx}deg`)
    }
    if (Math.abs(ry) >= 0.5) {
      if (Math.abs(ry - 90) < 1) orientParts.push('Yaw: +90deg (turned left)')
      else if (Math.abs(ry + 90) < 1) orientParts.push('Yaw: -90deg (turned right)')
      else if (Math.abs(Math.abs(ry) - 180) < 1) orientParts.push('Yaw: 180deg (facing opposite)')
      else orientParts.push(`Yaw: ${ry}deg`)
    }
    if (Math.abs(rz) >= 0.5) {
      if (Math.abs(rz - 90) < 1) orientParts.push('Roll: +90deg (tilted left)')
      else if (Math.abs(rz + 90) < 1) orientParts.push('Roll: -90deg (tilted right)')
      else if (Math.abs(Math.abs(rz) - 180) < 1) orientParts.push('Roll: 180deg (inverted)')
      else orientParts.push(`Roll: ${rz}deg`)
    }
  }
  const orientation = orientParts.join(' | ')

  // ── Summary ────────────────────────────────────────────────────────────
  const summary = `${side} → ${level} → ${frameLine} | ${orientation}`

  return { side, sideFormula, level, levelFormula, frameLine, frameLineFormula, orientation, summary }
}

/**
 * Describe active mirrors in human-readable terms.
 */
export function describeMirrors(mirrors: MirrorFlags): string {
  const parts: string[] = []
  if (mirrors.x) parts.push('X-mirror (left/right symmetry)')
  if (mirrors.z) parts.push('Z-mirror (front/back symmetry)')
  if (mirrors.xz) parts.push('XZ-mirror (diagonal corner)')
  if (parts.length === 0) return 'No mirrors (single instance)'
  const total = 1 + (mirrors.x ? 1 : 0) + (mirrors.z ? 1 : 0) + (mirrors.xz ? 1 : 0)
  return `${parts.join(' + ')} → ${total} total instances`
}

/**
 * Build a specs-relative formula string for a placement position,
 * suitable for pasting into component code.
 */
export function buildSpecsFormula(
  v: TransformValues,
  specs: TentSpecs,
  numBays: number,
  baseplateTop: number,
  lineZs: number[],
): { xFormula: string; yFormula: string; zFormula: string } {
  const ctx = analyzePosition(v, specs, numBays, baseplateTop, lineZs)
  return {
    xFormula: ctx.sideFormula,
    yFormula: ctx.levelFormula,
    zFormula: ctx.frameLineFormula,
  }
}
