import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3, Matrix, Quaternion, VertexBuffer } from '@babylonjs/core'
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

// ─── Winding / mirror helpers ────────────────────────────────────────────────

/**
 * Fix reversed triangle winding by swapping indices[1] ↔ indices[2]
 * in every triangle.  More reliable than Babylon's flipFaces() which
 * can behave inconsistently after bakeTransformIntoVertices.
 */
function fixWinding(mesh: Mesh): void {
	const indices = mesh.getIndices()
	if (!indices) return
	for (let i = 0; i < indices.length; i += 3) {
		const tmp = indices[i + 1]
		indices[i + 1] = indices[i + 2]
		indices[i + 2] = tmp
	}
	mesh.setIndices(indices)
}

/**
 * Create a proper X-mirrored clone with correct normals and winding.
 *
 * IMPORTANT: source mesh must already have correct winding.
 *
 *   1. Negate vertex X positions  → geometry mirrors across YZ plane
 *   2. Negate normal X components → normals face mirrored direction
 *   3. Negate tangent X if present → PBR normal maps stay correct
 *   4. Reverse triangle winding   → compensates for X reflection
 */
function createMirroredClone(
	source: Mesh,
	name: string,
	mat: import('@babylonjs/core').Material,
): Mesh | null {
	const clone = source.clone(name, null)
	if (!clone) return null
	clone.makeGeometryUnique()
	clone.material = mat

	const positions = clone.getVerticesData(VertexBuffer.PositionKind)
	if (positions) {
		for (let i = 0; i < positions.length; i += 3) positions[i] = -positions[i]
		clone.setVerticesData(VertexBuffer.PositionKind, positions)
	}

	const normals = clone.getVerticesData(VertexBuffer.NormalKind)
	if (normals) {
		for (let i = 0; i < normals.length; i += 3) normals[i] = -normals[i]
		clone.setVerticesData(VertexBuffer.NormalKind, normals)
	}

	const tangents = clone.getVerticesData(VertexBuffer.TangentKind)
	if (tangents) {
		for (let i = 0; i < tangents.length; i += 4) tangents[i] = -tangents[i]
		clone.setVerticesData(VertexBuffer.TangentKind, tangents)
	}

	// Reverse winding to compensate for reflection
	fixWinding(clone)

	clone.refreshBoundingInfo()
	return clone
}

// ─── Component ───────────────────────────────────────────────────────────────

interface UprightConnectorsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

/**
 * UprightConnectors — loads upright-connector-r.glb, bakes centering +
 * scaling + flattening into vertex data, fixes the GLB's reversed face
 * winding, then places tilted instances that sit flush ON the miter-cut
 * surface of each upright, facing UP.
 *
 * Bake pipeline:
 *   1. Center + scale to target dimensions
 *   2. Rotate -90° around X to lay the plate FLAT (face up)
 *   3. Fix reversed winding from GLB (explicit index swap)
 *   4. Clone + mirror for left side
 *
 * After flattening the geometry extents are:
 *   X = plate length inward   (tgtX = 0.424 m)
 *   Y = plate thickness       (tgtZ = 0.112 m, thin, vertical)
 *   Z = plate width           (tgtY = 0.212 m, along tent length)
 *
 *   Side view (right upright):
 *
 *         ═══════  ← connector plate (thin, tilted, face UP)
 *        ╱       ╲
 *      ╱           ← follows miter surface angle
 *    ┌───┐
 *    │   │  ← upright
 *    └───┘
 *
 * Positioning: outer edge flush with upright outer face,
 * plate extends only inward toward tent center.
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
					const tgtX = cp?.length ?? (2 * pw)  // 0.424 — plate length inward
					const tgtY = cp?.height ?? pw         // 0.212 — plate face width
					const tgtZ = cp?.depth  ?? ph         // 0.112 — plate thickness

					// ── Bake #1: center + scale to target dims ───────
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

						m.bakeTransformIntoVertices(
							Matrix.Compose(
								new Vector3(sx, sy, sZ),
								Quaternion.Identity(),
								new Vector3(-cen.x * sx, -cen.y * sy, -cen.z * sZ),
							),
						)
						m.refreshBoundingInfo()
					}

					// ── Bake #2: flatten — rotate -90° around X ──────
					// Lays the plate flat so it faces UP:
					//   old Y (face width 0.212) → new −Z (along tent)
					//   old Z (thickness 0.112)  → new +Y (vertical)
					//
					// After this:
					//   X = 0.424 (inward)
					//   Y = 0.112 (thin, vertical — plate thickness)
					//   Z = 0.212 (along tent length)
					const flattenMatrix = Matrix.RotationX(-Math.PI / 2)
					for (const m of rightMeshes) {
						m.bakeTransformIntoVertices(flattenMatrix)
						m.refreshBoundingInfo()
					}

					// ── Left-side meshes (explicit vertex mirror) ────
					const leftMeshes: Mesh[] = []
					for (const m of rightMeshes) {
						const mirrored = createMirroredClone(m, m.name + '-L', mat)
						if (mirrored) leftMeshes.push(mirrored)
					}

					// ── Miter / slope geometry ───────────────────────
					const hw = specs.halfWidth
					const bpTop = specs.baseplate?.height ?? 0
					const rise = specs.ridgeHeight - specs.eaveHeight
					const slope = specs.rafterSlopeAtEave ?? (hw > 1e-6 ? rise / hw : 0.2)
					const tilt = Math.atan(slope)
					const drop = clamp(slope * pw, 0.01, 0.12)

					const sinT = Math.sin(tilt)
					const cosT = Math.cos(tilt)

					// Miter surface center Y on the upright top
					const innerTopY = bpTop + specs.eaveHeight
					const outerTopY = innerTopY - drop
					const miterMidY = (innerTopY + outerTopY) / 2

					// ── Surface-normal offset ────────────────────────
					// The flattened plate thickness is tgtZ (0.112 m).
					// Offset the plate center by half-thickness along
					// the miter surface normal so the bottom face sits
					// flush ON the miter.
					//
					// Miter normal (right, upward-facing):
					//   n = (sin(tilt), cos(tilt), 0)
					const halfThickness = tgtZ / 2
					const normalOffsetX = sinT * halfThickness
					const normalOffsetY = cosT * halfThickness

					// ── Flush offset (inward only, no T-shape) ───────
					const inwardShift = (tgtX - pw) / 2

					// ── Thin-instance transforms ─────────────────────
					const totLen = numBays * specs.bayDistance
					const halfLen = totLen / 2
					const nLines = numBays + 1

					const rightT: InstanceTransform[] = []
					const leftT: InstanceTransform[] = []

					for (let i = 0; i < nLines; i++) {
						const z = i * specs.bayDistance - halfLen

						// Right side: tilt matches miter (inner HIGH, outer LOW)
						// Rz(-tilt) tilts +X (outer) edge down → correct
						rightT.push({
							position: new Vector3(
								hw - inwardShift + normalOffsetX,
								miterMidY + normalOffsetY,
								z,
							),
							rotation: new Vector3(0, 0, -tilt),
						})

						// Left side: mirrored tilt and offset
						leftT.push({
							position: new Vector3(
								-hw + inwardShift - normalOffsetX,
								miterMidY + normalOffsetY,
								z,
							),
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