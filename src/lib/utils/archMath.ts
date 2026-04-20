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

function getFrameCenterlineCurveSpecs(
	specs: FrameCurveSpecsLike,
	profileWidth = 0,
): FrameCenterlineCurveSpecs {
	const halfProfile = Math.max(profileWidth, 0) * 0.5
	const slope = Math.max(specs.rafterSlopeAtEave ?? 0, 0)
	const eaveNormalY = slope > 0 ? 1 / Math.sqrt(1 + slope * slope) : 1
	const eaveNormalX = slope > 0 ? slope * eaveNormalY : 0

	return {
		eaveHeight: specs.eaveHeight + halfProfile * eaveNormalY,
		ridgeHeight: specs.ridgeHeight - halfProfile,
		archOuterSpan: Math.max(specs.archOuterSpan - halfProfile * eaveNormalX, 0),
		rafterSlopeAtEave: specs.rafterSlopeAtEave,
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
	const eaveTangent = slope * span

	return (x: number) => {
		const ax = Math.abs(x)
		if (ax >= span) return eaveY
		const t = 1 - ax / span
		const t2 = t * t
		const t3 = t2 * t
		const h00 = 2 * t3 - 3 * t2 + 1
		const h10 = t3 - 2 * t2 + t
		const h01 = -2 * t3 + 3 * t2
		return h00 * eaveY + h10 * eaveTangent + h01 * ridgeY
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
