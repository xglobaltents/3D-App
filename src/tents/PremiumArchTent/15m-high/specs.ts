import type { TentSpecs } from '@/types'
import { getFramePath, getConnectorsPath, getCoversPath } from '@/lib/constants/assetPaths'

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '15m'

/**
 * Premium Arch Tent 15m — HIGH eave variant (4.26m eave).
 * Same width, bay distance, profiles, and GLBs as the standard 15m.
 * Taller uprights and higher arch.
 */
function makeArchHeightFn(archOuterSpan: number, eaveHeight: number, ridgeHeight: number) {
	const rise = ridgeHeight - eaveHeight
	const R = (archOuterSpan * archOuterSpan + rise * rise) / (2 * rise)
	const centerY = ridgeHeight - R
	return (x: number): number => {
		const ax = Math.abs(x)
		if (ax >= archOuterSpan) return eaveHeight
		return centerY + Math.sqrt(R * R - ax * ax)
	}
}

export const TENT_SPECS: TentSpecs = {
	name: 'Premium Arch Tent 15m (High Eave)',
	width: 15,
	halfWidth: 7.5,
	eaveHeight: 4.26,
	ridgeHeight: 6.2,
	bayDistance: 5,
	archOuterSpan: 7.606,
	rafterSlopeAtEave: 0.2977,
	getArchHeightAtEave: makeArchHeightFn(7.606, 4.26, 6.2),
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
	gableSupportPositions: [-2.5, 2.5],
	mainPurlinX: [-2.5, 2.5],
	intermediatePurlinX: [-5, -1.25, 0, 1.25, 5],
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
	return numBays * specs.bayDistance
}

// Reuse same GLBs as the standard 15m variant
export const FRAME_PATH = getFramePath(TENT_TYPE, VARIANT)
export const CONNECTORS_PATH = getConnectorsPath(TENT_TYPE, VARIANT)
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
