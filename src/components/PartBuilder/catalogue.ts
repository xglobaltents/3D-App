import { Color3, Vector3 } from '@babylonjs/core'
import type { TentSpecs } from '@/types'
import { getFramePath, getSharedFramePath } from '@/lib/constants/assetPaths'
import type { TentType, TentVariant } from '@/lib/constants/assetPaths'
import type { MirrorConfig } from './types'

/* ─── Default Position Context ────────────────────────────────────────────── */

export interface DefaultPositionContext {
  specs: TentSpecs
  baseplateTop: number
  halfLength: number
  firstLineZ: number
}

export interface DefaultPosition {
  x: number
  y: number
  z: number
  rx?: number
  ry?: number
  rz?: number
}

/* ─── GLB Part Catalogue ──────────────────────────────────────────────────── */

export interface GLBOption {
  /** Unique identifier for this part (stable across tent sizes for saved configs) */
  id: string
  label: string
  folder: string
  file: string
  /**
   * Explicit uniform scale to apply to the loaded model.
   * Use 0.001 for GLBs exported in millimeters (most CAD exports).
   * If omitted, falls back to auto-scale based on bounding box.
   */
  defaultScale?: number
  /**
   * Model-level rotation applied to the modelNode.
   * Overrides the default GLTF handedness rotation (y = PI).
   * Each part may need a different orientation based on how the GLB was authored.
   * See docs/parts/*.md for per-part rationale.
   */
  modelRotation?: { x: number; y: number; z: number }
  /** Returns the real frame position for this part based on tent geometry */
  getDefaultPosition?: (ctx: DefaultPositionContext) => DefaultPosition
}

/* ─── Shared parts — same GLBs for all tent types/sizes ───────────────────── */

const SHARED = getSharedFramePath()

function getSharedParts(specs: TentSpecs): GLBOption[] {
  return [
    {
      id: 'baseplates',
      label: 'Baseplates',
      folder: SHARED,
      file: 'basePlates.glb',
      defaultScale: 0.001,
      // PI/2 aligns the baseplate's longer side with tent Z (length) axis
      modelRotation: { x: 0, y: Math.PI / 2, z: 0 },
      getDefaultPosition: ({ specs: s, firstLineZ }) => ({
        x: s.halfWidth,
        y: 0,
        z: firstLineZ,
      }),
    },
    {
      id: 'upright-connector',
      label: `Upright Connector (${specs.profiles.upright.width * 1000}x${specs.profiles.upright.height * 1000})`,
      folder: SHARED,
      file: 'upright-connector-r.glb',
      defaultScale: 0.001,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, baseplateTop, firstLineZ }) => {
        const slope = s.rafterSlopeAtEave ?? 0
        const plate = s.connectorPlate ?? { length: s.profiles.upright.width * 2, depth: s.profiles.upright.height }
        const xInset = s.profiles.upright.width / 2
        return {
          x: -(s.halfWidth - xInset),
          y: baseplateTop + s.eaveHeight + slope * xInset - 0.004,
          z: firstLineZ,
          rx: Math.PI,
          rz: Math.atan(slope * plate.depth / plate.length),
        }
      },
    },
    {
      id: 'connector-triangle',
      label: 'Connector Triangle',
      folder: SHARED,
      file: 'connector-triangle.glb',
      defaultScale: 0.001,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, baseplateTop, firstLineZ }) => ({
        x: -(s.halfWidth - s.profiles.upright.width / 2),
        y: baseplateTop + s.eaveHeight - 0.190,
        z: firstLineZ,
      }),
    },
    {
      id: 'eave-side-beam',
      label: `Eave Side Beam (${specs.profiles.eaveBeam.width * 1000}x${specs.profiles.eaveBeam.height * 1000})`,
      folder: SHARED,
      file: 'eave-side-beam.glb',
      defaultScale: 0.001,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, baseplateTop }) => ({
        x: s.halfWidth,
        y: baseplateTop + s.eaveHeight - 0.090,
        z: 0,
      }),
    },
    {
      id: 'gable-beam',
      label: `Gable Beam (${specs.profiles.gableBeam.width * 1000}x${specs.profiles.gableBeam.height * 1000})`,
      folder: SHARED,
      file: 'gable-beam-80x150.glb',
      defaultScale: 0.001,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, baseplateTop, firstLineZ }) => ({
        x: 0,
        y: baseplateTop + s.eaveHeight,
        z: firstLineZ,
      }),
    },
    {
      id: 'gable-support',
      label: `Gable Support (${specs.profiles.gableColumn.width * 1000}x${specs.profiles.gableColumn.height * 1000})`,
      folder: SHARED,
      file: 'gable-support-77x127.glb',
      defaultScale: 0.001,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, firstLineZ }) => ({
        x: s.gableSupportPositions[0] ?? -2.5,
        y: 0,
        z: firstLineZ,
      }),
    },
  ]
}

