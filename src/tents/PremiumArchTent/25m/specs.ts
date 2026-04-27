import type { TentSpecs } from '@/types'
import { getFramePath, getCoversPath } from '@/lib/constants/assetPaths'
import { makeArchHeightFn } from '@/lib/utils/archMath'

export const TENT_TYPE = 'PremiumArchTent'
export const VARIANT = '25m'

/**
 * Premium Arch Tent 25m — from "25 Mtr. Wide Arch Tent Technical Data" PDF.
 *
 * Clear-Span Width: 25 m
 * Eave Height:      4.26 m
 * Ridge Height:     7.7 m
 * Bay Distance:     5 m  (elevation shows 5 × 5 m segments)
 * Main Profile:     212 × 112 × 4 mm (4-Channel) — uprights & rafters
 * Gable / beams:    127 × 76 (4-channel)
 * Main Purlin:      76 × 125
 * Intermediate:     60 × 60
 */

export const TENT_SPECS: TentSpecs = {
	name: 'Premium Arch Tent 25m',
	width: 25,
	halfWidth: 12.5,
	eaveHeight: 4.26,
	ridgeHeight: 7.7,
	bayDistance: 5,
	// archOuterSpan scales with width (15m: 7.606 / 7.5 ≈ 1.0141)
	archOuterSpan: 12.6766,
	rafterSlopeAtEave: 0.2977,
	getArchHeightAtEave: makeArchHeightFn(12.6766, 4.26, 7.7),
	profiles: {
		upright: { width: 0.212, height: 0.112, wallThickness: 0.004, channels: 4 },
		rafter: { width: 0.212, height: 0.112, wallThickness: 0.004, channels: 4 },
		gableColumn: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
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
	// PDF elevation: 5 equal segments → 4 intermediate gable columns at ±2.5, ±7.5
	gableSupportPositions: [-7.5, -2.5, 2.5, 7.5],
	mainPurlinX: [-7.5, -2.5, 2.5, 7.5],
	intermediatePurlinX: [-10, -5, 0, 5, 10],
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
	return numBays * specs.bayDistance
}

// Reuse 15m GLBs (same 212×112 main profile)
export const FRAME_PATH = getFramePath(TENT_TYPE, '15m')
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
