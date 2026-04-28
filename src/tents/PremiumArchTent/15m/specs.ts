import type { TentSpecs } from '@/types'
import { getFramePath, getCoversPath } from '@/lib/constants/assetPaths'
import { makeArchHeightFn } from '@/lib/utils/archMath'
import { SHARED_EAVE_BEAM_PROFILE } from '@/lib/constants/profileDefaults'

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
	rafterSlopeAtEave: 0.2977,
	getArchHeightAtEave: makeArchHeightFn(7.606, 3.2, 5.1),
	profiles: {
		upright: { width: 0.212, height: 0.112, wallThickness: 0.004, channels: 4 },
		rafter: { width: 0.212, height: 0.112, wallThickness: 0.004, channels: 4 },
		gableColumn: { width: 0.127, height: 0.076, wallThickness: 0.003, channels: 4 },
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
	gableSupportPositions: [-2.5, 2.5],
	mainPurlinX: [-2.5, 2.5],
	intermediatePurlinX: [-5, -1.25, 0, 1.25, 5],
}

export function getTentLength(numBays: number, specs: TentSpecs = TENT_SPECS): number {
	return numBays * specs.bayDistance
}

export const FRAME_PATH = getFramePath(TENT_TYPE, VARIANT)
export const COVERS_PATH = getCoversPath(TENT_TYPE, VARIANT)
