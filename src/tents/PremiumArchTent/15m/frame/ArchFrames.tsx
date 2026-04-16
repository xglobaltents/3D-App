import { type FC, memo, useEffect, useRef } from 'react'
import { Matrix, TransformNode, Vector3, Mesh, VertexBuffer, MeshBuilder } from '@babylonjs/core'
import { useScene } from '@/engine/BabylonProvider'
import { loadGLB, measureWorldBounds, clearBoundsCache } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'
import { FRAME_PATH } from '../specs'

interface ArchFramesProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

// ─── Piecewise centerline: straight rafters + Bézier crown ────────────────────

function makeFrameCenterlineHeightFn(specs: TentSpecs): (x: number) => number {
	const rise = specs.ridgeHeight - specs.eaveHeight
	const span = specs.archOuterSpan
	if (rise <= 0 || span <= 0) return () => specs.eaveHeight

	const slope = Math.max(specs.rafterSlopeAtEave ?? 0, 0)
	if (slope <= 0) {
		const R = (span * span + rise * rise) / (2 * rise)
		const centerY = specs.ridgeHeight - R
		return (x: number) => {
			const ax = Math.abs(x)
			return ax >= span ? specs.eaveHeight : centerY + Math.sqrt(R * R - ax * ax)
		}
	}

	const targetShoulder = rise * 0.8
	const minCurve = span * 0.18
	const maxCurve = span * 0.55
	const inferred = span - targetShoulder / slope
	const curveHalf = Math.min(Math.max(inferred, minCurve), maxCurve)
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

// ─── Cross-section contour extraction from GLB cap ────────────────────────────

/**
 * Extract the outer boundary loop from the cap face (at minY) of the
 * baked upright mesh. Returns centered 2D shape points for ExtrudeShape.
 *
 * Algorithm:
 * 1. Find all vertices at minY (cap face)
 * 2. Find triangles whose three vertices are all cap vertices
 * 3. Count edge occurrences — boundary edges appear exactly once
 * 4. Chain boundary edges into an ordered loop
 * 5. If multiple loops (hollow profile), take the largest (outer)
 */
function extractProfileContour(meshes: Mesh[]): Vector3[] | null {
	const allPos: number[] = []
	const allIdx: number[] = []
	let vOff = 0

	for (const m of meshes) {
		const p = m.getVerticesData(VertexBuffer.PositionKind)
		const idx = m.getIndices()
		if (!p || !idx) continue
		for (let i = 0; i < p.length; i++) allPos.push(p[i])
		for (let i = 0; i < idx.length; i++) allIdx.push(idx[i] + vOff)
		vOff += p.length / 3
	}

	if (allPos.length < 9 || allIdx.length < 3) return null

	// Y bounds
	let minY = Infinity, maxY = -Infinity
	for (let i = 1; i < allPos.length; i += 3) {
		if (allPos[i] < minY) minY = allPos[i]
		if (allPos[i] > maxY) maxY = allPos[i]
	}
	const yRange = maxY - minY
	if (yRange <= 0) return null

	const tol = yRange * 0.005

	// Cap vertex indices
	const capVerts = new Set<number>()
	for (let v = 0; v < allPos.length / 3; v++) {
		if (Math.abs(allPos[v * 3 + 1] - minY) < tol) capVerts.add(v)
	}
	if (capVerts.size < 3) return null

	// Count edge occurrences in cap triangles
	const edgeCnt = new Map<string, number>()
	for (let t = 0; t < allIdx.length; t += 3) {
		const a = allIdx[t], b = allIdx[t + 1], c = allIdx[t + 2]
		if (!capVerts.has(a) || !capVerts.has(b) || !capVerts.has(c)) continue
		for (const [u, v] of [[a, b], [b, c], [c, a]]) {
			const key = Math.min(u, v) + ':' + Math.max(u, v)
			edgeCnt.set(key, (edgeCnt.get(key) ?? 0) + 1)
		}
	}

	// Boundary edges (shared by only one cap triangle)
	const bEdges: [number, number][] = []
	for (const [key, cnt] of edgeCnt) {
		if (cnt === 1) {
			const [a, b] = key.split(':').map(Number)
			bEdges.push([a, b])
		}
	}
	if (bEdges.length < 3) return null

	// Build adjacency and chain into ordered loops
	const adj = new Map<number, number[]>()
	for (const [a, b] of bEdges) {
		if (!adj.has(a)) adj.set(a, [])
		if (!adj.has(b)) adj.set(b, [])
		adj.get(a)!.push(b)
		adj.get(b)!.push(a)
	}

	const visited = new Set<number>()
	const loops: number[][] = []

	for (const start of adj.keys()) {
		if (visited.has(start)) continue
		const loop = [start]
		visited.add(start)
		let curr = start
		while (true) {
			const nbrs = adj.get(curr)
			if (!nbrs) break
			const next = nbrs.find(n => !visited.has(n))
			if (next === undefined) break
			loop.push(next)
			visited.add(next)
			curr = next
		}
		if (loop.length >= 3) loops.push(loop)
	}
	if (loops.length === 0) return null

	// Take largest loop (outer boundary for hollow profiles)
	const outer = loops.reduce((a, b) => a.length >= b.length ? a : b)

	// Centroid for centering
	let cx = 0, cz = 0
	for (const v of outer) {
		cx += allPos[v * 3]
		cz += allPos[v * 3 + 2]
	}
	cx /= outer.length
	cz /= outer.length

	// Shape points for ExtrudeShape: (x=width, y=depth, z=0)
	// Reverse winding so ExtrudeShape generates outward-facing normals
	return outer.map(v => new Vector3(
		allPos[v * 3] - cx,
		allPos[v * 3 + 2] - cz,
		0,
	))
}

/** Rectangular fallback if cap extraction fails */
function rectangularProfile(width: number, height: number): Vector3[] {
	const hw = width / 2, hh = height / 2
	return [
		new Vector3(-hw, -hh, 0),
		new Vector3(hw, -hh, 0),
		new Vector3(hw, hh, 0),
		new Vector3(-hw, hh, 0),
	]
}

// ─── Thin instance helper ─────────────────────────────────────────────────────

function createFrozenInstances(mesh: Mesh, matrices: Matrix[]): void {
	if (matrices.length === 0) return
	const buf = new Float32Array(matrices.length * 16)
	for (let i = 0; i < matrices.length; i++) {
		matrices[i].copyToArray(buf, i * 16)
	}
	mesh.thinInstanceSetBuffer('matrix', buf, 16)
	mesh.thinInstanceRefreshBoundingInfo(false)
	mesh.alwaysSelectAsActiveMesh = true
	mesh.freezeWorldMatrix()
	mesh.freezeNormals()
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ArchFrames: FC<ArchFramesProps> = memo(({
	numBays,
	specs,
	enabled = true,
	onLoadStateChange,
}) => {
	const scene = useScene()
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		if (!scene || !enabled) return

		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller

		clearBoundsCache()
		onLoadStateChange?.(true)

		const root = new TransformNode('arch-frames-root', scene)
		const allDisposables: (TransformNode | Mesh)[] = [root]

		// Clone material BEFORE async — backFaceCulling off for double-sided
		const baseMat = getAluminumMaterial(scene)
		const clonedMat = baseMat.clone('aluminum-arch')
		if (clonedMat) clonedMat.backFaceCulling = false
		const archMat = clonedMat ?? baseMat

		const profile = specs.profiles.rafter

		loadGLB(scene, FRAME_PATH, 'mainProfile.glb', controller.signal)
			.then((loaded) => {
				if (controller.signal.aborted) {
					for (const m of loaded) m.dispose()
					onLoadStateChange?.(false)
					return
				}

				const meshes = loaded.filter(
					(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
				)
				if (meshes.length === 0) {
					onLoadStateChange?.(false)
					return
				}

				// Dispose non-geometry clones
				for (const m of loaded) {
					if (!meshes.includes(m as Mesh)) {
						try { m.dispose() } catch { /* already gone */ }
					}
				}

				// ── Build template to get correct cross-section dimensions ──
				// GLB is Z-up; rotation.x = -PI/2 converts to Y-up.
				// Per-axis scaling maps raw extents to rafter profile dimensions.
				const template = new TransformNode('arch-profile-template', scene)
				for (const m of meshes) {
					m.makeGeometryUnique()
					m.rotationQuaternion = null
					m.rotation.set(0, 0, 0)
					m.position.setAll(0)
					m.scaling.setAll(1)
					m.parent = template
				}
				template.rotationQuaternion = null
				template.rotation.set(0, 0, 0)
				template.scaling.setAll(1)
				template.rotation.x = -Math.PI / 2

				template.computeWorldMatrix(true)
				const rotBounds = measureWorldBounds(meshes, `arch-profile-${profile.width}-${profile.height}`)
				if (rotBounds.size.x <= 0 || rotBounds.size.y <= 0 || rotBounds.size.z <= 0) {
					template.dispose()
					onLoadStateChange?.(false)
					return
				}

				// After rotation.x = -PI/2:
				//   scaling.x → World X (profile width)
				//   scaling.z → World Y (length axis)
				//   scaling.y → World Z (profile depth)
				template.scaling.x = profile.width / rotBounds.size.x
				template.scaling.z = 1.0 / rotBounds.size.y
				template.scaling.y = profile.height / rotBounds.size.z

				// Bake full world transform so vertices have correct
				// cross-section dimensions in world space
				template.computeWorldMatrix(true)
				for (const m of meshes) {
					m.computeWorldMatrix(true)
					const wm = m.getWorldMatrix().clone()
					m.parent = null
					m.bakeTransformIntoVertices(wm)
				}
				template.dispose()

				// ── Extract 2D cross-section contour from cap ───────────────
				let shape = extractProfileContour(meshes)
				if (!shape || shape.length < 3) {
					shape = rectangularProfile(profile.width, profile.height)
				}

				// Loaded meshes only needed for contour extraction — dispose
				for (const m of meshes) {
					try { m.dispose() } catch { /* already gone */ }
				}

				if (controller.signal.aborted) {
					onLoadStateChange?.(false)
					return
				}

				// ── Build arch centerline path ──────────────────────────────
				const heightFn = makeFrameCenterlineHeightFn(specs)
				const baseplateTop = specs.baseplate?.height ?? 0
				const pathPoints: Vector3[] = []
				const NUM_PATH_PTS = 128
				for (let i = 0; i <= NUM_PATH_PTS; i++) {
					const t = i / NUM_PATH_PTS
					const x = -specs.archOuterSpan + t * 2 * specs.archOuterSpan
					pathPoints.push(new Vector3(x, baseplateTop + heightFn(x), 0))
				}

				// ── Extrude cross-section along arch path ───────────────────
				const archMesh = MeshBuilder.ExtrudeShape('arch-frame', {
					shape,
					path: pathPoints,
					closeShape: true,
					cap: Mesh.CAP_ALL,
					updatable: false,
				}, scene)

				archMesh.material = archMat

				// ── Thin instances: one arch per bay line ────────────────────
				const halfLength = (numBays * specs.bayDistance) / 2
				const instanceMatrices: Matrix[] = []
				for (let i = 0; i <= numBays; i++) {
					instanceMatrices.push(
						Matrix.Translation(0, 0, i * specs.bayDistance - halfLength),
					)
				}

				archMesh.parent = root
				createFrozenInstances(archMesh, instanceMatrices)
				allDisposables.push(archMesh)

				onLoadStateChange?.(false)
			})
			.catch((err) => {
				if (!controller.signal.aborted) {
					console.error('[ArchFrames] Failed:', err)
				}
				onLoadStateChange?.(false)
			})

		return () => {
			controller.abort()
			for (const d of allDisposables) {
				try { d.dispose() } catch { /* already gone */ }
			}
			if (clonedMat && clonedMat !== baseMat) {
				try { clonedMat.dispose() } catch { /* already gone */ }
			}
		}
	}, [scene, enabled, numBays, specs, onLoadStateChange])

	return null
})

ArchFrames.displayName = 'ArchFrames'
