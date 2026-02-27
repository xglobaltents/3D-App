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

/** GLB is authored in mm — uniform scale to metres. */
const MODEL_SCALE = 0.001

/**
 * Connector-pivot offsets measured via PartBuilder on the 15 m tent.
 * These are model-geometry constants — independent of tent size.
 *
 * X_OFFSET: inward from the eave line to the connector pivot.
 * Y_OFFSET: above the upright top to the connector pivot.
 */
const X_OFFSET = 0.402 // halfWidth − |placement.x| = 7.5 − 7.098
const Y_OFFSET = 0.191 // placement.y − (baseplateTop + eaveHeight) = 3.691 − 3.5

/**
 * UprightConnectors — loads the connector plate GLB and places it at
 * the top of each upright on both sides of the tent.
 *
 * Right side uses the original mesh; left side uses a clone mirrored
 * via rotation.y = π.  Thin instances for GPU efficiency.
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

					// Dispose non-geometry nodes (e.g. __root__) to prevent leaks
					for (const m of loaded) {
						if (!rightMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* already gone */ }
						}
					}

					const mat = getAluminumMaterial(scene)
					stripAndApplyMaterial(rightMeshes, mat)

					// Reset mesh transforms — thin instances carry all placement data
					for (const m of rightMeshes) {
						m.rotationQuaternion = null
						m.rotation.setAll(0)
						m.position.setAll(0)
						m.scaling.setAll(1)
					}

					// Clone right meshes for left-side (mirrored via rotation.y = π)
					const leftMeshes: Mesh[] = []
					for (const m of rightMeshes) {
						const clone = m.clone(m.name + '-left', null)
						if (clone) {
							clone.rotationQuaternion = null
							clone.rotation.set(0, Math.PI, 0)
							clone.position.setAll(0)
							clone.scaling.setAll(1)
							clone.material = mat
							clone.setEnabled(false)
							leftMeshes.push(clone)
						}
					}

					// ── Position calculations ──
					const halfWidth = specs.halfWidth
					const baseplateTop = specs.baseplate?.height ?? 0
					const yPos = baseplateTop + specs.eaveHeight + Y_OFFSET

					const totalLength = numBays * specs.bayDistance
					const halfLength = totalLength / 2
					const numLines = numBays + 1

					const scaling = new Vector3(MODEL_SCALE, MODEL_SCALE, MODEL_SCALE)

					// ── Right-side transforms ──
					const rightTransforms: InstanceTransform[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength
						rightTransforms.push({
							position: new Vector3(-(halfWidth - X_OFFSET), yPos, z),
							rotation: new Vector3(Math.PI, 0, 0),
							scaling,
						})
					}

					// ── Left-side transforms (x-mirrored) ──
					const leftTransforms: InstanceTransform[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength
						leftTransforms.push({
							position: new Vector3(halfWidth - X_OFFSET, yPos, z),
							rotation: new Vector3(Math.PI, 0, 0),
							scaling,
						})
					}

					// Apply thin instances — right side
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
