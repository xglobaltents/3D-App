import { Vector3 } from '@babylonjs/core'

// ─── Tent Types ──────────────────────────────────────────────────────────────

export interface TentSpecs {
  name: string
  width: number
  halfWidth: number
  eaveHeight: number
  ridgeHeight: number
  bayDistance: number
  archOuterSpan: number
  /**
   * Tangent of the rafter angle at the eave (rise/run of the straight
   * rafter section).  Used to compute the miter-cut drop on the top of
   * each upright so the connector surface matches the arch slope.
   *
   * Formula:  slope = shoulderHeight / (halfWidth − archCurveHalfWidth)
   * 15 m → 0.2977  (16.58°)   20 m → 0.3116  (17.31°)
   */
  rafterSlopeAtEave?: number
  profiles: ProfileSpecs
  baseplate: BaseplateSpecs
  gableSupportPositions: number[]
  mainPurlinX: number[]
  intermediatePurlinX: number[]
}

export interface ProfileSpecs {
  upright: ProfileDimension
  rafter: ProfileDimension
  gableColumn: ProfileDimension
  eaveBeam: ProfileDimension
  gableBeam: ProfileDimension
  mainPurlin: ProfileDimension
  intermediatePurlin: ProfileDimension
}

export interface ProfileDimension {
  width: number
  height: number
}

export interface BaseplateSpecs {
  width: number
  depth: number
  thickness: number
  /** Visual height of the full baseplate assembly (plate + flanges) after uniform scaling. */
  height: number
}

// ─── Component Props ─────────────────────────────────────────────────────────

export interface TentComponentProps {
  numBays: number
  showFrame?: boolean
  showCovers?: boolean
  position?: Vector3
}

export interface FrameComponentProps {
  numBays: number
  specs: TentSpecs
}

export interface CoverComponentProps {
  numBays: number
  tentLength: number
  specs: TentSpecs
}

// ─── Accessory Types ─────────────────────────────────────────────────────────

export interface AccessoryConfig {
  type: string
  position?: Vector3
  rotation?: Vector3
  options?: Record<string, unknown>
}

export interface AccessoryComponentProps {
  tentSpecs: TentSpecs
  config: AccessoryConfig
}

// ─── App Config ──────────────────────────────────────────────────────────────

export interface TentConfig {
  tentType: string
  variant: string
  numBays: number
  showFrame: boolean
  showCovers: boolean
  accessories: AccessoryConfig[]
}
