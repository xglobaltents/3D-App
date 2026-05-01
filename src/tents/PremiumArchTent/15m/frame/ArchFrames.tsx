import { type FC, memo, useEffect, useRef } from 'react'
import { TransformNode, Vector2, Vector3, Mesh, VertexBuffer, VertexData, type Scene } from '@babylonjs/core'
import { useScene } from '@/engine/BabylonProvider'
import { loadGLB, createFrozenThinInstances, type InstanceTransform } from '@/lib/utils/GLBLoader'
import { getFrameRafterSlopeAtEave, makeFrameCenterlineHeightFn } from '@/lib/utils/archMath'
import { getAluminumClone } from '@/lib/materials/frameMaterials'
import { getSharedFramePath } from '@/lib/constants/assetPaths'
import type { TentSpecs } from '@/types'
import earcut from 'earcut'

const SHARED_FRAME_PATH = getSharedFramePath()

interface ArchFramesProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

interface PathFrame {
	position: Vector3
	tangent: Vector3
	normal: Vector3
	arcLength: number
}

interface ProfileShape {
	outer: Vector2[]
	holes: Vector2[][]
}

interface SweepLoopInfo {
	points: Vector2[]
	clockwise: boolean
}

type AxisIndex = 0 | 1 | 2

const PATH_SAMPLES = 512
const PROFILE_WALL_RATIO = 0.12
const SWEEP_TARGET_SEGMENT_LENGTH = 0.18
const SWEEP_MIN_SEGMENTS = 72
const SWEEP_MAX_SEGMENTS = 128
const MAX_OUTER_PROFILE_POINTS = 48
const MAX_INNER_PROFILE_POINTS = 32
const PROFILE_SIMPLIFY_START_RATIO = 0.0015
const ARCH_PROFILE_CACHE_VERSION = 'aligned-v12-wide-10m-crown'

// Dev-mode StrictMode remounts and bay/variant changes can re-enter the arch
// bootstrap path repeatedly. Cache the extracted profile shape so we only pay
// the GLB profile extraction cost once per profile size in a browser session.
const ARCH_PROFILE_SHAPE_CACHE = new Map<string, ProfileShape>()

// Cache the computed arch sweep vertex data (positions, indices, normals).
// The sweep geometry depends only on specs (profile + arch envelope), NOT on
// numBays (instances handle bay placement). Avoids re-running the heavy sweep
// computation on every bay slider change.
interface CachedVertexData {
	positions: Float32Array
	indices: Int32Array
	normals: Float32Array
}
const ARCH_VERTEX_DATA_CACHE = new Map<string, CachedVertexData>()

function getArchEaveOuterOffsetX(specs: TentSpecs, profileWidth: number): number {
	const slope = getFrameRafterSlopeAtEave(specs, profileWidth)
	if (slope <= 0) return 0
	const normalY = 1 / Math.sqrt(1 + slope * slope)
	return profileWidth * 0.5 * slope * normalY
}

