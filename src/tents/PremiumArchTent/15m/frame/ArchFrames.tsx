import { type FC, memo, useEffect, useRef } from 'react'
import { TransformNode, Vector2, Vector3, Mesh, VertexBuffer, VertexData, PolygonMeshBuilder, type Scene } from '@babylonjs/core'
import { useScene } from '@/engine/BabylonProvider'
import { loadGLB, createFrozenThinInstances, measureWorldBounds, clearBoundsCache, type InstanceTransform } from '@/lib/utils/GLBLoader'
import { getArchCurveHalfSpan, makeFrameCenterlineHeightFn } from '@/lib/utils/archMath'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'
import { FRAME_PATH } from '../specs'
import earcut from 'earcut'

interface ArchFramesProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

// ─── Arc-length parameterized arch path with Frenet frames ────────────────────

interface PathFrame {
	position: Vector3
	tangent: Vector3
	normal: Vector3
	arcLength: number
}

const PATH_SAMPLES = 512
const UNIFORM_SEGMENTS = 16
const CROWN_SEGMENTS = 12
const SEGMENT_OVERLAP = 1.03

function buildArchPathFrames(specs: TentSpecs): PathFrame[] {
	const heightFn = makeFrameCenterlineHeightFn(specs)
	const baseplateTop = specs.baseplate?.height ?? 0
	const span = specs.archOuterSpan

	const frames: PathFrame[] = []
	let cumLen = 0

	for (let i = 0; i <= PATH_SAMPLES; i++) {
		const t = i / PATH_SAMPLES
		const x = -span + t * 2 * span
		const y = baseplateTop + heightFn(x)
		const pos = new Vector3(x, y, 0)

		if (i > 0) {
			cumLen += Vector3.Distance(frames[i - 1].position, pos)
		}

		const dt = 0.5 / PATH_SAMPLES
		const tLo = Math.max(0, t - dt)
		const tHi = Math.min(1, t + dt)
		const xLo = -span + tLo * 2 * span
		const xHi = -span + tHi * 2 * span
		const tx = xHi - xLo
		const ty = (baseplateTop + heightFn(xHi)) - (baseplateTop + heightFn(xLo))
		const tLen = Math.sqrt(tx * tx + ty * ty)
		const tangent = tLen > 0
			? new Vector3(tx / tLen, ty / tLen, 0)
			: new Vector3(1, 0, 0)
		const normal = new Vector3(-tangent.y, tangent.x, 0)

		frames.push({ position: pos, tangent, normal, arcLength: cumLen })
	}

	return frames
}

function sampleFrameAt(frames: PathFrame[], fraction: number): PathFrame {
	const totalLen = frames[frames.length - 1].arcLength
	const target = Math.max(0, Math.min(totalLen, fraction * totalLen))

	let lo = 0
	let hi = frames.length - 1
	while (lo < hi - 1) {
		const mid = (lo + hi) >> 1
		if (frames[mid].arcLength <= target) lo = mid
		else hi = mid
	}

	const s0 = frames[lo]
	const s1 = frames[hi]
	const seg = s1.arcLength - s0.arcLength
	const f = seg > 0 ? (target - s0.arcLength) / seg : 0

	return {
		position: Vector3.Lerp(s0.position, s1.position, f),
		tangent: Vector3.Lerp(s0.tangent, s1.tangent, f).normalize(),
		normal: Vector3.Lerp(s0.normal, s1.normal, f).normalize(),
		arcLength: target,
	}
}

function sampleArcFractionAtX(frames: PathFrame[], targetX: number): number {
	let lo = 0
	let hi = frames.length - 1
	while (lo < hi - 1) {
		const mid = (lo + hi) >> 1
		if (frames[mid].position.x <= targetX) lo = mid
		else hi = mid
	}

	const left = frames[lo]
	const right = frames[hi]
	const dx = right.position.x - left.position.x
	const blend = Math.abs(dx) > 1e-8 ? (targetX - left.position.x) / dx : 0
	const arcLength = left.arcLength + (right.arcLength - left.arcLength) * Math.max(0, Math.min(1, blend))
	const totalLen = frames[frames.length - 1].arcLength
	return totalLen > 0 ? arcLength / totalLen : 0
}

