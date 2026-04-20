/**
 * Centralized GLB Part Registry
 *
 * Single source of truth for RAW extents and axis roles of every shared GLB.
 * Both PartBuilder (catalogue.ts) and frame components import from here.
 *
 * Each axis has a ROLE that describes its structural purpose:
 *   - profileWidth / profileHeight — cross-section dimensions from specs
 *   - length — parametric dimension (bayDistance, eaveHeight, tentWidth, etc.)
 *   - fixed — calibrated scale value (for assemblies with non-uniform cross-sections)
 *   - base — uniform mm→m conversion (0.001)
 *
 * Scale formula:  scale = specsTargetDimension / rawExtent
 *
 * For profile axes, the nominalProfile documents the physical profile size
 * (in meters) that the GLB was designed for (from the GLB filename).
 * When target profile differs from nominal, the correction ratio is:
 *   correctedScale = (target / raw) — which equals baseScale × (target / nominal)
 */

import type { ProfileSpecs } from '@/types'

/* ─── Types ───────────────────────────────────────────────────────────────── */

export type ParametricSource = 'bayDistance' | 'eaveHeight' | 'tentWidth' | 'halfWidth'

/**
 * Describes the structural role of a GLB axis.
 *
 * profileWidth  — This axis represents the profile's wider dimension (e.g. 127mm flange-to-flange).
 * profileHeight — This axis represents the profile's narrower dimension (e.g. 76mm web depth).
 * length        — This axis is the part's main length, scaled parametrically.
 * fixed         — Calibrated scale value (for assemblies whose cross-section can't be derived from profile).
 * base          — Uniform mm→m base conversion (0.001). Used for parts with no profile (baseplates).
 */
export type AxisRole =
  | { type: 'profileWidth' }
  | { type: 'profileHeight' }
  | { type: 'length'; source: ParametricSource }
  | { type: 'fixed'; scale: number }
  | { type: 'base' }

export interface AxisEntry {
  role: AxisRole
  /** RAW extent of this axis in GLB native units (typically mm). */
  raw: number
}

export interface GLBPartRegistry {
  /** Human-readable part name */
  name: string
  /** Profile key in specs.profiles (null for parts like baseplates with no profile) */
  profileKey: keyof ProfileSpecs | null
  /**
   * The physical profile this GLB was designed for (in meters).
   * Derived from the GLB filename (e.g. gable-beam-80x150.glb → 0.150×0.080m).
   * Used for documentation and ratio-based reasoning in PartBuilder.
   */
  nominalProfile?: { width: number; height: number }
  /** Per-axis: structural role + raw extent */
  axes: {
    x: AxisEntry
    y: AxisEntry
    z: AxisEntry
  }
  /**
   * Optional: RAW Y-axis origin offset in native units (for GLBs whose
   * origin isn't at the geometric center/bottom).
   */
  rawOriginOffsetY?: number
}

// Legacy alias — avoid breaking PartBuilder until mapping panel is updated
/** @deprecated Use AxisRole instead */
export type AxisTarget = AxisRole

/* ─── Registry Entries ────────────────────────────────────────────────────── */

/**
 * Baseplates — scanned model, uniform scale.
 * Profile: none (baseplate is a scanned assembly, not an extruded profile)
 * Scaling: uniform 0.001 (mm→m)
 */
export const BASEPLATE_REG: GLBPartRegistry = {
  name: 'Baseplate',
  profileKey: null,
  axes: {
    x: { role: { type: 'base' }, raw: 1 },
    y: { role: { type: 'base' }, raw: 1 },
    z: { role: { type: 'base' }, raw: 1 },
  },
}

/**
 * Upright — per-variant GLB (profile 212×112 baked into geometry).
 * Nominal profile from specs: 212×112mm.
 * The upright GLB is Z-up, so after rotation.x = -PI/2:
 *   GLB X → world X (profile width = wider face)
 *   GLB Z → world Y (height = eaveHeight)
 *   GLB Y → world Z (profile height = narrower face)
 */
export const UPRIGHT_REG: GLBPartRegistry = {
  name: 'Upright',
  profileKey: 'upright',
  nominalProfile: { width: 0.212, height: 0.112 },
  axes: {
    x: { role: { type: 'profileWidth' }, raw: 212 },
    y: { role: { type: 'profileHeight' }, raw: 112 },
    z: { role: { type: 'length', source: 'eaveHeight' }, raw: 3200 },
  },
}

/**
 * Upright Connector — shared GLB (upright-connector-r.glb).
 * No profile — dimensions come from connectorPlate specs.
 *   GLB X → connectorPlate.depth   (raw 315.7)
 *   GLB Y → connectorPlate.height  (raw 577.2)
 *   GLB Z → connectorPlate.length  (raw 196.0)
 */
