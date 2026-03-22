import type { TentSpecs } from '@/types'
import { getFramePath, getConnectorsPath, getCoversPath } from '@/lib/constants/assetPaths'

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '20m'

/**
 * Premium Arch Tent 20m — from Arch Tent Technical Data PDF (page 4).
 *
 * Eave height:  4.26 m
 * Ridge height: 6.90 m
 * Profiles:     same group as 15m (212×112×6 main, 127×76×3 secondary)
 */
export const TENT_SPECS: TentSpecs = {
	name: 'Premium Arch Tent 20m',
	width: 20,
	halfWidth: 10,
	eaveHeight: 4.26,
	ridgeHeight: 6.9,
	bayDistance: 5,
	archOuterSpan: 10.141,
	rafterSlopeAtEave: 0.3116,
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
	connectorPlate: {
		length: 0.424,
		height: 0.212,
		depth: 0.112,
		thickness: 0.008,
	},
	gableSupportPositions: [-5, 0, 5],
	mainPurlinX: [-5, 0, 5],
	intermediatePurlinX: [-7.5, -5, -2.5, 0, 2.5, 5, 7.5],
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
	return numBays * specs.bayDistance
}

// 20m shares the same upright profile (212×112) as 15m — reuse 15m GLBs
export const FRAME_PATH = getFramePath(TENT_TYPE, '15m')
export const CONNECTORS_PATH = getConnectorsPath(TENT_TYPE, VARIANT)
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
