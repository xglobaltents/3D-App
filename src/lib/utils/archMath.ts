/**
 * Shared arch geometry math — used by all PremiumArchTent variant specs.
 *
 * Circular-arc arch height at horizontal position X.
 * R = (halfSpan² + rise²) / (2·rise), h(x) = ridge - R + √(R² - x²)
 */

interface FrameCurveSpecsLike {
	eaveHeight: number
	ridgeHeight: number
	archOuterSpan: number
	rafterSlopeAtEave?: number
}

interface FrameCenterlineCurveSpecs {
	eaveHeight: number
	ridgeHeight: number
	archOuterSpan: number
	rafterSlopeAtEave?: number
	eaveNormalX: number
	eaveNormalY: number
}

interface StraightPlusCircularCrownGeometry {
	slope: number
	crownRise: number
}

const SMALL_ARCH_MAX_SPAN = 5.5

function getCircularArchSlopeAtEave(specs: FrameCurveSpecsLike): number {
	const rise = specs.ridgeHeight - specs.eaveHeight
	const span = specs.archOuterSpan
	if (rise <= 0 || span <= 0) return 0

	const radius = (span * span + rise * rise) / (2 * rise)
	const edgeHeightAboveCenter = Math.max(radius - rise, 1e-6)
	return span / edgeHeightAboveCenter
}

function getTargetCrownHalf(span: number): number {
	return Math.min(2.5, span * 0.5)
}

function getCircularCrownRiseAtShoulder(crownHalf: number, slope: number): number {
	if (crownHalf <= 0 || slope <= 0) return 0
	return crownHalf * (Math.sqrt(1 + slope * slope) - 1) / slope
}

function solveStraightPlusCircularCrownGeometry(
	totalRise: number,
	span: number,
	crownHalf: number,
): StraightPlusCircularCrownGeometry | null {
	const outerRun = span - crownHalf
	if (totalRise <= 0 || crownHalf <= 0 || outerRun <= 0) return null

	const heightError = (slope: number): number => {
		return outerRun * slope + getCircularCrownRiseAtShoulder(crownHalf, slope) - totalRise
	}

	let lo = 1e-6
	let hi = 1
	while (heightError(hi) < 0 && hi < 64) hi *= 2
	if (heightError(hi) < 0) return null

	for (let i = 0; i < 64; i++) {
		const mid = (lo + hi) * 0.5
		if (heightError(mid) > 0) hi = mid
		else lo = mid
	}

	const slope = (lo + hi) * 0.5
	return {
		slope,
		crownRise: getCircularCrownRiseAtShoulder(crownHalf, slope),
	}
}

export function getFrameRafterSlopeAtEave(
	specs: FrameCurveSpecsLike,
	profileWidth = 0,
): number {
	if (specs.archOuterSpan <= SMALL_ARCH_MAX_SPAN) {
		const circularSlope = getCircularArchSlopeAtEave(specs)
		if (circularSlope > 0) return circularSlope
	}

	const baseSlope = Math.max(specs.rafterSlopeAtEave ?? 0, 0)
	const halfProfile = Math.max(profileWidth, 0) * 0.5
	let slope = baseSlope > 0 ? baseSlope : 0.25

	for (let i = 0; i < 4; i++) {
		const eaveNormalY = slope > 0 ? 1 / Math.sqrt(1 + slope * slope) : 1
		const eaveNormalX = slope > 0 ? slope * eaveNormalY : 0
		const eaveHeight = specs.eaveHeight + halfProfile * eaveNormalY
		const ridgeHeight = specs.ridgeHeight - halfProfile
		const span = Math.max(specs.archOuterSpan - halfProfile * eaveNormalX, 0)
		const totalRise = ridgeHeight - eaveHeight
		const crownHalf = getTargetCrownHalf(span)
		const geometry = solveStraightPlusCircularCrownGeometry(totalRise, span, crownHalf)
		if (!geometry) break
		slope = geometry.slope
	}

	return slope
}

function getFrameCenterlineCurveSpecs(
	specs: FrameCurveSpecsLike,
	profileWidth = 0,
): FrameCenterlineCurveSpecs {
	const halfProfile = Math.max(profileWidth, 0) * 0.5
	const slope = getFrameRafterSlopeAtEave(specs, profileWidth)
	const eaveNormalY = slope > 0 ? 1 / Math.sqrt(1 + slope * slope) : 1
	const eaveNormalX = slope > 0 ? slope * eaveNormalY : 0

	return {
		eaveHeight: specs.eaveHeight + halfProfile * eaveNormalY,
		ridgeHeight: specs.ridgeHeight - halfProfile,
		archOuterSpan: Math.max(specs.archOuterSpan - halfProfile * eaveNormalX, 0),
		rafterSlopeAtEave: slope,
		eaveNormalX,
		eaveNormalY,
	}
}