/* ─── Per-variant parts — GLBs specific to tent type + size ───────────────── */

function getVariantParts(specs: TentSpecs, tentType: TentType, variant: TentVariant): GLBOption[] {
  const framePath = getFramePath(tentType, variant)
  const parts: GLBOption[] = []

  // Upright — per-variant because profile cross-section is baked into GLB geometry
  parts.push({
    id: 'upright',
    label: `Upright ${variant} (${specs.profiles.upright.width * 1000}x${specs.profiles.upright.height * 1000})`,
    folder: framePath,
    file: 'upright.glb',
    defaultScale: 0.001,
    // -PI/2 on X converts the GLB's Z-up orientation to Babylon Y-up
    modelRotation: { x: -Math.PI / 2, y: 0, z: 0 },
    getDefaultPosition: ({ specs: s, baseplateTop, firstLineZ }) => ({
      x: s.halfWidth,
      y: baseplateTop,
      z: firstLineZ,
    }),
  })

  return parts
}

/* ─── Public API ──────────────────────────────────────────────────────────── */

/**
 * Build the GLB parts catalogue for a given tent configuration.
 * All positions and labels adapt to the specs — no hardcoded measurements.
 *
 * @param specs      Active tent specs (dimensions, profiles, positions)
 * @param tentType   e.g. 'PremiumArchTent', 'RevolutionTent'
 * @param variant    e.g. '15m', '20m'
 */
export function getGLBParts(specs: TentSpecs, tentType: TentType, variant: TentVariant): GLBOption[] {
  return [
    ...getSharedParts(specs),
    ...getVariantParts(specs, tentType, variant),
  ]
}

/**
 * @deprecated Use getGLBParts(specs, tentType, variant) instead.
 * Kept temporarily for backward compat with saved configs that reference by index.
 */
export { getGLBParts as buildCatalogue }

/* ─── Mirror Configurations ───────────────────────────────────────────────── */

export const MIRROR_CONFIGS: MirrorConfig[] = [
  {
    axis: 'x',
    short: 'X',
    color: new Color3(0.2, 0.7, 0.9),
    desc: 'Left / Right',
    posFn: (p) => new Vector3(-p.x, p.y, p.z),
    rotFn: (r) => new Vector3(r.x, -r.y + Math.PI, -r.z),
  },
  {
    axis: 'z',
    short: 'Z',
    color: new Color3(0.3, 0.85, 0.4),
    desc: 'Front / Back',
    posFn: (p) => new Vector3(p.x, p.y, -p.z),
    rotFn: (r) => new Vector3(-r.x + Math.PI, r.y, -r.z),
  },
  {
    axis: 'xz',
    short: 'XZ',
    color: new Color3(0.7, 0.3, 0.85),
    desc: 'Diagonal corner',
    posFn: (p) => new Vector3(-p.x, p.y, -p.z),
    rotFn: (r) => new Vector3(-r.x + Math.PI, -r.y, r.z),
  },
]
