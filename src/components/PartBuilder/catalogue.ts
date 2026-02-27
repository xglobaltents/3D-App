import { Color3, Vector3 } from '@babylonjs/core'
import type { MirrorConfig } from './types'

/* ─── GLB Part Catalogue ──────────────────────────────────────────────────── */

export interface GLBOption {
  label: string
  folder: string
  file: string
}

export const GLB_PARTS: GLBOption[] = [
  { label: 'Upright Connector R', folder: '/tents/SharedFrames/', file: 'upright-connector-r.glb' },
  { label: 'Connector Triangle', folder: '/tents/SharedFrames/', file: 'connector-triangle.glb' },
  { label: 'Eave Side Beam', folder: '/tents/SharedFrames/', file: 'eave-side-beam.glb' },
  { label: 'Gable Support 77x127', folder: '/tents/SharedFrames/', file: 'gable-support-77x127.glb' },
  { label: 'Gable Beam 80x150', folder: '/tents/SharedFrames/', file: 'gable-beam-80x150.glb' },
  { label: 'Baseplates', folder: '/tents/SharedFrames/', file: 'basePlates.glb' },
  { label: 'Upright 15m', folder: '/tents/PremiumArchTent/15m/frame/', file: 'upright.glb' },
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
