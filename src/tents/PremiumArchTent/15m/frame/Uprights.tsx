import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3, VertexBuffer } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, createFrozenThinInstances, type InstanceTransform } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'
import { FRAME_PATH } from '../specs'

interface UprightsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

/** Cached bounds result to avoid repeated computeWorldMatrix calls (#14). */
interface BoundsResult { min: Vector3; max: Vector3; size: Vector3 }
const boundsCache = new Map<string, BoundsResult>()


function measureWorldBounds(meshes: Mesh[], cacheKey?: string): BoundsResult {
	if (cacheKey) {
		const cached = boundsCache.get(cacheKey)
		if (cached) return cached
	}
	let min = new Vector3(Infinity, Infinity, Infinity)
	let max = new Vector3(-Infinity, -Infinity, -Infinity)
	for (const m of meshes) {
		if (m.getTotalVertices() > 0) {
			m.computeWorldMatrix(true)
			m.refreshBoundingInfo()
			m.getBoundingInfo().update(m.getWorldMatrix())
			const bb = m.getBoundingInfo().boundingBox
			min = Vector3.Minimize(min, bb.minimumWorld)
			max = Vector3.Maximize(max, bb.maximumWorld)
		}
	}
	const result = { min, max, size: max.subtract(min) }
	if (cacheKey) boundsCache.set(cacheKey, result)
	return result
}

// ─── Miter cut helpers ───────────────────────────────────────────────────────

/**
 * Apply a miter cut to the top-face vertices of an upright mesh in
 * model space (Z-up).
 *
 * The cut slopes outward and downward so the connector surface matches
 * the rafter angle at the eave:
 *
 *        HIGH                    HIGH
 *        ╲  (right)      (left)  ╱
 *         ╲                     ╱
 *          LOW                LOW
 *
 * Right upright (+halfWidth): inner = −X → HIGH, outer = +X → LOW
 * Left  upright (−halfWidth): inner = +X → HIGH, outer = −X → LOW
 *
 * @param mesh             Mesh with *unique* geometry (call makeGeometryUnique first)
 * @param modelSlopePerX   dZ / dX ratio in model space (accounts for non-uniform scaling)
 * @param outerIsPositiveX true for RIGHT uprights, false for LEFT
 */
function applyMiterToVertices(
	mesh: Mesh,
	modelSlopePerX: number,
	outerIsPositiveX: boolean,
): void {
	const positions = mesh.getVerticesData(VertexBuffer.PositionKind)
	if (!positions || modelSlopePerX === 0) return

	// Gather model-space bounds
	let minX = Infinity, maxX = -Infinity
	let minZ = Infinity, maxZ = -Infinity
	for (let i = 0; i < positions.length; i += 3) {
		const x = positions[i]
		const z = positions[i + 2]
		if (x < minX) minX = x
		if (x > maxX) maxX = x
		if (z < minZ) minZ = z
		if (z > maxZ) maxZ = z
	}
	const zRange = maxZ - minZ
	if (zRange <= 0) return

	// Tight tolerance — only captures top-face verts of the extruded profile
	const tolerance = zRange * 0.001

	for (let i = 0; i < positions.length; i += 3) {
		if (positions[i + 2] >= maxZ - tolerance) {
			const x = positions[i]
			// Drop increases toward the outer edge
			const drop = outerIsPositiveX
				? modelSlopePerX * (x - minX)   // RIGHT: drops as X increases
				: modelSlopePerX * (maxX - x)   // LEFT:  drops as X decreases
			positions[i + 2] -= drop
		}
	}

	mesh.setVerticesData(VertexBuffer.PositionKind, positions)

	// Keep original GLB smooth normals — the miter angle (~16°) is small
	// enough that the original normals shade correctly with PBR, and
	// recomputing flat normals breaks the PBR lighting pipeline.
	mesh.refreshBoundingInfo()
}