export const UPRIGHT_CONNECTOR_REG: GLBPartRegistry = {
  name: 'Upright Connector',
  profileKey: 'upright',
  axes: {
    x: { role: { type: 'fixed', scale: 0 }, raw: 315.7 },
    y: { role: { type: 'fixed', scale: 0 }, raw: 577.2 },
    z: { role: { type: 'fixed', scale: 0 }, raw: 196.0 },
  },
  rawOriginOffsetY: 10.89,
}

/**
 * Connector Triangle — shared GLB.
 * Uses the GLTF root's non-uniform authored scale on load (x/y ~= 0.0003055,
 * z = 0.001), plus a validated frame placement contract.
 */
export const CONNECTOR_TRIANGLE_REG: GLBPartRegistry = {
  name: 'Connector Triangle',
  profileKey: null,
  axes: {
    x: { role: { type: 'base' }, raw: 1 },
    y: { role: { type: 'base' }, raw: 1 },
    z: { role: { type: 'base' }, raw: 1 },
  },
}

/**
 * Eave Side Beam — shared GLB (assembly with end plates, 127×76 profile).
 * Nominal profile: 127×76mm eaveBeam.
 * Cross-section is a complex assembly — can't derive scale from profile alone.
 *   GLB X = cross-section  (raw 1190)  → fixed (calibrated 0.0001479)
 *   GLB Y = cross-section  (raw 1048)  → fixed (calibrated 0.0001479)
 *   GLB Z = beam length    (raw 50)    → parametric with bayDistance
 */
export const EAVE_SIDE_BEAM_REG: GLBPartRegistry = {
  name: 'Eave Side Beam',
  profileKey: 'eaveBeam',
  nominalProfile: { width: 0.127, height: 0.076 },
  axes: {
    x: { role: { type: 'fixed', scale: 0.0001479 }, raw: 1190 },
    y: { role: { type: 'fixed', scale: 0.0001479 }, raw: 1048 },
    z: { role: { type: 'length', source: 'bayDistance' }, raw: 50 },
  },
}

/**
 * Gable Eave Beam — shared GLB (gable-beam-80x150.glb).
 * Nominal profile: 150×80mm (filename convention: HxW → 80mm height × 150mm width).
 * Target profile: gableBeam from specs (127×76mm for 15m tent).
 *
 * Raw extents from vertex buffer (clone loses Node 4 parent transform):
 *   GLB X = profile HEIGHT face  (raw 435)  → narrower face of cross-section
 *   GLB Y = profile WIDTH face   (raw 809)  → wider face of cross-section
 *   GLB Z = beam LENGTH          (raw 50)   → length scales with tentWidth
 */
export const GABLE_BEAM_REG: GLBPartRegistry = {
  name: 'Gable Eave Beam',
  profileKey: 'gableBeam',
  nominalProfile: { width: 0.150, height: 0.080 },
  axes: {
    x: { role: { type: 'profileHeight' }, raw: 435 },
    y: { role: { type: 'profileWidth' }, raw: 809 },
    z: { role: { type: 'length', source: 'tentWidth' }, raw: 50 },
  },
}

/**
 * Gable Support — shared GLB (gable-support-77x127.glb).
 * Nominal profile: 127×77mm (filename convention: HxW → 77mm height × 127mm width).
 * Target profile: gableColumn from specs (127×76mm for 15m tent).
 *   GLB X = profile WIDTH face   (raw 649)   → wider face of the cross-section
 *   GLB Y = column LENGTH        (raw 6980)  → length scales with eaveHeight
 *   GLB Z = profile HEIGHT face  (raw 2.909) → narrower face (internal rotation makes raw tiny)
 */
export const GABLE_SUPPORT_REG: GLBPartRegistry = {
  name: 'Gable Support',
  profileKey: 'gableColumn',
  nominalProfile: { width: 0.127, height: 0.077 },
  axes: {
    x: { role: { type: 'profileWidth' }, raw: 649 },
    y: { role: { type: 'length', source: 'eaveHeight' }, raw: 6980 },
    z: { role: { type: 'profileHeight' }, raw: 2.909 },
  },
}

/* ─── Scale Computation ───────────────────────────────────────────────────── */

export interface ScaleContext {
  profiles: ProfileSpecs
  bayDistance: number
  eaveHeight: number
  tentWidth: number
  halfWidth: number
}

export interface ConnectorPlateCtx {
  depth: number
  height: number
  length: number
}

/** Returns true if the registry entry has any profileWidth/profileHeight axes. */
export function hasProfileAxes(reg: GLBPartRegistry): boolean {
  return [reg.axes.x, reg.axes.y, reg.axes.z].some(
    (a) => a.role.type === 'profileWidth' || a.role.type === 'profileHeight',
  )
}

