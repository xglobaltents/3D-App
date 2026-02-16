import type { TentSpecs } from '@/types'
import { getFramePath, getConnectorsPath, getCoversPath } from '@/lib/constants/assetPaths'

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '15m'

export const TENT_SPECS: TentSpecs = {
	name: 'Premium Arch Tent 15m',
	width: 15,
	halfWidth: 7.5,
	eaveHeight: 3.2,
	ridgeHeight: 5.1,
	bayDistance: 5,
	archOuterSpan: 7.606,
	profiles: {
		upright: { width: 0.212, height: 0.112 },
		rafter: { width: 0.212, height: 0.112 },
		gableColumn: { width: 0.127, height: 0.076 },
		eaveBeam: { width: 0.127, height: 0.076 },
		gableBeam: { width: 0.127, height: 0.076 },
		mainPurlin: { width: 0.076, height: 0.125 },
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

export const FRAME_PATH = getFramePath(TENT_TYPE, VARIANT)
export const CONNECTORS_PATH = getConnectorsPath(TENT_TYPE, VARIANT)
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
