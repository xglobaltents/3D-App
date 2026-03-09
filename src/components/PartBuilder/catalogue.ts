import { Color3, Vector3 } from '@babylonjs/core'
import type { TentSpecs } from '@/types'
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
  label: string
  folder: string
  file: string
  /** Returns the real frame position for this part based on tent geometry */
  getDefaultPosition?: (ctx: DefaultPositionContext) => DefaultPosition
}

export const GLB_PARTS: GLBOption[] = [
  {
    label: 'Upright Connector R',
    folder: '/tents/SharedFrames/',
    file: 'upright-connector-r.glb',
    getDefaultPosition: ({ specs, baseplateTop, firstLineZ }) => {
      // Mirror UprightConnectors.tsx placement exactly (right-side, first frame line)
      const plate = specs.connectorPlate ?? { length: 0.424, height: 0.212, depth: 0.112 }
      const slope = specs.rafterSlopeAtEave ?? 0
      const xInset = plate.length + plate.depth / 2
      const yPos = baseplateTop + specs.eaveHeight + slope * (xInset + specs.profiles.upright.width / 2)
      const rollAngle = Math.atan(slope * plate.depth / plate.length)
      return {
        x: -(specs.halfWidth - xInset),
        y: yPos,
        z: firstLineZ,
        rx: Math.PI,   // pitch — matches right-side connector orientation
        rz: rollAngle, // roll — matches rafter slope at eave
      }
    },
  },
  {
    label: 'Connector Triangle',
    folder: '/tents/SharedFrames/',
    file: 'connector-triangle.glb',
    getDefaultPosition: ({ specs, baseplateTop, firstLineZ }) => ({
      // Triangle connector at eave junction
      x: -specs.halfWidth,
      y: baseplateTop + specs.eaveHeight,
      z: firstLineZ,
    }),
  },
  {
    label: 'Eave Side Beam',
    folder: '/tents/SharedFrames/',
    file: 'eave-side-beam.glb',
    getDefaultPosition: ({ specs, baseplateTop }) => ({
      // Eave beam runs along the tent side at eave height, centered along Z
      x: specs.halfWidth,
      y: baseplateTop + specs.eaveHeight,
      z: 0,
    }),
  },
  {
    label: 'Gable Support 77x127',
    folder: '/tents/SharedFrames/',
    file: 'gable-support-77x127.glb',
    getDefaultPosition: ({ specs, baseplateTop, firstLineZ }) => ({
      // Gable support at first gable position, standing on baseplate at front gable
      x: specs.gableSupportPositions[0] ?? -2.5,
      y: baseplateTop,
      z: firstLineZ,
    }),
  },
  {
    label: 'Gable Beam 80x150',
    folder: '/tents/SharedFrames/',
    file: 'gable-beam-80x150.glb',
    getDefaultPosition: ({ specs, baseplateTop, firstLineZ }) => ({
      // Gable beam sits at eave height at the gable end, centered on X
      x: 0,
      y: baseplateTop + specs.eaveHeight,
      z: firstLineZ,
    }),
  },
  {
    label: 'Baseplates',
    folder: '/tents/SharedFrames/',
    file: 'basePlates.glb',
    getDefaultPosition: ({ specs, firstLineZ }) => ({
      // Baseplate on the ground at the right-side first frame line
      x: specs.halfWidth,
      y: 0,
      z: firstLineZ,
    }),
  },
  {
    label: 'Upright 15m',
    folder: '/tents/PremiumArchTent/15m/frame/',
    file: 'upright.glb',
    getDefaultPosition: ({ specs, baseplateTop, firstLineZ }) => ({
      // Upright stands on baseplate at the right-side first frame line
      x: specs.halfWidth,
      y: baseplateTop,
      z: firstLineZ,
    }),
  },
]

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
