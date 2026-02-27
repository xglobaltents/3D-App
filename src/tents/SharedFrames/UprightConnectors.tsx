import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, createFrozenThinInstances, type InstanceTransform } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

interface UprightConnectorsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

const SHARED_FRAME_PATH = '/tents/SharedFrames/'
const CONNECTOR_GLB = 'upright-connector-r.glb'

/** Cached bounds to avoid repeated computeWorldMatrix calls. */
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

/**
 * UprightConnectors — loads the connector plate GLB and places it at
 * the top of each upright on both sides of the tent, tilted to follow
 * the arch slope.
 *
 * Follows the same pattern as Baseplates: uniform scaling to preserve
 * the original GLB design, then thin instances for GPU efficiency.
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

			boundsCache.clear()

			const root = new TransformNode('upright-connectors-root', scene)
			const allDisposables: (Mesh | TransformNode)[] = [root]

			onLoadStateChange?.(true)

			loadGLB(scene, SHARED_FRAME_PATH, CONNECTOR_GLB, ctrl.signal)
				.then((loaded) => {
					if (ctrl.signal.aborted) {
						for (const m of loaded) m.dispose()
						onLoadStateChange?.(false)
						return
					}

					const rightMeshes = loaded.filter(
						(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
					)

					if (rightMeshes.length === 0) {
						onLoadStateChange?.(false)
						return
					}

					// Dispose non-geometry clones (e.g. __root__) to prevent leaks
					for (const m of loaded) {
						if (!rightMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* already gone */ }
						}
					}

					const mat = getAluminumMaterial(scene)
					stripAndApplyMaterial(rightMeshes, mat)

					// ── Build right-side template ──
					const template = new TransformNode('connector-template', scene)
					for (const m of rightMeshes) {
						m.rotationQuaternion = null
						m.rotation.set(0, 0, 0)
						m.position.setAll(0)
						m.scaling.setAll(1)
						m.parent = template
					}

					template.rotationQuaternion = null
					template.rotation.set(0, 0, 0)
					template.scaling.setAll(1)

					// Uniform scaling to preserve the real GLB design shape.
					const cp = specs.connectorPlate
					const targetDepth = cp?.depth ?? specs.profiles.upright.height
					template.computeWorldMatrix(true)
					const rawBounds = measureWorldBounds(rightMeshes, 'connector-raw')
					if (rawBounds.size.z > 1e-6) {
						const uniformScale = targetDepth / rawBounds.size.z
						template.scaling.setAll(uniformScale)
					}

					// Compute center offset after scaling
					template.computeWorldMatrix(true)
					const scaledBounds = measureWorldBounds(rightMeshes, 'connector-scaled')
					const centerOffsetX = (scaledBounds.min.x + scaledBounds.max.x) / 2
					const centerOffsetZ = (scaledBounds.min.z + scaledBounds.max.z) / 2
					const plateHeight = scaledBounds.size.y

					// ── Clone right meshes to create left-side (mirrored) ──
					const leftMeshes: Mesh[] = []
					for (const m of rightMeshes) {
						const clone = m.clone(m.name + '-left', null)
						if (clone) {
							clone.rotationQuaternion = null
							clone.rotation.set(0, Math.PI, 0)  // mirror via Y rotation
							clone.position.setAll(0)
							clone.scaling.setAll(1)
							clone.material = mat
							clone.setEnabled(false)
							leftMeshes.push(clone)
						}
					}

					// ── Position calculations ──
					const profileWidth = specs.profiles.upright.width
					const halfWidth = specs.halfWidth
					const baseplateTop = specs.baseplate?.height ?? 0
					const rise = specs.ridgeHeight - specs.eaveHeight
					const slope = specs.rafterSlopeAtEave ?? (halfWidth > 1e-6 ? rise / halfWidth : 0.2)
					const tilt = Math.atan(slope)

					// Y position: top of the upright
					const uprightTopY = baseplateTop + specs.eaveHeight
					const yBase = uprightTopY - (plateHeight / 2)

					// X position: inward shift
					const plateLength = scaledBounds.size.x
					const inwardShift = Math.max(0, (plateLength - profileWidth) / 2)

					const totalLength = numBays * specs.bayDistance
					const halfLength = totalLength / 2
					const numLines = numBays + 1

					// ── Right-side transforms ──
					const rightTransforms: InstanceTransform[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength
						rightTransforms.push({
							position: new Vector3(
								-(halfWidth - inwardShift) + centerOffsetX,
								yBase,
								z - centerOffsetZ,
							),
							rotation: new Vector3(Math.PI, 0, -tilt),
							scaling: template.scaling.clone(),
						})
					}

					// ── Left-side transforms ──
					const leftTransforms: InstanceTransform[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength
						leftTransforms.push({
							position: new Vector3(
								(halfWidth - inwardShift) - centerOffsetX,
								yBase,
								z - centerOffsetZ,
							),
							rotation: new Vector3(Math.PI, 0, tilt),
							scaling: template.scaling.clone(),
						})
					}

					// Apply thin instances — right side (original mesh)
					for (const src of rightMeshes) {
						src.parent = root
						src.position.setAll(0)
						src.rotationQuaternion = null
						src.rotation.setAll(0)
						src.scaling.setAll(1)
						src.setEnabled(true)
						createFrozenThinInstances(src, rightTransforms)
						allDisposables.push(src)
					}

					// Apply thin instances — left side (mirrored clones)
					for (const src of leftMeshes) {
						src.parent = root
						src.position.setAll(0)
						src.scaling.setAll(1)
						src.setEnabled(true)
						createFrozenThinInstances(src, leftTransforms)
						allDisposables.push(src)
					}

					// Dispose template container
					template.dispose()

					onLoadStateChange?.(false)
				})
				.catch((err) => {
					if (!ctrl.signal.aborted) {
						console.error('[UprightConnectors] Failed:', err)
					}
					onLoadStateChange?.(false)
				})

			return () => {
				ctrl.abort()
				for (const d of allDisposables) {
					try { d.dispose() } catch { /* already gone */ }
				}
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)
