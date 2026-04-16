import { type FC, memo, useEffect, useRef } from 'react'
import { TransformNode, Vector3, Mesh, VertexBuffer } from '@babylonjs/core'
import { useScene } from '@/engine/BabylonProvider'
import { loadGLB, stripAndApplyMaterial, createFrozenThinInstances, measureWorldBounds, clearBoundsCache, type InstanceTransform } from '@/lib/utils/GLBLoader'
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

// ─── Arc-length parameterized arch path with Frenet frames ────────────────────

interface PathFrame {
	position: Vector3
	tangent: Vector3
	normal: Vector3
	arcLength: number
}

const PATH_SAMPLES = 512
const ARCH_SEGMENTS = 24
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

				const straightBounds = measureWorldBounds(meshes, `arch-straight-${profile.width}-${profile.height}`)
				const centerX = (straightBounds.min.x + straightBounds.max.x) / 2
				const centerY = (straightBounds.min.y + straightBounds.max.y) / 2
				const centerZ = (straightBounds.min.z + straightBounds.max.z) / 2
				const unitSegmentLength = straightBounds.size.y > 0 ? straightBounds.size.y : 1

				for (const m of meshes) {
					const positions = m.getVerticesData(VertexBuffer.PositionKind)
					if (!positions) continue
					for (let i = 0; i < positions.length; i += 3) {
						positions[i] -= centerX
						positions[i + 1] -= centerY
						positions[i + 2] -= centerZ
					}
					m.setVerticesData(VertexBuffer.PositionKind, positions)
					m.refreshBoundingInfo()
				}

				const archPathFrames = buildArchPathFrames(specs)
				const totalArcLength = archPathFrames[archPathFrames.length - 1].arcLength
				const segmentLength = totalArcLength / ARCH_SEGMENTS
				const halfLength = (numBays * specs.bayDistance) / 2
				const transforms: InstanceTransform[] = []

				for (let bay = 0; bay <= numBays; bay++) {
					const bayZ = bay * specs.bayDistance - halfLength

					for (let segment = 0; segment < ARCH_SEGMENTS; segment++) {
						const t = (segment + 0.5) / ARCH_SEGMENTS
						const frame = sampleFrameAt(archPathFrames, t)
						const rotationZ = Math.atan2(-frame.tangent.x, frame.tangent.y)

						transforms.push({
							position: new Vector3(frame.position.x, frame.position.y, bayZ),
							rotation: new Vector3(0, 0, rotationZ),
							scaling: new Vector3(1, (segmentLength / unitSegmentLength) * SEGMENT_OVERLAP, 1),
						})
					}
				}

				stripAndApplyMaterial(meshes, archMat)

				for (const m of meshes) {
					m.parent = root
					m.position.setAll(0)
					m.rotationQuaternion = null
					m.rotation.setAll(0)
					m.scaling.setAll(1)
					m.setEnabled(true)
					createFrozenThinInstances(m, transforms)
					allDisposables.push(m)
				}

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
