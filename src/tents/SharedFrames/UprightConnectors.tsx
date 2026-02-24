import { type FC, useEffect, memo } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import {
	Mesh,
	MeshBuilder,
	TransformNode,
	Vector3,
} from '@babylonjs/core'
import {
	createFrozenThinInstances,
	type InstanceTransform,
} from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const PLATE_THICKNESS = 0.008 // 8mm aluminium plate

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v))
}

/**
 * Create a connector plate mesh as a simple box.
 * Origin at center-center so tilt rotation works symmetrically.
 *   X = profileWidth  (across tent)
 *   Y = PLATE_THICKNESS (thin)
 *   Z = profileDepth  (along tent)
 */
function createPlateBox(
	scene: ReturnType<typeof useScene>,
	name: string,
	width: number,
	thickness: number,
	depth: number,
): Mesh {
	const box = MeshBuilder.CreateBox(name, {
		width,        // X
		height: thickness, // Y
		depth,        // Z
	}, scene!)

	// Origin is already at center — perfect for tilt rotation
	return box
}

// ─── Component ───────────────────────────────────────────────────────────────

interface UprightConnectorsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

/**
 * UprightConnectors — aluminium connector plates sitting on the
 * miter-cut top of each upright, bridging to the arch/rafter frame.
 *
 * Uses a simple box plate (profileWidth x PLATE_THICKNESS x profileDepth)
 * positioned at the midpoint of the miter cut and tilted to match
 * the miter angle.
 *
 * Positioning (matching Uprights.tsx):
 *   eaveHeight from ground (includes baseplate + upright + rafter profile)
 *   Uprights.tsx scales upright to eaveHeight, bottom at baseplateTop
 *   => inner-top Y = baseplateTop + eaveHeight       (high side of miter)
 *   => outer-top Y = inner-top - miterDrop            (low side of miter)
 *   miterDrop = rafterSlopeAtEave x profileWidth
 *   Tilt = atan(rafterSlopeAtEave)
 *
 *        .----- arch frame ------.
 *   HIGH \-----------/ HIGH   <- uprightInnerTopY
 *   (in)  \  PLATE  / (in)
 *          \-------/          <- uprightOuterTopY
 *          | UPRIGHT |
 *          |_________|        <- baseplateTop
 */
export const UprightConnectors: FC<UprightConnectorsProps> = memo(
	({ numBays, specs, enabled = true, onLoadStateChange }) => {
		const scene = useScene()

		useEffect(() => {
			if (!scene || !enabled) return
			let disposed = false

			const root = new TransformNode('upright-connectors-root', scene)
			const allDisposables: (Mesh | TransformNode)[] = [root]

			try {
				onLoadStateChange?.(true)

				const aluminumMat = getAluminumMaterial(scene)

				// ── 1. Profile dimensions ────────────────────────────
				const profileWidth = specs.profiles.upright.width   // 0.212m
				const profileDepth = specs.profiles.upright.height  // 0.112m

				// ── 2. Key measurements ──────────────────────────────
				const halfWidth = specs.halfWidth
				const baseplateTop = specs.baseplate?.height ?? 0

				// ── 3. Slope & tilt angle ────────────────────────────
				const rise = specs.ridgeHeight - specs.eaveHeight
				const fallbackSlope = halfWidth > 1e-6 ? rise / halfWidth : 0.2
				const rafterSlope = specs.rafterSlopeAtEave ?? fallbackSlope
				const tiltAngle = Math.atan(rafterSlope)

				// ── 4. Miter drop (same formula as Uprights.tsx) ─────
				const miterDrop = clamp(rafterSlope * profileWidth, 0.01, 0.12)

				// ── 5. Upright top Y positions ───────────────────────
				// Uprights.tsx: scaled to eaveHeight, bottom at baseplateTop
				const uprightInnerTopY = baseplateTop + specs.eaveHeight
				const uprightOuterTopY = uprightInnerTopY - miterDrop

				// Plate sits at the midpoint of the miter surface
				const miterMidY = (uprightInnerTopY + uprightOuterTopY) / 2

				// ── 6. Create plate meshes ───────────────────────────
				const rightMesh = createPlateBox(
					scene, 'upright-connector-r',
					profileWidth, PLATE_THICKNESS, profileDepth,
				)
				rightMesh.parent = root
				rightMesh.material = aluminumMat
				rightMesh.setEnabled(true)
				allDisposables.push(rightMesh)

				const leftMesh = createPlateBox(
					scene, 'upright-connector-l',
					profileWidth, PLATE_THICKNESS, profileDepth,
				)
				leftMesh.parent = root
				leftMesh.material = aluminumMat
				leftMesh.setEnabled(true)
				allDisposables.push(leftMesh)

				// ── 7. Build instance transforms ─────────────────────
				// Position: X at upright center (±halfWidth),
				//           Y at miter midpoint,
				//           Z at each bay line.
				// Rotation: Z-axis tilt to match the miter angle.
				//   RIGHT: +tiltAngle tilts inner edge up
				//   LEFT:  -tiltAngle tilts inner edge up
				const totalLength = numBays * specs.bayDistance
				const halfLength = totalLength / 2
				const numLines = numBays + 1

				const rightTransforms: InstanceTransform[] = []
				const leftTransforms: InstanceTransform[] = []

				for (let i = 0; i < numLines; i++) {
					const bayZ = i * specs.bayDistance - halfLength

					// RIGHT (+X): outer edge slopes DOWN, so tilt is negative Z
					rightTransforms.push({
						position: new Vector3(halfWidth, miterMidY, bayZ),
						rotation: new Vector3(0, 0, -tiltAngle),
					})

					// LEFT (−X): outer edge slopes DOWN, so tilt is positive Z
					leftTransforms.push({
						position: new Vector3(-halfWidth, miterMidY, bayZ),
						rotation: new Vector3(0, 0, tiltAngle),
					})
				}

				if (disposed) return

				createFrozenThinInstances(rightMesh, rightTransforms)
				createFrozenThinInstances(leftMesh, leftTransforms)

				console.log(
					'[UprightConnectors]',
					`${numLines * 2} instances |`,
					`plate: ${(profileWidth * 1000).toFixed(0)}x${(PLATE_THICKNESS * 1000).toFixed(0)}x${(profileDepth * 1000).toFixed(0)}mm |`,
					`miterDrop: ${(miterDrop * 1000).toFixed(1)}mm |`,
					`tilt: ${(tiltAngle * 180 / Math.PI).toFixed(1)}deg |`,
					`miterMidY: ${miterMidY.toFixed(3)}`,
				)

			} catch (err) {
				console.error('[UprightConnectors] Failed:', err)
			} finally {
				onLoadStateChange?.(false)
			}

			return () => {
				disposed = true
				for (const d of allDisposables) {
					try { d.dispose() } catch { /* already gone */ }
				}
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)
