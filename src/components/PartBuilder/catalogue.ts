import { Color3, Matrix, Quaternion, Vector3 } from '@babylonjs/core'
import type { TentSpecs } from '@/types'
import { getFramePath, getSharedFramePath } from '@/lib/constants/assetPaths'
import type { TentType, TentVariant } from '@/lib/constants/assetPaths'
import type { MirrorConfig } from './types'
import {
  type GLBPartRegistry,
  type ScaleContext,
  computePartScale,
  getAxisLabels,
  BASEPLATE_REG,
  UPRIGHT_REG,
  EAVE_SIDE_BEAM_REG,
  GABLE_BEAM_REG,
  GABLE_SUPPORT_REG,
} from '@/lib/constants/glbRegistry'
import { getPartCalibrationScale } from '@/lib/constants/partCalibrations'

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
   * @deprecated Prefer registry + initialAxisScale for per-axis scaling.
   */
  defaultScale?: number
  /**
   * Per-axis initial scale computed from the GLB registry + specs.
   * When present, overrides defaultScale with correct profile-derived values.
   */
  initialAxisScale?: { x: number; y: number; z: number }
  /**
   * Model-level rotation applied to the modelNode.
   * Overrides the default GLTF handedness rotation (y = PI).
   * Each part may need a different orientation based on how the GLB was authored.
   * See docs/parts/*.md for per-part rationale.
   */
  modelRotation?: { x: number; y: number; z: number }
  /** Returns the real frame position for this part based on tent geometry */
  getDefaultPosition?: (ctx: DefaultPositionContext) => DefaultPosition
  /** Registry entry linking this part to its RAW extents + axis mapping */
  registry?: GLBPartRegistry
  /** Human-readable per-axis labels describing what each scale axis controls */
  axisLabels?: { x: string; y: string; z: string }
}

/* ─── Shared parts — same GLBs for all tent types/sizes ───────────────────── */

const SHARED = getSharedFramePath()

function getSharedParts(specs: TentSpecs): GLBOption[] {
  const scaleCtx: ScaleContext = {
    profiles: specs.profiles,
    bayDistance: specs.bayDistance,
    eaveHeight: specs.eaveHeight,
    tentWidth: specs.width,
    halfWidth: specs.halfWidth,
  }

  const eaveSideScale = computePartScale(EAVE_SIDE_BEAM_REG, scaleCtx)
  // Keep gable beam on registry mapping so PartBuilder matches runtime
  // component behavior (runtime uses independent X/Y profile scaling).
  const gableBeamScale = computePartScale(GABLE_BEAM_REG, scaleCtx)
  const gableSupportScale = getPartCalibrationScale('gable-support', specs)
    ?? computePartScale(GABLE_SUPPORT_REG, scaleCtx)

  const eaveSideLabels = getAxisLabels(EAVE_SIDE_BEAM_REG, scaleCtx)
  const gableBeamLabels = getAxisLabels(GABLE_BEAM_REG, scaleCtx)
  const gableSupportLabels = getAxisLabels(GABLE_SUPPORT_REG, scaleCtx)

  return [
    {
      id: 'baseplates',
      label: 'Baseplates',
      folder: SHARED,
      file: 'basePlates.glb',
      defaultScale: 0.001,
      registry: BASEPLATE_REG,
      axisLabels: { x: 'uniform', y: 'uniform', z: 'uniform' },
      // PI/2 aligns the baseplate's longer side with tent Z (length) axis
      modelRotation: { x: 0, y: Math.PI / 2, z: 0 },
      getDefaultPosition: ({ specs: s, firstLineZ }) => ({
        x: s.halfWidth,
        y: 0,
        z: firstLineZ,
      }),
    },
    {
      id: 'eave-side-beam',
      label: `Eave Side Beam (${specs.profiles.eaveBeam.width * 1000}x${specs.profiles.eaveBeam.height * 1000})`,
      folder: SHARED,
      file: 'eave-side-beam.glb',
      initialAxisScale: eaveSideScale,
      registry: EAVE_SIDE_BEAM_REG,
      axisLabels: eaveSideLabels,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, baseplateTop, firstLineZ }) => ({
        x: s.halfWidth + 0.19,
        y: baseplateTop + s.eaveHeight + 0.08,
        z: firstLineZ + s.bayDistance * 1.5,
        rz: -Math.PI,
      }),
    },
    {
      id: 'gable-beam',
      label: `Gable Beam (${specs.profiles.gableBeam.width * 1000}x${specs.profiles.gableBeam.height * 1000})`,
      folder: SHARED,
      file: 'gable-beam-80x150.glb',
      initialAxisScale: gableBeamScale,
      registry: GABLE_BEAM_REG,
      axisLabels: gableBeamLabels,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, baseplateTop, firstLineZ }) => ({
        x: 0,
        y: baseplateTop + s.eaveHeight + 0.06,
        z: firstLineZ,
        ry: Math.PI / 2,
      }),
    },
    {
      id: 'gable-support',
      label: `Gable Support (${specs.profiles.gableColumn.width * 1000}x${specs.profiles.gableColumn.height * 1000})`,
      folder: SHARED,
      file: 'gable-support-77x127.glb',
      initialAxisScale: gableSupportScale,
      registry: GABLE_SUPPORT_REG,
      axisLabels: gableSupportLabels,
      modelRotation: { x: 0, y: Math.PI, z: 0 },
      getDefaultPosition: ({ specs: s, baseplateTop, firstLineZ }) => ({
        x: s.gableSupportPositions[0] ?? -2.5,
        y: baseplateTop,
        z: firstLineZ,
        rx: Math.PI / 2,
        ry: Math.PI / 2,
      }),
    },
  ]
}

