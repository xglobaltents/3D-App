import type { TentSpecs } from '@/types'
import { getFramePath, getCoversPath } from '@/lib/constants/assetPaths'
import { makeArchHeightFn } from '@/lib/utils/archMath'

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '40m'

/**
 * Premium Arch Tent 40m — standard variant from the
 * "40 Mtr. Wide Arch Tent Technical Data" PDF.
 *
 * Clear-Span Width: 40 m
 * Eave Height:      4.25 m
 * Ridge Height:     9.85 m
 * Bay Distance:     5 m  (elevation: 8 × 5 m segments)
 * Main Profile:     321 × 112 × 9 & 6 mm (4-Channel) — uprights & rafters
 * Gable Column:     212 × 112 (4-channel)
 * Eave / Gable Beam:127 × 76  (4-channel)
 * Main Purlin:      76 × 125
 * Intermediate:     60 × 60
 */

export const TENT_SPECS: TentSpecs = {
	name: 'Premium Arch Tent 40m',
	width: 40,
	halfWidth: 20,
	eaveHeight: 4.25,
	ridgeHeight: 9.85,
	bayDistance: 5,
	// archOuterSpan scales with width (15m: 7.606 / 7.5 ≈ 1.0141)
	archOuterSpan: 20.283,
	rafterSlopeAtEave: 0.2977,
	getArchHeightAtEave: makeArchHeightFn(20.283, 4.25, 9.85),
	profiles: {
		upright: { width: 0.321, height: 0.112, wallThickness: 0.009, channels: 4 },
		rafter: { width: 0.321, height: 0.112, wallThickness: 0.009, channels: 4 },
		gableColumn: { width: 0.212, height: 0.112, wallThickness: 0.004, channels: 4 },
		eaveBeam: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
		gableBeam: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
		mainPurlin: { width: 0.076, height: 0.125 },
		intermediatePurlin: { width: 0.06, height: 0.06 },
	},
	baseplate: {
		width: 0.45,
		depth: 0.35,
		thickness: 0.012,
		height: 0.30,
	},
	// 8 bays on a 5m grid -> 7 intermediate gable columns at -15, -10, -5, 0, 5, 10, 15
	gableSupportPositions: [-15, -10, -5, 0, 5, 10, 15],
	mainPurlinX: [-17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5],
	intermediatePurlinX: [-17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5],
}

export const TENT_SPECS_6M: TentSpecs = {
	...TENT_SPECS,
	name: 'Premium Arch Tent 40m (6m Eave)',
	eaveHeight: 6,
	ridgeHeight: 11.6,
	getArchHeightAtEave: makeArchHeightFn(20.283, 6, 11.6),
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
	return numBays * specs.bayDistance
}

// Reuse 15m GLBs as placeholders — visual proportions differ (321 vs 212)
export const FRAME_PATH = getFramePath(TENT_TYPE, '15m')
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