interface ProfileShape {
	outer: Vector2[]
	holes: Vector2[][]
}

const PROFILE_WALL_RATIO = 0.12
const PROFILE_CORNER_RATIO = 0.18

function edgeKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`
}

function signedArea(points: Vector2[]): number {
	let area = 0
	for (let i = 0; i < points.length; i++) {
		const p0 = points[i]
		const p1 = points[(i + 1) % points.length]
		area += p0.x * p1.y - p1.x * p0.y
	}
	return area * 0.5
}

function normalizeLoop(points: Vector2[], clockwise: boolean): Vector2[] {
	const area = signedArea(points)
	const shouldReverse = clockwise ? area > 0 : area < 0
	return shouldReverse ? [...points].reverse() : points
}

function buildRoundedRectLoop(width: number, height: number, corner: number): Vector2[] {
	const halfWidth = width / 2
	const halfHeight = height / 2
	const chamfer = Math.max(0, Math.min(corner, halfWidth, halfHeight))

	if (chamfer <= 1e-6) {
		return [
			new Vector2(-halfWidth, -halfHeight),
			new Vector2(halfWidth, -halfHeight),
			new Vector2(halfWidth, halfHeight),
			new Vector2(-halfWidth, halfHeight),
		]
	}

	return [
		new Vector2(-halfWidth + chamfer, -halfHeight),
		new Vector2(halfWidth - chamfer, -halfHeight),
		new Vector2(halfWidth, -halfHeight + chamfer),
		new Vector2(halfWidth, halfHeight - chamfer),
		new Vector2(halfWidth - chamfer, halfHeight),
		new Vector2(-halfWidth + chamfer, halfHeight),
		new Vector2(-halfWidth, halfHeight - chamfer),
		new Vector2(-halfWidth, -halfHeight + chamfer),
	]
}

function buildFallbackProfileShape(width: number, height: number): ProfileShape {
	const wallThickness = Math.min(width, height) * PROFILE_WALL_RATIO
	const outerCorner = Math.min(width, height) * PROFILE_CORNER_RATIO
	const innerWidth = Math.max(width - wallThickness * 2, wallThickness)
	const innerHeight = Math.max(height - wallThickness * 2, wallThickness)
	const innerCorner = Math.max(0, outerCorner - wallThickness)

	const outer = normalizeLoop(buildRoundedRectLoop(width, height, outerCorner), true)
	const holes = innerWidth > 1e-4 && innerHeight > 1e-4
		? [normalizeLoop(buildRoundedRectLoop(innerWidth, innerHeight, innerCorner), false)]
		: []

	return { outer, holes }
}

function buildLoopsFromEdges(allPositions: number[], boundaryEdges: Array<[number, number]>): Vector2[][] {
	if (boundaryEdges.length < 3) return []

	const adjacency = new Map<number, number[]>()
	for (const [a, b] of boundaryEdges) {
		const aNeighbors = adjacency.get(a) ?? []
		aNeighbors.push(b)
		adjacency.set(a, aNeighbors)

		const bNeighbors = adjacency.get(b) ?? []
		bNeighbors.push(a)
		adjacency.set(b, bNeighbors)
	}

	const visitedEdges = new Set<string>()
	const loops: Vector2[][] = []

	for (const [start, initialNext] of boundaryEdges) {
		const startEdge = edgeKey(start, initialNext)
		if (visitedEdges.has(startEdge)) continue

		const vertexLoop = [start]
		let prev = start
		let current = initialNext
		visitedEdges.add(startEdge)

		while (current !== start) {
			vertexLoop.push(current)
			const neighbors = adjacency.get(current) ?? []
			const next = neighbors.find((candidate) => {
				if (candidate === prev) return false
				if (candidate === start) return true
				return !visitedEdges.has(edgeKey(current, candidate))
			}) ?? neighbors.find((candidate) => candidate !== prev)

			if (next === undefined) {
				vertexLoop.length = 0
				break
			}

			const nextEdge = edgeKey(current, next)
			if (visitedEdges.has(nextEdge) && next !== start) {
				vertexLoop.length = 0
				break
			}

			visitedEdges.add(nextEdge)
			prev = current
			current = next
		}

		if (vertexLoop.length < 3) continue
		loops.push(vertexLoop.map((vertex) => new Vector2(
			allPositions[vertex * 3],
			allPositions[vertex * 3 + 2],
		)))
	}

	return loops
}

function extractCapLoops(
	allPositions: number[],
	allIndices: number[],
	targetY: number,
	tolerance: number,
	allEdgeCounts: Map<string, number>,
): Vector2[][] {
	const planeVertices = new Set<number>()
	for (let vertex = 0; vertex < allPositions.length / 3; vertex++) {
		if (Math.abs(allPositions[vertex * 3 + 1] - targetY) < tolerance) {
			planeVertices.add(vertex)
		}
	}
	if (planeVertices.size < 3) return []

	const openEndEdges: Array<[number, number]> = []
	for (const [key, count] of allEdgeCounts.entries()) {
		if (count !== 1) continue
		const [a, b] = key.split(':').map(Number)
		if (planeVertices.has(a) && planeVertices.has(b)) {
			openEndEdges.push([a, b])
		}
	}
	if (openEndEdges.length >= 3) {
		return buildLoopsFromEdges(allPositions, openEndEdges)
	}

	const capEdgeCounts = new Map<string, number>()
	for (let i = 0; i < allIndices.length; i += 3) {
		const a = allIndices[i]
		const b = allIndices[i + 1]
		const c = allIndices[i + 2]
		if (!planeVertices.has(a) || !planeVertices.has(b) || !planeVertices.has(c)) continue

		for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
			const key = edgeKey(u, v)
			capEdgeCounts.set(key, (capEdgeCounts.get(key) ?? 0) + 1)
		}
	}

	const cappedEdges: Array<[number, number]> = []
	for (const [key, count] of capEdgeCounts.entries()) {
		if (count !== 1) continue
		const [a, b] = key.split(':').map(Number)
		cappedEdges.push([a, b])
	}

	return buildLoopsFromEdges(allPositions, cappedEdges)
}

function extractProfileShape(meshes: Mesh[]): ProfileShape | null {
	const allPositions: number[] = []
	const allIndices: number[] = []
	let vertexOffset = 0

	for (const mesh of meshes) {
		const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
		const indices = mesh.getIndices()
		if (!positions || !indices) continue
		for (let i = 0; i < positions.length; i++) {
			allPositions.push(positions[i])
		}
		for (let i = 0; i < indices.length; i++) {
			allIndices.push(indices[i] + vertexOffset)
		}
		vertexOffset += positions.length / 3
	}

	if (allPositions.length < 9 || allIndices.length < 3) return null

	let minY = Infinity
	let maxY = -Infinity
	for (let i = 1; i < allPositions.length; i += 3) {
		minY = Math.min(minY, allPositions[i])
		maxY = Math.max(maxY, allPositions[i])
	}
	const yRange = maxY - minY
	if (yRange <= 0) return null

	const tolerance = yRange * 0.005
	const allEdgeCounts = new Map<string, number>()
	for (let i = 0; i < allIndices.length; i += 3) {
		const a = allIndices[i]
		const b = allIndices[i + 1]
		const c = allIndices[i + 2]

		for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
			const key = edgeKey(u, v)
			allEdgeCounts.set(key, (allEdgeCounts.get(key) ?? 0) + 1)
		}
	}

	const minLoops = extractCapLoops(allPositions, allIndices, minY, tolerance, allEdgeCounts)
	const maxLoops = extractCapLoops(allPositions, allIndices, maxY, tolerance, allEdgeCounts)
	const loops = minLoops.length > 0 ? minLoops : maxLoops
	if (loops.length === 0) return null

	let outerIndex = 0
	let largestArea = 0
	for (let i = 0; i < loops.length; i++) {
		const area = Math.abs(signedArea(loops[i]))
		if (area > largestArea) {
			largestArea = area
			outerIndex = i
		}
	}

	const outer = loops[outerIndex]
	let minX = Infinity
	let maxX = -Infinity
	let minY2 = Infinity
	let maxY2 = -Infinity
	for (const point of outer) {
		minX = Math.min(minX, point.x)
		maxX = Math.max(maxX, point.x)
		minY2 = Math.min(minY2, point.y)
		maxY2 = Math.max(maxY2, point.y)
	}
	const centerX = (minX + maxX) / 2
	const centerY = (minY2 + maxY2) / 2

	const recenter = (points: Vector2[]) => points.map((point) => new Vector2(
		point.x - centerX,
		point.y - centerY,
	))

	return {
		outer: normalizeLoop(recenter(outer), true),
		holes: loops
			.filter((_, index) => index !== outerIndex)
			.map((loop) => normalizeLoop(recenter(loop), false)),
	}
}

function buildProfileSegmentMesh(scene: Scene, shape: ProfileShape): Mesh {
	const builder = new PolygonMeshBuilder('arch-frame-segment', shape.outer, scene, earcut)
	for (const hole of shape.holes) {
		builder.addHole(hole)
	}

	const mesh = builder.build(false, 1)
	const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
	const indices = mesh.getIndices()
	if (positions) {
		for (let i = 0; i < positions.length; i += 3) {
			positions[i + 1] += 0.5
		}
		mesh.setVerticesData(VertexBuffer.PositionKind, positions)
	}
	if (positions && indices) {
		const normals: number[] = []
		VertexData.ComputeNormals(positions, indices, normals)
		mesh.setVerticesData(VertexBuffer.NormalKind, normals)
	}
	mesh.refreshBoundingInfo()
	return mesh
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

		const baseMat = getAluminumMaterial(scene)
		const clonedMat = baseMat.clone('aluminum-arch')
		if (clonedMat) {
			clonedMat.backFaceCulling = false
			clonedMat.twoSidedLighting = true
		}
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

				for (const m of loaded) {
					if (!meshes.includes(m as Mesh)) {
						try { m.dispose() } catch { /* already gone */ }
					}
				}

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
				const rotBounds = measureWorldBounds(meshes, `arch-rafter-${profile.width}-${profile.height}`)
				if (rotBounds.size.x <= 0 || rotBounds.size.y <= 0 || rotBounds.size.z <= 0) {
					template.dispose()
					onLoadStateChange?.(false)
					return
				}

				template.scaling.x = profile.width / rotBounds.size.x
				template.scaling.z = 1.0 / rotBounds.size.y
				template.scaling.y = profile.height / rotBounds.size.z

				template.computeWorldMatrix(true)
				for (const m of meshes) {
					m.computeWorldMatrix(true)
					const wm = m.getWorldMatrix().clone()
					m.parent = null
					m.bakeTransformIntoVertices(wm)
				}
				template.dispose()

				if (controller.signal.aborted) {
					for (const m of meshes) {
						try { m.dispose() } catch { /* */ }
					}
					onLoadStateChange?.(false)
					return
				}

				const profileShape = extractProfileShape(meshes)
				for (const m of meshes) {
					try { m.dispose() } catch { /* already gone */ }
				}

				const proceduralProfileShape = buildFallbackProfileShape(profile.width, profile.height)
				if (!profileShape) {
					console.warn('[ArchFrames] Falling back to procedural hollow profile')
				}

				let segmentMesh = buildProfileSegmentMesh(scene, profileShape ?? proceduralProfileShape)
				if (segmentMesh.getTotalIndices() <= 0) {
					segmentMesh.dispose()
					segmentMesh = buildProfileSegmentMesh(scene, proceduralProfileShape)
				}
				segmentMesh.material = archMat

				const archPathFrames = buildArchPathFrames(specs)
				const totalArcLength = archPathFrames[archPathFrames.length - 1].arcLength
				const halfLength = (numBays * specs.bayDistance) / 2
				const transforms: InstanceTransform[] = []
				const curveHalf = getArchCurveHalfSpan(specs)
				const hasSeparateCrown = curveHalf !== null && curveHalf > 0 && curveHalf < specs.archOuterSpan

				let crownStartFraction = 0
				let crownEndFraction = 1
				if (hasSeparateCrown) {
					crownStartFraction = sampleArcFractionAtX(archPathFrames, -curveHalf)
					crownEndFraction = sampleArcFractionAtX(archPathFrames, curveHalf)
				}

				const leftRafterArcLen = crownStartFraction * totalArcLength
				const crownArcLen = Math.max(0, (crownEndFraction - crownStartFraction) * totalArcLength)
				const rightRafterArcLen = Math.max(0, totalArcLength - crownEndFraction * totalArcLength)

				for (let bay = 0; bay <= numBays; bay++) {
					const bayZ = bay * specs.bayDistance - halfLength

					if (!hasSeparateCrown) {
						const segmentLength = totalArcLength / UNIFORM_SEGMENTS
						for (let segment = 0; segment < UNIFORM_SEGMENTS; segment++) {
							const t = (segment + 0.5) / UNIFORM_SEGMENTS
							const frame = sampleFrameAt(archPathFrames, t)
							const rotationZ = Math.atan2(-frame.tangent.x, frame.tangent.y)

							transforms.push({
								position: new Vector3(frame.position.x, frame.position.y, bayZ),
								rotation: new Vector3(0, 0, rotationZ),
								scaling: new Vector3(1, segmentLength * SEGMENT_OVERLAP, 1),
							})
						}
						continue
					}

					if (leftRafterArcLen > 1e-4) {
						const tMid = crownStartFraction / 2
						const frame = sampleFrameAt(archPathFrames, tMid)
						const rotationZ = Math.atan2(-frame.tangent.x, frame.tangent.y)
						transforms.push({
							position: new Vector3(frame.position.x, frame.position.y, bayZ),
							rotation: new Vector3(0, 0, rotationZ),
							scaling: new Vector3(1, leftRafterArcLen * SEGMENT_OVERLAP, 1),
						})
					}

					if (crownArcLen > 1e-4) {
						const crownSegmentArcLen = crownArcLen / CROWN_SEGMENTS
						for (let segment = 0; segment < CROWN_SEGMENTS; segment++) {
							const t = crownStartFraction + ((segment + 0.5) / CROWN_SEGMENTS) * (crownEndFraction - crownStartFraction)
							const frame = sampleFrameAt(archPathFrames, t)
							const rotationZ = Math.atan2(-frame.tangent.x, frame.tangent.y)

							transforms.push({
								position: new Vector3(frame.position.x, frame.position.y, bayZ),
								rotation: new Vector3(0, 0, rotationZ),
								scaling: new Vector3(1, crownSegmentArcLen * SEGMENT_OVERLAP, 1),
							})
						}
					}

					if (rightRafterArcLen > 1e-4) {
						const tMid = crownEndFraction + (1 - crownEndFraction) / 2
						const frame = sampleFrameAt(archPathFrames, tMid)
						const rotationZ = Math.atan2(-frame.tangent.x, frame.tangent.y)
						transforms.push({
							position: new Vector3(frame.position.x, frame.position.y, bayZ),
							rotation: new Vector3(0, 0, rotationZ),
							scaling: new Vector3(1, rightRafterArcLen * SEGMENT_OVERLAP, 1),
						})
					}
				}

				segmentMesh.parent = root
				segmentMesh.position.setAll(0)
				segmentMesh.rotationQuaternion = null
				segmentMesh.rotation.setAll(0)
				segmentMesh.scaling.setAll(1)
				segmentMesh.setEnabled(true)
				createFrozenThinInstances(segmentMesh, transforms)
				allDisposables.push(segmentMesh)

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