/**
 * Compute per-axis scale for a part from its registry entry + specs context.
 * Returns { x, y, z } scale values ready for modelNode.scaling.
 *
 * @param swapProfileFields  When true, swaps profileWidth↔profileHeight assignments.
 *   profileWidth axes read profile.height, and vice versa.
 *   Use in PartBuilder to test alternate orientations without editing the registry.
 */
export function computePartScale(
  reg: GLBPartRegistry,
  ctx: ScaleContext,
  connectorPlate?: ConnectorPlateCtx,
  swapProfileFields?: boolean,
): { x: number; y: number; z: number } {
  function resolveAxis(axis: AxisEntry, profileKey: keyof ProfileSpecs | null): number {
    const r = axis.role
    switch (r.type) {
      case 'base':
        return 1 // caller handles uniform scaling separately
      case 'fixed':
        return r.scale
      case 'profileWidth':
      case 'profileHeight': {
        if (!profileKey) return 0.001
        const profile = ctx.profiles[profileKey]

        // Each profile axis gets: targetDimension / rawExtent.
        // profileWidth → target profile width (wider face)
        // profileHeight → target profile height (narrower face)
        // When swapped, width reads height and vice versa.
        const targetM = r.type === 'profileWidth'
          ? (swapProfileFields ? profile.height : profile.width)
          : (swapProfileFields ? profile.width : profile.height)
        return targetM / axis.raw
      }
      case 'length': {
        switch (r.source) {
          case 'bayDistance':  return ctx.bayDistance / axis.raw
          case 'eaveHeight':  return ctx.eaveHeight / axis.raw
          case 'tentWidth':   return ctx.tentWidth / axis.raw
          case 'halfWidth':   return ctx.halfWidth / axis.raw
        }
      }
    }
  }

  // Connector has special handling: targets come from connectorPlate, not profile
  if (reg === UPRIGHT_CONNECTOR_REG && connectorPlate) {
    return {
      x: connectorPlate.depth / reg.axes.x.raw,
      y: connectorPlate.height / reg.axes.y.raw,
      z: connectorPlate.length / reg.axes.z.raw,
    }
  }

  return {
    x: resolveAxis(reg.axes.x, reg.profileKey),
    y: resolveAxis(reg.axes.y, reg.profileKey),
    z: resolveAxis(reg.axes.z, reg.profileKey),
  }
}

/**
 * Get a human-readable description of what each axis scale represents.
 * Used by PartBuilder UI to show profile context next to scale sliders.
 */
export function getAxisLabels(
  reg: GLBPartRegistry,
  ctx: ScaleContext,
  connectorPlate?: ConnectorPlateCtx,
  swapProfileFields?: boolean,
): { x: string; y: string; z: string } {
  function describeAxis(axis: AxisEntry, profileKey: keyof ProfileSpecs | null): string {
    const r = axis.role
    switch (r.type) {
      case 'base':
        return 'uniform'
      case 'fixed':
        return `fixed (${r.scale})`
      case 'profileWidth': {
        if (!profileKey) return 'profile (unknown)'
        const profile = ctx.profiles[profileKey]
        const mm = swapProfileFields ? profile.height * 1000 : profile.width * 1000
        const label = swapProfileFields ? 'H' : 'W'
        return `${profileKey}.${label} (${mm}mm)`
      }
      case 'profileHeight': {
        if (!profileKey) return 'profile (unknown)'
        const profile = ctx.profiles[profileKey]
        const mm = swapProfileFields ? profile.width * 1000 : profile.height * 1000
        const label = swapProfileFields ? 'W' : 'H'
        return `${profileKey}.${label} (${mm}mm)`
      }
      case 'length': {
        const sourceLabels: Record<string, string> = {
          bayDistance: `bayDistance (${ctx.bayDistance}m)`,
          eaveHeight: `eaveHeight (${ctx.eaveHeight}m)`,
          tentWidth: `width (${ctx.tentWidth}m)`,
          halfWidth: `halfWidth (${ctx.halfWidth}m)`,
        }
        return sourceLabels[r.source] ?? r.source
      }
    }
  }

  if (reg === UPRIGHT_CONNECTOR_REG && connectorPlate) {
    return {
      x: `plate.depth (${(connectorPlate.depth * 1000).toFixed(0)}mm)`,
      y: `plate.height (${(connectorPlate.height * 1000).toFixed(0)}mm)`,
      z: `plate.length (${(connectorPlate.length * 1000).toFixed(0)}mm)`,
    }
  }

  return {
    x: describeAxis(reg.axes.x, reg.profileKey),
    y: describeAxis(reg.axes.y, reg.profileKey),
    z: describeAxis(reg.axes.z, reg.profileKey),
  }
}