export function getArchCurveHalfSpan(
	specs: FrameCurveSpecsLike,
	profileWidth = 0,
): number | null {
	const centerlineSpecs = getFrameCenterlineCurveSpecs(specs, profileWidth)
	const rise = centerlineSpecs.ridgeHeight - centerlineSpecs.eaveHeight
	const span = centerlineSpecs.archOuterSpan
	const slope = Math.max(centerlineSpecs.rafterSlopeAtEave ?? 0, 0)
	if (rise <= 0 || span <= 0 || slope <= 0) return null
	if (span <= SMALL_ARCH_MAX_SPAN) return span
	if (span > SMALL_ARCH_MAX_SPAN) return getTargetCrownHalf(span)

	const targetShoulder = rise * 0.8
	const minCurve = span * 0.18
	const maxCurve = span * 0.55
	const inferred = span - targetShoulder / slope
	return Math.min(Math.max(inferred, minCurve), maxCurve)
}

export function makeFrameCenterlineHeightFn(
	specs: FrameCurveSpecsLike,
	profileWidth = 0,
): (x: number) => number {
	// Premium Arch spec dimensions are envelope dimensions:
	// - eaveHeight: arch underside clearance at the shoulder
	// - ridgeHeight: overall top-of-frame height
	// - archOuterSpan: outermost side-to-center half-span
	// Convert those values into the rafter centerline used for instancing.
	const centerlineSpecs = getFrameCenterlineCurveSpecs(specs, profileWidth)
	const rise = centerlineSpecs.ridgeHeight - centerlineSpecs.eaveHeight
	const span = centerlineSpecs.archOuterSpan
	if (rise <= 0 || span <= 0) return () => centerlineSpecs.eaveHeight
	if (span <= SMALL_ARCH_MAX_SPAN) {
		return makeArchHeightFn(
			centerlineSpecs.archOuterSpan,
			centerlineSpecs.eaveHeight,
			centerlineSpecs.ridgeHeight,
		)
	}

	const slope = Math.max(centerlineSpecs.rafterSlopeAtEave ?? 0, 0)
	if (slope <= 0) {
		return makeArchHeightFn(
			centerlineSpecs.archOuterSpan,
			centerlineSpecs.eaveHeight,
			centerlineSpecs.ridgeHeight,
		)
	}

	const eaveY = centerlineSpecs.eaveHeight
	const ridgeY = centerlineSpecs.ridgeHeight

	// ── Piecewise rafter: STRAIGHT + tangent circular crown ──
	// Solve the outer straight rafters and the middle circular crown together so
	// the 5 m crown stays a true arch and the shoulder join stays smooth.
	const crownHalf = getTargetCrownHalf(span)
	const geometry = solveStraightPlusCircularCrownGeometry(ridgeY - eaveY, span, crownHalf)
	if (!geometry) {
		return makeArchHeightFn(
			centerlineSpecs.archOuterSpan,
			centerlineSpecs.eaveHeight,
			centerlineSpecs.ridgeHeight,
		)
	}

	const shoulderY = ridgeY - geometry.crownRise
	const crownRadius = (crownHalf * crownHalf + geometry.crownRise * geometry.crownRise)
		/ (2 * geometry.crownRise)
	const crownCenterY = ridgeY - crownRadius

	return (x: number) => {
		const ax = Math.abs(x)
		if (ax >= span) return eaveY
		if (ax >= crownHalf) {
			// Straight rafter section
			return shoulderY + geometry.slope * (crownHalf - ax)
		}
		// Central circular crown with tangent-continuous shoulder join.
		return crownCenterY + Math.sqrt(Math.max(crownRadius * crownRadius - ax * ax, 0))
	}
}

export function makeFrameBottomHeightFn(
	specs: FrameCurveSpecsLike,
	profileWidth: number,
	clearance = 0,
): (x: number) => number {
	const centerlineHeightAt = makeFrameCenterlineHeightFn(specs, profileWidth)
	const span = getFrameCenterlineCurveSpecs(specs, profileWidth).archOuterSpan
	const delta = Math.max(span / 512, 1e-4)

	return (x: number) => {
		const clampedX = Math.max(-span, Math.min(span, x))
		const x0 = Math.max(-span, clampedX - delta)
		const x1 = Math.min(span, clampedX + delta)
		const rise = centerlineHeightAt(x1) - centerlineHeightAt(x0)
		const run = x1 - x0
		const slope = Math.abs(run) > 1e-8 ? rise / run : 0
		const normalY = 1 / Math.sqrt(1 + slope * slope)
		return centerlineHeightAt(clampedX) - profileWidth * 0.5 * normalY - clearance
	}
}

export function makeArchHeightFn(
	archOuterSpan: number,
	eaveHeight: number,
	ridgeHeight: number,
): (x: number) => number {
	const rise = ridgeHeight - eaveHeight
	const R = (archOuterSpan * archOuterSpan + rise * rise) / (2 * rise)
	const centerY = ridgeHeight - R // center of circle
	return (x: number): number => {
		const ax = Math.abs(x)
		if (ax >= archOuterSpan) return eaveHeight
		return centerY + Math.sqrt(R * R - ax * ax)
	}
}