/*
 * Miter drop (metres) across the upright profile:
 *   drop = rafterSlopeAtEave × profileWidth
 *
 * 15 m → 0.2977 × 0.212 = 0.0631 m (63.1 mm)
 * 20 m → 0.3116 × 0.212 = 0.0661 m (66.1 mm)
 */

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Uprights — loads upright.glb, builds correctly scaled templates with
 * miter-cut tops, then uses thin instances (GPU instancing) at every
 * bay line on both sides of the tent.
 *
 * The miter cut on the top of each upright matches the rafter slope
 * at the eave, creating a proper connector surface for the arch.
 * Left and right sides have opposite cut directions (both slope
 * outward-and-downward).
 *
 * Layout (top-down, looking at Z axis):
 *
 *   L ---+---+---+--- R    <- numBays + 1 lines of uprights
 *        bay  bay  bay
 *
 * Thin instances = 1 draw call per side instead of N*2 clones (#24).
 */
export const Uprights: FC<UprightsProps> = memo(({ numBays, specs, enabled = true, onLoadStateChange }) => {
	const scene = useScene()
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		if (!scene || !enabled) return

		// Abort previous load if any (#15)
		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller

		// Clear stale bounds from previous loads
		boundsCache.clear()

		const root = new TransformNode('uprights-root', scene)
		const allDisposables: (Mesh | TransformNode)[] = [root]
		const aluminumMat = getAluminumMaterial(scene)

		onLoadStateChange?.(true)

		loadGLB(scene, FRAME_PATH, 'upright.glb', controller.signal)
			.then((loaded) => {
				if (controller.signal.aborted) {
					for (const m of loaded) m.dispose()
					onLoadStateChange?.(false)
					return
				}

				const templateMeshes = loaded.filter(
					(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
				)
				if (templateMeshes.length === 0) {
					onLoadStateChange?.(false)
					return
				}

				// Dispose non-geometry clones (e.g. __root__) to prevent leaks
				for (const m of loaded) {
					if (!templateMeshes.includes(m as Mesh)) {
						try { m.dispose() } catch { /* already gone */ }
					}
				}

				stripAndApplyMaterial(templateMeshes, aluminumMat)

				// ── Miter parameters ──
				const rafterSlope = specs.rafterSlopeAtEave ?? 0
				const hasMiter = rafterSlope > 0

				// Make geometry unique so vertex modifications don't affect
				// the shared GLB cache templates.
				if (hasMiter) {
					for (const m of templateMeshes) m.makeGeometryUnique()
				}

				// Clone meshes for left-side miter BEFORE any vertex edits
				// so the clones start from unmodified geometry.
				let leftMeshes: Mesh[] = []
				if (hasMiter) {
					leftMeshes = templateMeshes
						.map((m) => {
							const clone = m.clone(m.name + '-left', null)
							if (clone instanceof Mesh) {
								clone.makeGeometryUnique()
								clone.material = aluminumMat
								return clone
							}
							return null
						})
						.filter((m): m is Mesh => m !== null)
				}

				// ── Build template container ──
				const template = new TransformNode('upright-template', scene)
				for (const m of templateMeshes) {
					m.rotationQuaternion = null
					m.rotation.set(0, 0, 0)
					m.position.setAll(0)
					m.scaling.setAll(1)
					m.parent = template
				}

				template.rotationQuaternion = null
				template.rotation.set(0, 0, 0)
				template.scaling.setAll(1)

				// Z-up -> Y-up
				template.rotation.x = -Math.PI / 2

				// Per-axis scaling to match profile specs
				template.computeWorldMatrix(true)

				const profile = specs.profiles.upright
				const rotatedBounds = measureWorldBounds(templateMeshes, `uprights-rotated-${profile.width}-${profile.height}-${specs.eaveHeight}`)
				if (rotatedBounds.size.x > 0) {
					template.scaling.x = profile.width / rotatedBounds.size.x
				}
				// rotation.x = -PI/2 swaps local Y<->Z in world space:
				//   scaling.z -> world Y (height), scaling.y -> world Z (depth)
				if (rotatedBounds.size.y > 0) {
					template.scaling.z = specs.eaveHeight / rotatedBounds.size.y
				}
				if (rotatedBounds.size.z > 0) {
					template.scaling.y = profile.height / rotatedBounds.size.z
				}

				// ── Apply miter cut to vertex data ──
				// Model-space slope accounts for non-uniform scaling:
				//   worldSlope = rafterSlopeAtEave = worldYDrop / worldXExtent
				//   worldX = modelX × scaling.x,  worldY = modelZ × scaling.z
				//   ⟹ modelSlope = worldSlope × (scaling.x / scaling.z)
				if (hasMiter) {
					const modelSlopePerX =
						rafterSlope * (template.scaling.x / template.scaling.z)

					for (const m of templateMeshes) {
						applyMiterToVertices(m, modelSlopePerX, true)   // RIGHT
					}
					for (const m of leftMeshes) {
						applyMiterToVertices(m, modelSlopePerX, false)  // LEFT
					}
				}

				// Compute center offset after rotation + asymmetric scaling.
				template.computeWorldMatrix(true)
				const finalBounds = measureWorldBounds(templateMeshes)
				const centerOffsetX = (finalBounds.min.x + finalBounds.max.x) / 2
				const centerOffsetZ = (finalBounds.min.z + finalBounds.max.z) / 2

				// Uprights sit on top of baseplates
				const groundY = -finalBounds.min.y + specs.baseplate.height

				// ── Build thin instance transforms ──
				const halfWidth = specs.width / 2
				const totalLength = numBays * specs.bayDistance
				const halfLength = totalLength / 2
				const numLines = numBays + 1 // fence-post

				if (hasMiter) {
					// Separate transforms for left/right (asymmetric miter)
					const rightTransforms: InstanceTransform[] = []
					const leftTransforms: InstanceTransform[] = []

					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength
						rightTransforms.push({
							position: new Vector3(
								halfWidth - centerOffsetX,
								groundY,
								z - centerOffsetZ,
							),
							rotation: template.rotation.clone(),
							scaling: template.scaling.clone(),
						})
						leftTransforms.push({
							position: new Vector3(
								-halfWidth - centerOffsetX,
								groundY,
								z - centerOffsetZ,
							),
							rotation: template.rotation.clone(),
							scaling: template.scaling.clone(),
						})
					}

					// Right-side uprights (template meshes with right miter)
					for (const src of templateMeshes) {
						src.parent = root
						src.position.setAll(0)
						src.rotationQuaternion = null
						src.rotation.setAll(0)
						src.scaling.setAll(1)
						src.setEnabled(true)
						createFrozenThinInstances(src, rightTransforms)
						allDisposables.push(src)
					}

					// Left-side uprights (cloned meshes with left miter)
					for (const src of leftMeshes) {
						src.parent = root
						src.position.setAll(0)
						src.rotationQuaternion = null
						src.rotation.setAll(0)
						src.scaling.setAll(1)
						src.setEnabled(true)
						createFrozenThinInstances(src, leftTransforms)
						allDisposables.push(src)
					}
				} else {
					// No miter — original symmetric behaviour
					const transforms: InstanceTransform[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength
						for (const side of [-1, 1] as const) {
							transforms.push({
								position: new Vector3(
									side * halfWidth - centerOffsetX,
									groundY,
									z - centerOffsetZ,
								),
								rotation: template.rotation.clone(),
								scaling: template.scaling.clone(),
							})
						}
					}

					for (const src of templateMeshes) {
						src.parent = root
						src.position.setAll(0)
						src.rotationQuaternion = null
						src.rotation.setAll(0)
						src.scaling.setAll(1)
						src.setEnabled(true)
						createFrozenThinInstances(src, transforms)
						allDisposables.push(src)
					}
				}

				// Dispose template container
				template.dispose()

				onLoadStateChange?.(false)
			})
			.catch((err) => {
				if (!controller.signal.aborted) {
					console.error('Uprights: failed to load', err)
				}
				onLoadStateChange?.(false)
			})

		return () => {
			controller.abort()
			for (const d of allDisposables) {
				try { d.dispose() } catch { /* already gone */ }
			}
		}
	}, [scene, enabled, specs, numBays, onLoadStateChange])

	return null
})
