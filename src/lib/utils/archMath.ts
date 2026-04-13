/**
 * Shared arch geometry math — used by all PremiumArchTent variant specs.
 *
 * Circular-arc arch height at horizontal position X.
 * R = (halfSpan² + rise²) / (2·rise), h(x) = ridge - R + √(R² - x²)
 */

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
