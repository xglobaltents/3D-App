import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core'
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

/** Invalidate all cached bounds — call when tent specs change. */
export function clearUprightsBoundsCache(): void { boundsCache.clear() }

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

/**
 * Uprights — loads upright.glb, builds a correctly scaled template,
 * then uses thin instances (GPU instancing) at every bay line on
 * both sides of the tent.
 *
 * Layout (top-down, looking at Z axis):
 *
 *   L ---+---+---+--- R    <- numBays + 1 lines of uprights
 *        bay  bay  bay
 *
 * Thin instances = 1 draw call instead of N*2 clones (#24).
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

		const root = new TransformNode('uprights-root', scene)
		const allDisposables: (Mesh | TransformNode)[] = [root]
		const aluminumMat = getAluminumMaterial(scene)

		onLoadStateChange?.(true)

		loadGLB(scene, FRAME_PATH, 'upright.glb', controller.signal)
			.then((loaded) => {
				if (controller.signal.aborted) {
					for (const m of loaded) m.dispose()
					return
				}

				const templateMeshes = loaded.filter(
					(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
				)
				if (templateMeshes.length === 0) return

				stripAndApplyMaterial(templateMeshes, aluminumMat)

				// ── Build template container ──
				const template = new TransformNode('upright-template', scene)
				for (const m of templateMeshes) {
					m.rotationQuaternion = null
					m.rotation.set(0, 0, 0)
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

				// Find ground offset
				template.computeWorldMatrix(true)
				const { min: finalMin } = measureWorldBounds(templateMeshes)
				const groundY = -finalMin.y

				// ── Build thin instance transforms ──
				const halfWidth = specs.width / 2
				const totalLength = numBays * specs.bayDistance
				const halfLength = totalLength / 2
				const numLines = numBays + 1 // fence-post

				const transforms: InstanceTransform[] = []
				for (let i = 0; i < numLines; i++) {
					const z = i * specs.bayDistance - halfLength
					for (const side of [-1, 1] as const) {
						transforms.push({
							position: new Vector3(side * halfWidth, groundY, z),
							rotation: template.rotation.clone(),
							scaling: template.scaling.clone(),
						})
					}
				}

				// Apply thin instances to each mesh with geometry
				for (const src of templateMeshes) {
					src.parent = root
					src.setEnabled(true)
					src.material = aluminumMat
					createFrozenThinInstances(src, transforms)
					allDisposables.push(src)
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
