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

/**
 * Connector-pivot offsets measured via PartBuilder on the 15 m tent.
 *
 * X_OFFSET: inward from the eave line to the connector pivot.
 * Y_OFFSET: above the upright top (miter-cut inner edge) to the connector pivot.
 */
const X_OFFSET = 0.435
const Y_OFFSET = 0.262

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
 * the top of each upright on both sides of the tent.
 *
 * Follows the exact Baseplates pattern:
 * - Single mesh set, ALL transforms (both sides) in one array
 * - No cloning — one thin-instance buffer per mesh
 * - Bounds-based center offset compensation
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

			// Clear stale bounds from previous loads
			boundsCache.clear()

			const root = new TransformNode('upright-connectors-root', scene)
			const allDisposables: (Mesh | TransformNode)[] = [root]

			// Clone material ONCE per effect — track for disposal so re-runs
			// don't leak materials. backFaceCulling=false needed for handedness.
			const connectorMat = getAluminumMaterial(scene).clone('aluminum-connectors')
			connectorMat.backFaceCulling = false

			onLoadStateChange?.(true)

			loadGLB(scene, SHARED_FRAME_PATH, CONNECTOR_GLB, ctrl.signal)
				.then((loaded) => {
					if (ctrl.signal.aborted) {
						for (const m of loaded) {
							try { m.dispose() } catch { /* already gone */ }
						}
						onLoadStateChange?.(false)
						return
					}

					// ── Filter geometry meshes ──
					const templateMeshes = loaded.filter(
						(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
					)

					if (templateMeshes.length === 0) {
						console.warn('[UprightConnectors] No geometry meshes found in GLB')
						for (const m of loaded) {
							try { m.dispose() } catch { /* already gone */ }
						}
						onLoadStateChange?.(false)
						return
					}

					// ── Dispose non-geometry clones (e.g. __root__) ──
					for (const m of loaded) {
						if (!templateMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* already gone */ }
						}
					}

					// ── Apply material ──
					stripAndApplyMaterial(templateMeshes, connectorMat)

					// ── Build template container (same as Baseplates) ──
					const template = new TransformNode('connector-template', scene)
					for (const m of templateMeshes) {
						m.rotationQuaternion = null
						m.rotation.set(0, 0, 0)
						m.position.setAll(0)
						m.scaling.setAll(1)
						m.parent = template
					}

					template.rotationQuaternion = null
					template.rotation.set(0, 0, 0)
					template.scaling.setAll(0.001) // mm → m

					// ── Compute center offset (same as Baseplates) ──
					// Compensates for non-symmetric GLB model origin
					template.computeWorldMatrix(true)
					const scaledBounds = measureWorldBounds(templateMeshes, 'connector-scaled')
					const centerOffsetX = (scaledBounds.min.x + scaledBounds.max.x) / 2
					const centerOffsetZ = (scaledBounds.min.z + scaledBounds.max.z) / 2

					// ── Position calculations ──
					const halfWidth = specs.halfWidth
					const baseplateTop = specs.baseplate?.height ?? 0
					const yPos = baseplateTop + specs.eaveHeight + Y_OFFSET

					const totalLength = numBays * specs.bayDistance
					const halfLength = totalLength / 2
					const numLines = numBays + 1

					// ── ALL transforms in one array (same as Baseplates) ──
					const transforms: InstanceTransform[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength

						// Right side
						transforms.push({
							position: new Vector3(
								-(halfWidth - X_OFFSET) - centerOffsetX,
								yPos,
								z - centerOffsetZ,
							),
							rotation: new Vector3(0, Math.PI, 0),
							scaling: template.scaling.clone(),
						})

						// Left side (mirrored)
						transforms.push({
							position: new Vector3(
								(halfWidth - X_OFFSET) - centerOffsetX,
								yPos,
								z - centerOffsetZ,
							),
							rotation: new Vector3(0, 0, 0),
							scaling: template.scaling.clone(),
						})
					}

					// ── Apply thin instances to each mesh (same as Baseplates) ──
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

					// Dispose template container
					template.dispose()

					onLoadStateChange?.(false)
				})
				.catch((err) => {
					if (!ctrl.signal.aborted) {
						console.error('[UprightConnectors] Failed to load:', err)
					}
					onLoadStateChange?.(false)
				})

			return () => {
				ctrl.abort()
				for (const d of allDisposables) {
					try { d.dispose() } catch { /* already gone */ }
				}
				// Dispose cloned material to prevent leak on re-runs
				try { connectorMat.dispose() } catch { /* already gone */ }
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)

UprightConnectors.displayName = 'UprightConnectors'