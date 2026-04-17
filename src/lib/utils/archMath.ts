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

export function getArchCurveHalfSpan(specs: FrameCurveSpecsLike): number | null {
	const rise = specs.ridgeHeight - specs.eaveHeight
	const span = specs.archOuterSpan
	const slope = Math.max(specs.rafterSlopeAtEave ?? 0, 0)
	if (rise <= 0 || span <= 0 || slope <= 0) return null

	const targetShoulder = rise * 0.8
	const minCurve = span * 0.18
	const maxCurve = span * 0.55
	const inferred = span - targetShoulder / slope
	return Math.min(Math.max(inferred, minCurve), maxCurve)
}

export function makeFrameCenterlineHeightFn(
	specs: FrameCurveSpecsLike,
): (x: number) => number {
	const rise = specs.ridgeHeight - specs.eaveHeight
	const span = specs.archOuterSpan
	if (rise <= 0 || span <= 0) return () => specs.eaveHeight

	const slope = Math.max(specs.rafterSlopeAtEave ?? 0, 0)
	if (slope <= 0) {
		return makeArchHeightFn(specs.archOuterSpan, specs.eaveHeight, specs.ridgeHeight)
	}

	const curveHalf = getArchCurveHalfSpan(specs) ?? span
	const shoulderH = Math.min(Math.max(slope * (span - curveHalf), 0), rise)
	const shoulderY = specs.eaveHeight + shoulderH
	const p0 = shoulderY
	const p1 = shoulderY + (slope * curveHalf) / 3
	const p2 = specs.ridgeHeight
	const p3 = specs.ridgeHeight

	return (x: number) => {
		const ax = Math.abs(x)
		if (ax >= span) return specs.eaveHeight
		if (ax >= curveHalf) return specs.eaveHeight + slope * (span - ax)
		const t = 1 - ax / curveHalf
		const mt = 1 - t
		return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
	}
}

export function makeFrameBottomHeightFn(
	specs: FrameCurveSpecsLike,
	profileWidth: number,
	clearance = 0,
): (x: number) => number {
	const centerlineHeightAt = makeFrameCenterlineHeightFn(specs)
	const span = specs.archOuterSpan
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
