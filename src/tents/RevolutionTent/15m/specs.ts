import type { TentSpecs } from '@/types'

export const TENT_TYPE = 'RevolutionTent'
export const VARIANT = '15m'

export const TENT_SPECS: TentSpecs = {
  name: 'Revolution Tent 15m',
  width: 15,
  halfWidth: 7.5,
  eaveHeight: 3.2,
  ridgeHeight: 5.1,
  bayDistance: 5,
  archOuterSpan: 7.6,
  profiles: {
    upright: { width: 0.2, height: 0.1 },
    rafter: { width: 0.2, height: 0.1 },
    gableColumn: { width: 0.12, height: 0.08 },
    eaveBeam: { width: 0.12, height: 0.08 },
    gableBeam: { width: 0.12, height: 0.08 },
    mainPurlin: { width: 0.08, height: 0.12 },
    intermediatePurlin: { width: 0.06, height: 0.06 },
  },
  baseplate: {
    width: 0.45,
    depth: 0.35,
    thickness: 0.012,
    height: 0.30,
  },
  gableSupportPositions: [-2.5, 2.5],
  mainPurlinX: [-2.5, 2.5],
  intermediatePurlinX: [-5, -1.25, 0, 1.25, 5],
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
  return numBays * specs.bayDistance
}
