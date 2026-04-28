import type { TentSpecs } from '@/types'
import { getFramePath, getCoversPath } from '@/lib/constants/assetPaths'
import { makeArchHeightFn } from '@/lib/utils/archMath'
import { SHARED_EAVE_BEAM_PROFILE } from '@/lib/constants/profileDefaults'

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '10m'

/**
 * Premium Arch Tent 10m — from "10 Mtr. Wide Arch Tent Technical Data" PDF.
 *
 * Clear-Span Width: 10 m
 * Eave Height:      3.2 m
 * Ridge Height:     4.7 m
 * Bay Distance:     5 m
 * Main Profile:     127 × 76 × 3 mm (4-Channel) — uprights, rafters, gable members
 * Eave Beam:        160 × 140 mm
 * Purlin:           60 × 60
 * Material:         Hard-pressed extruded aluminum 6082 / T6
 */

export const TENT_SPECS: TentSpecs = {
	name: 'Premium Arch Tent 10m',
	width: 10,
	halfWidth: 5,
	eaveHeight: 3.2,
	ridgeHeight: 4.7,
	bayDistance: 5,
	// archOuterSpan scales with width (15m uses 7.606 for halfWidth 7.5 → ratio ≈ 1.0141)
	archOuterSpan: 5.0707,
	rafterSlopeAtEave: 0.2977,
	getArchHeightAtEave: makeArchHeightFn(5.0707, 3.2, 4.7),
	profiles: {
		// 10m keeps the smaller 127×76×3 profile for uprights, rafters, and gable members.
		upright: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
		rafter: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
		gableColumn: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
		eaveBeam: SHARED_EAVE_BEAM_PROFILE,
		gableBeam: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
		mainPurlin: { width: 0.06, height: 0.06 },
		intermediatePurlin: { width: 0.06, height: 0.06 },
	},
	baseplate: {
		width: 0.45,
		depth: 0.35,
		thickness: 0.012,
		height: 0.30,
	},
	// Per PDF elevation: one mid gable column at center
	gableSupportPositions: [0],
	mainPurlinX: [0],
	intermediatePurlinX: [-3.75, -2.5, -1.25, 1.25, 2.5, 3.75],
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
	return numBays * specs.bayDistance
}

// Reuse 15m GLBs as placeholders — visual proportions differ (uprights are smaller in real 10m)
export const FRAME_PATH = getFramePath(TENT_TYPE, '15m')
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