/* ─── Per-variant parts — GLBs specific to tent type + size ───────────────── */

function getVariantParts(specs: TentSpecs, tentType: TentType, variant: TentVariant): GLBOption[] {
  const framePath = getFramePath(tentType, variant)
  const uprightFolder = tentType === 'PremiumArchTent' ? SHARED : framePath
  const parts: GLBOption[] = []

  // Upright — per-variant because profile cross-section is baked into GLB geometry
  const scaleCtx: ScaleContext = {
    profiles: specs.profiles,
    bayDistance: specs.bayDistance,
    eaveHeight: specs.eaveHeight,
    tentWidth: specs.width,
    halfWidth: specs.halfWidth,
  }
  const uprightScale = getPartCalibrationScale('upright', specs)
    ?? computePartScale(UPRIGHT_REG, scaleCtx)
  const uprightLabels = getAxisLabels(UPRIGHT_REG, scaleCtx)

  parts.push({
    id: 'upright',
    label: `Upright ${variant} (${specs.profiles.upright.width * 1000}x${specs.profiles.upright.height * 1000})`,
    // Premium Arch runtime currently sources mainProfile.glb from SharedFrames.
    // Keep the builder aligned with runtime so variants without a local frame folder still load.
    folder: uprightFolder,
    file: 'mainProfile.glb',
    defaultScale: 0.001,
    initialAxisScale: uprightScale,
    registry: UPRIGHT_REG,
    axisLabels: uprightLabels,
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

const MIRROR_X_MATRIX = Matrix.FromValues(
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
)

const MIRROR_Z_MATRIX = Matrix.FromValues(
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
)

const MIRROR_XZ_MATRIX = Matrix.FromValues(
  -1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, -1, 0,
  0, 0, 0, 1,
)

function wrapRadians(angle: number): number {
  const wrapped = ((angle + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI
  if (Math.abs(wrapped) < 1e-6) return 0
  if (Math.abs(Math.abs(wrapped) - Math.PI) < 1e-6) return wrapped < 0 ? -Math.PI : Math.PI
  return wrapped
}

function normalizeEuler(euler: Vector3): Vector3 {
  return new Vector3(
    wrapRadians(euler.x),
    wrapRadians(euler.y),
    wrapRadians(euler.z),
  )
}

function mirrorRotation(rotation: Vector3, reflectionMatrix: Matrix): Vector3 {
  const rotationMatrix = Matrix.Identity()
  Quaternion.FromEulerAngles(rotation.x, rotation.y, rotation.z).toRotationMatrix(rotationMatrix)

  const mirroredMatrix = reflectionMatrix.multiply(rotationMatrix).multiply(reflectionMatrix)
  const mirroredEuler = Quaternion.FromRotationMatrix(mirroredMatrix).toEulerAngles()

  return normalizeEuler(mirroredEuler)
}

export const MIRROR_CONFIGS: MirrorConfig[] = [
  {
    axis: 'x',
    short: 'X',
    color: new Color3(0.2, 0.7, 0.9),
    desc: 'Left / Right',
    posFn: (p) => new Vector3(-p.x, p.y, p.z),
    rotFn: (r) => mirrorRotation(r, MIRROR_X_MATRIX),
  },
  {
    axis: 'z',
    short: 'Z',
    color: new Color3(0.3, 0.85, 0.4),
    desc: 'Front / Back',
    posFn: (p) => new Vector3(p.x, p.y, -p.z),
    rotFn: (r) => mirrorRotation(r, MIRROR_Z_MATRIX),
  },
  {
    axis: 'xz',
    short: 'XZ',
    color: new Color3(0.7, 0.3, 0.85),
    desc: 'Diagonal corner',
    posFn: (p) => new Vector3(-p.x, p.y, -p.z),
    rotFn: (r) => mirrorRotation(r, MIRROR_XZ_MATRIX),
  },
]
