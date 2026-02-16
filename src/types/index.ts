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
