import type { TentSpecs } from '@/types'
import { getFramePath, getCoversPath } from '@/lib/constants/assetPaths'
import { makeArchHeightFn } from '@/lib/utils/archMath'
import { SHARED_EAVE_BEAM_PROFILE } from '@/lib/constants/profileDefaults'

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '50m'

/**
 * Premium Arch Tent 50m — standard variant from the
 * "50 Mtr. Wide Arch Tent Technical Data" PDF.
 *
 * Clear-Span Width: 50 m
 * Eave Height:      4.25 m
 * Ridge Height:     11.4 m
 * Bay Distance:     5 m  (elevation: 10 × 5 m segments)
 * Main Profile:     321 × 112 × 9 & 6 mm (4-Channel) — uprights & rafters
 * Gable Column:     212 × 112 (4-channel)
 * Gable Beam:       127 × 76  (4-channel)
 * Eave Beam:        160 × 140 (4-channel)
 * Main Purlin:      76 × 125
 * Intermediate:     60 × 60
 */

export const TENT_SPECS: TentSpecs = {
	name: 'Premium Arch Tent 50m',
	width: 50,
	halfWidth: 25,
	eaveHeight: 4.25,
	ridgeHeight: 11.4,
	bayDistance: 5,
	archCrownHalfSpan: 5,
	archOuterSpan: 25.354,
	rafterSlopeAtEave: 0.2977,
	getArchHeightAtEave: makeArchHeightFn(25.354, 4.25, 11.4),
	profiles: {
		upright: { width: 0.321, height: 0.112, wallThickness: 0.009, channels: 4 },
		rafter: { width: 0.321, height: 0.112, wallThickness: 0.009, channels: 4 },
		gableColumn: { width: 0.212, height: 0.112, wallThickness: 0.004, channels: 4 },
		eaveBeam: SHARED_EAVE_BEAM_PROFILE,
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
	// 10 bays on a 5m grid -> 9 intermediate gable columns at -20, -15, -10, -5, 0, 5, 10, 15, 20
	gableSupportPositions: [-20, -15, -10, -5, 0, 5, 10, 15, 20],
	mainPurlinX: [-22.5, -17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5, 22.5],
	intermediatePurlinX: [-22.5, -17.5, -12.5, -7.5, -2.5, 2.5, 7.5, 12.5, 17.5, 22.5],
}

export const TENT_SPECS_6M: TentSpecs = {
	...TENT_SPECS,
	name: 'Premium Arch Tent 50m (6m Eave)',
	eaveHeight: 6,
	ridgeHeight: 13.15,
	getArchHeightAtEave: makeArchHeightFn(25.354, 6, 13.15),
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
	return numBays * specs.bayDistance
}

export const FRAME_PATH = getFramePath(TENT_TYPE, '15m')
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