function buildArchPathFrames(specs: TentSpecs): PathFrame[] {
	const profileWidth = specs.profiles.rafter.width
	const heightFn = makeFrameCenterlineHeightFn(specs, profileWidth)
	const baseplateTop = specs.baseplate?.height ?? 0
	const span = Math.max(0, specs.archOuterSpan - getArchEaveOuterOffsetX(specs, profileWidth))

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

function buildSweepSamples(frames: PathFrame[], count: number): PathFrame[] {
	const samples: PathFrame[] = []
	for (let i = 0; i <= count; i++) {
		samples.push(sampleFrameAt(frames, i / count))
	}
	return samples
}

function getSweepSegmentCount(frames: PathFrame[]): number {
	const totalLen = frames[frames.length - 1]?.arcLength ?? 0
	if (totalLen <= 0) return SWEEP_MIN_SEGMENTS

	return Math.max(
		SWEEP_MIN_SEGMENTS,
		Math.min(SWEEP_MAX_SEGMENTS, Math.round(totalLen / SWEEP_TARGET_SEGMENT_LENGTH)),
	)
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

function edgeKey(a: number, b: number): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`
}

function getVertexAxisValue(allPositions: number[], vertex: number, axis: AxisIndex): number {
	return allPositions[vertex * 3 + axis]
}

function projectVertexToPlane(allPositions: number[], vertex: number, axis: AxisIndex): Vector2 {
	if (axis === 0) {
		return new Vector2(allPositions[vertex * 3 + 1], allPositions[vertex * 3 + 2])
	}
	if (axis === 1) {
		return new Vector2(allPositions[vertex * 3], allPositions[vertex * 3 + 2])
	}
	return new Vector2(allPositions[vertex * 3], allPositions[vertex * 3 + 1])
}

function buildRectLoop(width: number, height: number): Vector2[] {
	const halfWidth = width / 2
	const halfHeight = height / 2
	return [
		new Vector2(-halfWidth, -halfHeight),
		new Vector2(halfWidth, -halfHeight),
		new Vector2(halfWidth, halfHeight),
		new Vector2(-halfWidth, halfHeight),
	]
}

function buildLowPolyProfileShape(width: number, height: number): ProfileShape {
	const wallThickness = Math.min(width, height) * PROFILE_WALL_RATIO
	const innerWidth = Math.max(width - wallThickness * 2, wallThickness)
	const innerHeight = Math.max(height - wallThickness * 2, wallThickness)

	const outer = normalizeLoop(buildRectLoop(width, height), true)
	const holes = innerWidth > 1e-4 && innerHeight > 1e-4
		? [normalizeLoop(buildRectLoop(innerWidth, innerHeight), false)]
		: []

	return { outer, holes }
}

function getProfileShapeBounds(shape: ProfileShape): { width: number; height: number } {
	let minX = Infinity
	let maxX = -Infinity
	let minY = Infinity
	let maxY = -Infinity

	for (const point of shape.outer) {
		minX = Math.min(minX, point.x)
		maxX = Math.max(maxX, point.x)
		minY = Math.min(minY, point.y)
		maxY = Math.max(maxY, point.y)
	}

	return {
		width: Math.max(maxX - minX, 1e-6),
		height: Math.max(maxY - minY, 1e-6),
	}
}

function orientProfileShape(shape: ProfileShape, targetWidth: number, targetHeight: number): ProfileShape {
	const { width, height } = getProfileShapeBounds(shape)
	const rawAspect = width / height
	const targetAspect = targetWidth / targetHeight
	if (Math.abs(rawAspect - targetAspect) <= Math.abs(1 / rawAspect - targetAspect)) {
		return shape
	}

	const swapLoop = (loop: Vector2[], clockwise: boolean) => normalizeLoop(
		loop.map((point) => new Vector2(point.y, point.x)),
		clockwise,
	)

	return {
		outer: swapLoop(shape.outer, true),
		holes: shape.holes.map((loop) => swapLoop(loop, false)),
	}
}

function rotateLoop(points: Vector2[], angle: number): Vector2[] {
	const cos = Math.cos(angle)
	const sin = Math.sin(angle)
	return points.map((point) => new Vector2(
		point.x * cos - point.y * sin,
		point.x * sin + point.y * cos,
	))
}

function alignProfileShapeToAxes(shape: ProfileShape): ProfileShape {
	if (shape.outer.length < 2) return shape

	let meanX = 0
	let meanY = 0
	for (const point of shape.outer) {
		meanX += point.x
		meanY += point.y
	}
	meanX /= shape.outer.length
	meanY /= shape.outer.length

	let covXX = 0
	let covXY = 0
	let covYY = 0
	for (const point of shape.outer) {
		const dx = point.x - meanX
		const dy = point.y - meanY
		covXX += dx * dx
		covXY += dx * dy
		covYY += dy * dy
	}

	if (Math.abs(covXY) < 1e-8 && Math.abs(covXX - covYY) < 1e-8) {
		return shape
	}

	const principalAxisAngle = 0.5 * Math.atan2(2 * covXY, covXX - covYY)
	if (Math.abs(principalAxisAngle) < 1e-6) return shape

	return {
		outer: rotateLoop(shape.outer, -principalAxisAngle),
		holes: shape.holes.map((loop) => rotateLoop(loop, -principalAxisAngle)),
	}
}

function scaleProfileShape(shape: ProfileShape, targetWidth: number, targetHeight: number): ProfileShape {
	const alignedShape = alignProfileShapeToAxes(shape)
	const orientedShape = orientProfileShape(alignedShape, targetWidth, targetHeight)
	const { width: rawWidth, height: rawHeight } = getProfileShapeBounds(orientedShape)
	const scaleX = targetWidth / rawWidth
	const scaleY = targetHeight / rawHeight
	const scaleLoop = (loop: Vector2[]) => loop.map((point) => new Vector2(point.x * scaleX, point.y * scaleY))

	return {
		outer: scaleLoop(orientedShape.outer),
		holes: orientedShape.holes.map(scaleLoop),
	}
}

function getPointToSegmentDistance(point: Vector2, start: Vector2, end: Vector2): number {
	const dx = end.x - start.x
	const dy = end.y - start.y
	if (dx === 0 && dy === 0) return Vector2.Distance(point, start)

	const t = Math.max(0, Math.min(1, (
		((point.x - start.x) * dx + (point.y - start.y) * dy) /
		(dx * dx + dy * dy)
	)))
	const projection = new Vector2(start.x + dx * t, start.y + dy * t)
	return Vector2.Distance(point, projection)
}

function simplifyPolyline(points: Vector2[], epsilon: number): Vector2[] {
	if (points.length <= 2) return [...points]

	let maxDistance = 0
	let splitIndex = -1
	for (let i = 1; i < points.length - 1; i++) {
		const distance = getPointToSegmentDistance(points[i], points[0], points[points.length - 1])
		if (distance > maxDistance) {
			maxDistance = distance
			splitIndex = i
		}
	}

	if (maxDistance <= epsilon || splitIndex === -1) {
		return [points[0], points[points.length - 1]]
	}

	const left = simplifyPolyline(points.slice(0, splitIndex + 1), epsilon)
	const right = simplifyPolyline(points.slice(splitIndex), epsilon)
	return [...left.slice(0, -1), ...right]
}

function simplifyClosedLoop(points: Vector2[], maxPoints: number, clockwise: boolean): Vector2[] {
	if (points.length <= maxPoints) return normalizeLoop(points, clockwise)

	let minX = Infinity
	let maxX = -Infinity
	let minY = Infinity
	let maxY = -Infinity
	for (const point of points) {
		minX = Math.min(minX, point.x)
		maxX = Math.max(maxX, point.x)
		minY = Math.min(minY, point.y)
		maxY = Math.max(maxY, point.y)
	}

	let anchorIndex = 0
	let maxRadiusSq = -Infinity
	const centerX = (minX + maxX) / 2
	const centerY = (minY + maxY) / 2
	for (let i = 0; i < points.length; i++) {
		const dx = points[i].x - centerX
		const dy = points[i].y - centerY
		const radiusSq = dx * dx + dy * dy
		if (radiusSq > maxRadiusSq) {
			maxRadiusSq = radiusSq
			anchorIndex = i
		}
	}

	const ordered = [
		...points.slice(anchorIndex),
		...points.slice(0, anchorIndex),
		points[anchorIndex],
	]

	const maxDimension = Math.max(maxX - minX, maxY - minY)
	let epsilon = Math.max(maxDimension * PROFILE_SIMPLIFY_START_RATIO, 1e-6)
	let simplified = ordered.slice(0, -1)

	for (let attempt = 0; attempt < 12; attempt++) {
		const simplifiedPolyline = simplifyPolyline(ordered, epsilon)
		simplified = simplifiedPolyline.slice(0, -1)
		if (simplified.length <= maxPoints) break
		epsilon *= 1.6
	}

	return normalizeLoop(simplified, clockwise)
}

function simplifyProfileShape(shape: ProfileShape): ProfileShape {
	return {
		outer: simplifyClosedLoop(shape.outer, MAX_OUTER_PROFILE_POINTS, true),
		holes: shape.holes.map((loop) => simplifyClosedLoop(loop, MAX_INNER_PROFILE_POINTS, false)),
	}
}

function buildLoopsFromEdges(
	allPositions: number[],
	boundaryEdges: Array<[number, number]>,
	axis: AxisIndex,
): Vector2[][] {
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
		loops.push(vertexLoop.map((vertex) => projectVertexToPlane(allPositions, vertex, axis)))
	}

	return loops
}

function extractCapLoops(
	allPositions: number[],
	allIndices: number[],
	targetValue: number,
	tolerance: number,
	allEdgeCounts: Map<string, number>,
	axis: AxisIndex,
): Vector2[][] {
	const planeVertices = new Set<number>()
	for (let vertex = 0; vertex < allPositions.length / 3; vertex++) {
		if (Math.abs(getVertexAxisValue(allPositions, vertex, axis) - targetValue) < tolerance) {
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
		return buildLoopsFromEdges(allPositions, openEndEdges, axis)
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

	return buildLoopsFromEdges(allPositions, cappedEdges, axis)
}

function buildSequentialIndices(vertexCount: number): number[] {
	const indices = new Array<number>(vertexCount)
	for (let i = 0; i < vertexCount; i++) {
		indices[i] = i
	}
	return indices
}

function weldVertices(
	positions: number[],
	indices: number[],
	tolerance = 1e-5,
): { positions: number[]; indices: number[] } {
	const weldedPositions: number[] = []
	const vertexMap = new Map<string, number>()
	const scale = 1 / tolerance
	const vertexCount = positions.length / 3

	// O(V): Build a remap table — old vertex index → welded vertex index
	const remap = new Uint32Array(vertexCount)
	for (let vertex = 0; vertex < vertexCount; vertex++) {
		const x = positions[vertex * 3]
		const y = positions[vertex * 3 + 1]
		const z = positions[vertex * 3 + 2]
		const key = `${Math.round(x * scale)}:${Math.round(y * scale)}:${Math.round(z * scale)}`

		let weldedVertex = vertexMap.get(key)
		if (weldedVertex === undefined) {
			weldedVertex = weldedPositions.length / 3
			weldedPositions.push(x, y, z)
			vertexMap.set(key, weldedVertex)
		}
		remap[vertex] = weldedVertex
	}

	// O(I): Single pass over indices using the remap table
	const weldedIndices = new Array<number>(indices.length)
	for (let i = 0; i < indices.length; i++) {
		weldedIndices[i] = remap[indices[i]]
	}

	return {
		positions: weldedPositions,
		indices: weldedIndices,
	}
}

function extractProfileShape(meshes: Mesh[]): ProfileShape | null {
	const allPositions: number[] = []
	const allIndices: number[] = []
	let vertexOffset = 0

	for (const mesh of meshes) {
		const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
		if (!positions) continue
		const meshIndices = mesh.getIndices()
		const indices = meshIndices && meshIndices.length > 0
			? meshIndices
			: buildSequentialIndices(positions.length / 3)
		for (let i = 0; i < positions.length; i++) {
			allPositions.push(positions[i])
		}
		for (let i = 0; i < indices.length; i++) {
			allIndices.push(indices[i] + vertexOffset)
		}
		vertexOffset += positions.length / 3
	}

	if (allPositions.length < 9 || allIndices.length < 3) return null

	const welded = weldVertices(allPositions, allIndices)
	const weldedPositions = welded.positions
	const weldedIndices = welded.indices

	const allEdgeCounts = new Map<string, number>()
	for (let i = 0; i < weldedIndices.length; i += 3) {
		const a = weldedIndices[i]
		const b = weldedIndices[i + 1]
		const c = weldedIndices[i + 2]

		for (const [u, v] of [[a, b], [b, c], [c, a]] as const) {
			const key = edgeKey(u, v)
			allEdgeCounts.set(key, (allEdgeCounts.get(key) ?? 0) + 1)
		}
	}

	let min = Infinity
	let max = -Infinity
	for (let vertex = 0; vertex < weldedPositions.length / 3; vertex++) {
		const value = getVertexAxisValue(weldedPositions, vertex, 2)
		min = Math.min(min, value)
		max = Math.max(max, value)
	}
	const extent = max - min
	if (extent <= 0) return null

	const tolerance = extent * 0.005
	const minLoops = extractCapLoops(weldedPositions, weldedIndices, min, tolerance, allEdgeCounts, 2)
	const maxLoops = extractCapLoops(weldedPositions, weldedIndices, max, tolerance, allEdgeCounts, 2)
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
	let minY = Infinity
	let maxY = -Infinity
	for (const point of outer) {
		minX = Math.min(minX, point.x)
		maxX = Math.max(maxX, point.x)
		minY = Math.min(minY, point.y)
		maxY = Math.max(maxY, point.y)
	}
	const centerX = (minX + maxX) / 2
	const centerY = (minY + maxY) / 2

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

function appendLoopSideGeometry(
	positions: number[],
	indices: number[],
	loop: SweepLoopInfo,
	pathFrames: PathFrame[],
): void {
	const ringCount = pathFrames.length
	const loopCount = loop.points.length
	if (ringCount < 2 || loopCount < 2) return

	const baseIndex = positions.length / 3
	for (const frame of pathFrames) {
		const binormal = Vector3.Cross(frame.tangent, frame.normal).normalize()
		for (const point of loop.points) {
			const worldPos = frame.position
				.add(frame.normal.scale(point.x))
				.add(binormal.scale(point.y))
			positions.push(worldPos.x, worldPos.y, worldPos.z)
		}
	}

	for (let ring = 0; ring < ringCount - 1; ring++) {
		const ringStart = baseIndex + ring * loopCount
		const nextRingStart = ringStart + loopCount
		for (let i = 0; i < loopCount; i++) {
			const next = (i + 1) % loopCount
			const a = ringStart + i
			const b = ringStart + next
			const c = nextRingStart + i
			const d = nextRingStart + next

			// The loop orientation already encodes whether this ring is outer
			// or inner. Emit the same triangle order for both so the side-wall
			// normals point out of the solid, including the tube interior.
			indices.push(a, c, b)
			indices.push(b, c, d)
		}
	}
}

function appendCapGeometry(
	positions: number[],
	indices: number[],
	shape: ProfileShape,
	frame: PathFrame,
	reverse: boolean,
): void {
	const loops = [shape.outer, ...shape.holes]
	const vertexData: number[] = []
	const holeIndices: number[] = []
	let vertexOffset = 0

	for (let loopIndex = 0; loopIndex < loops.length; loopIndex++) {
		const loop = loops[loopIndex]
		if (loopIndex > 0) {
			holeIndices.push(vertexOffset)
		}
		for (const point of loop) {
			vertexData.push(point.x, point.y)
		}
		vertexOffset += loop.length
	}

	const localIndices = earcut(vertexData, holeIndices, 2)
	const baseIndex = positions.length / 3
	const binormal = Vector3.Cross(frame.tangent, frame.normal).normalize()

	for (const loop of loops) {
		for (const point of loop) {
			const worldPos = frame.position
				.add(frame.normal.scale(point.x))
				.add(binormal.scale(point.y))
			positions.push(worldPos.x, worldPos.y, worldPos.z)
		}
	}

	for (let i = 0; i < localIndices.length; i += 3) {
		const a = baseIndex + localIndices[i]
		const b = baseIndex + localIndices[i + 1]
		const c = baseIndex + localIndices[i + 2]
		if (reverse) {
			indices.push(a, c, b)
		} else {
			indices.push(a, b, c)
		}
	}
}

function buildContinuousArchMesh(
	scene: Scene,
	shape: ProfileShape,
	pathFrames: PathFrame[],
	vertexCacheKey?: string,
): Mesh {
	const mesh = new Mesh('arch-frame-continuous', scene)

	// Check vertex data cache first
	const cached = vertexCacheKey ? ARCH_VERTEX_DATA_CACHE.get(vertexCacheKey) : undefined
	if (cached) {
		const vertexData = new VertexData()
		vertexData.positions = cached.positions
		vertexData.indices = cached.indices
		vertexData.normals = cached.normals
		vertexData.applyToMesh(mesh, true)
		mesh.refreshBoundingInfo()
		return mesh
	}

	const positions: number[] = []
	const indices: number[] = []
	const loops: SweepLoopInfo[] = [
		{ points: shape.outer, clockwise: true },
		...shape.holes.map((points) => ({ points, clockwise: false })),
	]

	for (const loop of loops) {
		appendLoopSideGeometry(positions, indices, loop, pathFrames)
	}

	appendCapGeometry(positions, indices, shape, pathFrames[0], true)
	appendCapGeometry(positions, indices, shape, pathFrames[pathFrames.length - 1], false)

	const normals: number[] = []
	VertexData.ComputeNormals(positions, indices, normals)

	// Cache typed arrays for future re-use
	if (vertexCacheKey) {
		ARCH_VERTEX_DATA_CACHE.set(vertexCacheKey, {
			positions: new Float32Array(positions),
			indices: new Int32Array(indices),
			normals: new Float32Array(normals),
		})
	}

	const vertexData = new VertexData()
	vertexData.positions = positions
	vertexData.indices = indices
	vertexData.normals = normals

	vertexData.applyToMesh(mesh, true)
	mesh.refreshBoundingInfo()
	return mesh
}

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

		onLoadStateChange?.(true)

		const root = new TransformNode('arch-frames-root', scene)
		const allDisposables: (TransformNode | Mesh)[] = [root]

		const archMat = getAluminumClone(scene, 'aluminum-arch', (m) => {
			// Tube is closed by end caps and inner-wall winding is opposite to
			// the outer wall, so backface culling correctly hides the inside.
			m.backFaceCulling = true
			m.twoSidedLighting = false
			// Inherit albedo + roughness from the base material so the arch
			// matches every other aluminum component exactly. Do NOT override
			// roughness here — that's what previously made the arch look
			// brighter/glossier than the uprights.
		})
		const profile = specs.profiles.rafter
		const fallbackShape = buildLowPolyProfileShape(profile.width, profile.height)
		const profileCacheKey = `${SHARED_FRAME_PATH}mainProfile.glb:${profile.width}:${profile.height}:${ARCH_PROFILE_CACHE_VERSION}`

		const buildArchInstances = (profileShape: ProfileShape) => {
			const archPathFrames = buildArchPathFrames(specs)
			const sweepFrames = buildSweepSamples(archPathFrames, getSweepSegmentCount(archPathFrames))
			const halfLength = (numBays * specs.bayDistance) / 2
			const transforms: InstanceTransform[] = []

			// Vertex cache key: depends on profile + arch envelope, NOT numBays
			const vertexCacheKey = `arch:${ARCH_PROFILE_CACHE_VERSION}:${profile.width}:${profile.height}:${specs.archOuterSpan}:${specs.archCrownHalfSpan ?? 'default'}:${specs.eaveHeight}:${specs.ridgeHeight}:${getFrameRafterSlopeAtEave(specs, profile.width)}`
			const archMesh = buildContinuousArchMesh(scene, profileShape, sweepFrames, vertexCacheKey)
			archMesh.material = archMat

			for (let bay = 0; bay <= numBays; bay++) {
				const bayZ = bay * specs.bayDistance - halfLength
				transforms.push({
					position: new Vector3(0, 0, bayZ),
				})
			}

			archMesh.parent = root
			archMesh.position.setAll(0)
			archMesh.rotationQuaternion = null
			archMesh.rotation.setAll(0)
			archMesh.scaling.setAll(1)
			archMesh.setEnabled(true)
			createFrozenThinInstances(archMesh, transforms)
			allDisposables.push(archMesh)
		}

		const cachedProfileShape = ARCH_PROFILE_SHAPE_CACHE.get(profileCacheKey)
		if (cachedProfileShape) {
			buildArchInstances(cachedProfileShape)
			onLoadStateChange?.(false)
			return () => {
				controller.abort()
				for (const d of allDisposables) {
					try { d.dispose() } catch { /* already gone */ }
				}
				// Material is cached — do NOT dispose here
			}
		}

		loadGLB(scene, SHARED_FRAME_PATH, 'mainProfile.glb', controller.signal)
			.then((loaded) => {
				if (controller.signal.aborted) {
					for (const mesh of loaded) mesh.dispose()
					onLoadStateChange?.(false)
					return
				}

				const meshes = loaded.filter(
					(mesh): mesh is Mesh => mesh instanceof Mesh && mesh.getTotalVertices() > 0,
				)
				for (const mesh of loaded) {
					if (!meshes.includes(mesh as Mesh)) {
						try { mesh.dispose() } catch { /* already gone */ }
					}
				}

				if (meshes.length === 0) {
					buildArchInstances(fallbackShape)
					onLoadStateChange?.(false)
					return
				}

				for (const mesh of meshes) {
					mesh.makeGeometryUnique()
				}

				const extractedShape = extractProfileShape(meshes)
				for (const mesh of meshes) {
					try { mesh.dispose() } catch { /* already gone */ }
				}

				const resolvedProfileShape = extractedShape
					? simplifyProfileShape(scaleProfileShape(extractedShape, profile.width, profile.height))
					: fallbackShape

				if (extractedShape) {
					ARCH_PROFILE_SHAPE_CACHE.set(profileCacheKey, resolvedProfileShape)
				}

				buildArchInstances(resolvedProfileShape)
				if (!extractedShape) {
					console.warn('[ArchFrames] Falling back to procedural hollow profile')
				}
				onLoadStateChange?.(false)
			})
			.catch((err) => {
				if (!controller.signal.aborted) {
					console.error('[ArchFrames] Failed:', err)
					buildArchInstances(fallbackShape)
					onLoadStateChange?.(false)
				}
			})

		return () => {
			controller.abort()
			for (const d of allDisposables) {
				try { d.dispose() } catch { /* already gone */ }
			}
			// Material is cached — do NOT dispose here
		}
	}, [scene, enabled, numBays, specs, onLoadStateChange])

	return null
})

ArchFrames.displayName = 'ArchFrames'
