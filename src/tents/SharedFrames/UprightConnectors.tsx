import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3, Matrix, Quaternion } from '@babylonjs/core'
import {
	loadGLB,
	stripAndApplyMaterial,
	createFrozenThinInstances,
	type InstanceTransform,
} from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const SHARED_FRAME_PATH = '/tents/SharedFrames/'
const CONNECTOR_GLB     = 'upright-connector-r.glb'

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v))
}

// ─── Component ───────────────────────────────────────────────────────────────

interface UprightConnectorsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

/**
 * UprightConnectors — loads upright-connector-r.glb and bakes the
 * centering + scaling directly into vertex data so that:
 *
 *   • The geometry is centered at origin with correct world-space size.
 *   • Thin-instance rotation works around the geometry center (not around
 *     some far-off origin in raw GLB coords).
 *   • The left side is a properly mirrored copy with corrected winding
 *     (no negative-scale hack that breaks backface culling).
 *
 * Target dimensions (from specs.connectorPlate or upright profile):
 *   X = plate length inward   (2 × profileWidth = 0.424 m)
 *   Y = plate face height     (profileWidth     = 0.212 m)
 *   Z = plate depth           (profileHeight    = 0.112 m, flush)
 */
export const UprightConnectors: FC<UprightConnectorsProps> = memo(
	({ numBays, specs, enabled = true, onLoadStateChange }) => {
		const scene = useScene()
		const abortRef = useRef<AbortController | null>(null)

		useEffect(() => {
			if (!scene || !enabled) return

			abortRef.current?.abort()
			const ctrl = new AbortController()
			abortRef.current = ctrl

			const root = new TransformNode('upright-connectors-root', scene)
			const disposables: (Mesh | TransformNode)[] = [root]
			const mat = getAluminumMaterial(scene)

			onLoadStateChange?.(true)

			loadGLB(scene, SHARED_FRAME_PATH, CONNECTOR_GLB, ctrl.signal)
				.then((loaded) => {
					if (ctrl.signal.aborted) {
						for (const m of loaded) m.dispose()
						onLoadStateChange?.(false)
						return
					}

					// ── Keep only real geometry ──────────────────────
					const rightMeshes = loaded.filter(
						(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
					)
					if (rightMeshes.length === 0) {
						console.warn('[UprightConnectors] No geometry in GLB')
						onLoadStateChange?.(false)
						return
					}

					// Dispose non-geometry nodes (__root__, scene node, etc.)
					for (const m of loaded) {
						if (!rightMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* already gone */ }
						}
					}

					stripAndApplyMaterial(rightMeshes, mat)

					// ── Target dimensions ────────────────────────────
					const pw = specs.profiles.upright.width   // 0.212
					const ph = specs.profiles.upright.height  // 0.112
					const cp = specs.connectorPlate
					const tgtX = cp?.length ?? (2 * pw)  // 0.424
					const tgtY = cp?.height ?? pw         // 0.212
					const tgtZ = cp?.depth  ?? ph         // 0.112

					// ── Bake center + scale into vertex data ─────────
					// After this the geometry spans ±tgtX/2, ±tgtY/2,
					// ±tgtZ/2 around origin.  Thin instances only need
					// position + rotation — no scaling — so rotation
					// naturally pivots around the plate center.
					for (const m of rightMeshes) {
						m.makeGeometryUnique()
						m.rotationQuaternion = null
						m.rotation.set(0, 0, 0)
						m.position.setAll(0)
						m.scaling.setAll(1)
						m.parent = null

						m.refreshBoundingInfo()
						const bb = m.getBoundingInfo().boundingBox
						const lo = bb.minimum
						const hi = bb.maximum
						const sz = hi.subtract(lo)
						const cen = lo.add(hi).scale(0.5)

						const sx = sz.x > 1e-6 ? tgtX / sz.x : 1
						const sy = sz.y > 1e-6 ? tgtY / sz.y : 1
						const sZ = sz.z > 1e-6 ? tgtZ / sz.z : 1

						// v' = S × (v − center) = S×v − S×center
						m.bakeTransformIntoVertices(
							Matrix.Compose(
								new Vector3(sx, sy, sZ),
								Quaternion.Identity(),
								new Vector3(-cen.x * sx, -cen.y * sy, -cen.z * sZ),
							),
						)
						m.refreshBoundingInfo()
					}

					// ── Left-side meshes (X-mirrored geometry) ───────
					// Clone → flip X in vertices → reverse triangle
					// winding so normals face outward.  No negative-
					// scale hack, so backface culling works correctly.
					const leftMeshes: Mesh[] = []
					for (const m of rightMeshes) {
						const c = m.clone(m.name + '-L', null)
						if (!(c instanceof Mesh)) continue
						c.makeGeometryUnique()
						c.material = mat

						// Mirror positions + normals across X
						c.bakeTransformIntoVertices(Matrix.Scaling(-1, 1, 1))

						// Reverse triangle winding (swap 1st ↔ 3rd index)
						const idx = c.getIndices()
						if (idx) {
							for (let i = 0; i < idx.length; i += 3) {
								const tmp = idx[i]
								idx[i] = idx[i + 2]
								idx[i + 2] = tmp
							}
							c.setIndices(idx)
						}

						c.refreshBoundingInfo()
						leftMeshes.push(c)
					}

					// ── Miter geometry (matching Uprights.tsx) ───────
					const hw = specs.halfWidth
					const bpTop = specs.baseplate?.height ?? 0
					const rise = specs.ridgeHeight - specs.eaveHeight
					const slope = specs.rafterSlopeAtEave ?? (hw > 1e-6 ? rise / hw : 0.2)
					const tilt = Math.atan(slope)
					const drop = clamp(slope * pw, 0.01, 0.12)

					const innerTopY = bpTop + specs.eaveHeight
					const outerTopY = innerTopY - drop
					const midY = (innerTopY + outerTopY) / 2

					// ── Thin-instance transforms ─────────────────────
					const totLen = numBays * specs.bayDistance
					const halfLen = totLen / 2
					const nLines = numBays + 1

					const rightT: InstanceTransform[] = []
					const leftT: InstanceTransform[] = []

					for (let i = 0; i < nLines; i++) {
						const z = i * specs.bayDistance - halfLen

						rightT.push({
							position: new Vector3(hw, midY, z),
							rotation: new Vector3(0, 0, -tilt),
						})

						leftT.push({
							position: new Vector3(-hw, midY, z),
							rotation: new Vector3(0, 0, tilt),
						})
					}

					// ── Apply thin instances ─────────────────────────
					for (const m of rightMeshes) {
						m.parent = root
						m.setEnabled(true)
						createFrozenThinInstances(m, rightT)
						disposables.push(m)
					}

					for (const m of leftMeshes) {
						m.parent = root
						m.setEnabled(true)
						createFrozenThinInstances(m, leftT)
						disposables.push(m)
					}

					onLoadStateChange?.(false)
				})
				.catch((err) => {
					if (!ctrl.signal.aborted) {
						console.error('[UprightConnectors] GLB load failed:', err)
					}
					onLoadStateChange?.(false)
				})

			return () => {
				ctrl.abort()
				for (const d of disposables) {
					try { d.dispose() } catch { /* already gone */ }
				}
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)
