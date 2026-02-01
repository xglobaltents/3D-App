import type { TentSpecs } from '../../../types'

/**
 * Premium Arch Tent 15m Specifications
 * All dimensions in meters unless noted
 * 
 * Coordinate system: Z-up (X=width, Y=length, Z=height)
 */
export const TENT_SPECS: TentSpecs = {
  name: 'Premium Arch Tent 15m',

  // Main dimensions
  width: 15,
  halfWidth: 7.5,
  eaveHeight: 3.2,
  ridgeHeight: 5.1,
  bayDistance: 5.0,

  // Arch geometry
  archOuterSpan: 7.606, // halfWidth + mainProfileWidth/2

  // Profile dimensions (mm → m)
  profiles: {
    upright:            { width: 0.212, height: 0.112 },
    rafter:             { width: 0.212, height: 0.112 },
    gableColumn:        { width: 0.127, height: 0.076 },
    eaveBeam:           { width: 0.127, height: 0.076 },
    gableBeam:          { width: 0.127, height: 0.076 },
    mainPurlin:         { width: 0.076, height: 0.125 },
    intermediatePurlin: { width: 0.060, height: 0.060 },
  },

  // Baseplate dimensions (mm → m)
  baseplate: {
    width: 0.450,
    depth: 0.350,
    thickness: 0.012,
  },

  // Component positions (X coordinates)
  gableSupportPositions: [-2.5, 2.5],
  mainPurlinX: [-2.5, 2.5],
  intermediatePurlinX: [-5.0, -1.25, 0, 1.25, 5.0],
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Get arch height at a given X position
 */
export function getArchHeightAtX(x: number, specs: TentSpecs = TENT_SPECS): number {
  const normalizedX = Math.abs(x) / specs.archOuterSpan
  const clampedX = Math.min(1, normalizedX)
  const angle = Math.acos(clampedX)
  return specs.eaveHeight + (specs.ridgeHeight - specs.eaveHeight) * Math.sin(angle)
}

/**
 * Get bay Y positions (0, 5, 10, 15... for numBays=3)
 */
export function getBayPositions(numBays: number, specs: TentSpecs = TENT_SPECS): number[] {
  return Array.from({ length: numBays + 1 }, (_, i) => i * specs.bayDistance)
}

/**
 * Get tent total length
 */
export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
  return numBays * specs.bayDistance
}

// ─── Asset Paths for this tent ───────────────────────────────────────────────

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '15m'
export const FRAME_PATH = `/tents/${TENT_TYPE}/${VARIANT}/frame/`
export const CONNECTORS_PATH = `/tents/${TENT_TYPE}/${VARIANT}/frame/connectors/`
export const COVERS_PATH = `/tents/${TENT_TYPE}/${VARIANT}/covers/`
