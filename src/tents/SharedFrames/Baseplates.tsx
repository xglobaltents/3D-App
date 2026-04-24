import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3 } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, createFrozenThinInstances, measureWorldBounds, clearBoundsCache, type InstanceTransform } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

interface BaseplatesProps {
	numBays: number
	specs: TentSpecs
	enabled: boolean
	onLoadStateChange?: (loading: boolean) => void
}


/**
 * Baseplates — loads basePlates.glb, builds a correctly scaled template,
 * then uses thin instances (GPU instancing) at every upright position
 * on both sides of the tent.
 *
 * Layout: (numBays + 1) x 2 baseplates at +/-halfWidth.
 * Thin instances = 1 draw call instead of N*2 clones (#24).
 */
export const Baseplates: FC<BaseplatesProps> = memo(({ numBays, specs, enabled, onLoadStateChange }) => {
	const scene = useScene()
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		if (!scene || !enabled) return

		// Abort previous load if any (#15 — robust cancellation)
		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller

		// Clear stale bounds from previous loads
		clearBoundsCache()

		const root = new TransformNode('baseplates-root', scene)
		const allDisposables: (Mesh | TransformNode)[] = [root]
		const aluminumMat = getAluminumMaterial(scene)

		onLoadStateChange?.(true)

		loadGLB(scene, '/tents/SharedFrames/', 'basePlates.glb', controller.signal)
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
					// Dispose all loaded nodes (e.g. __root__) to prevent leaks
					for (const m of loaded) {
						try { m.dispose() } catch { /* already gone */ }
					}
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

				// ── Build template container ──
				const template = new TransformNode('baseplate-template', scene)
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

				// Rotate 90° around Y so the baseplate's longer side aligns
				// with the tent's Z (length) axis.
				template.rotation.y = Math.PI / 2

				// Uniform scaling to preserve the real scanned shape.
				const bp = specs.baseplate
				template.computeWorldMatrix(true)
				const rawBounds = measureWorldBounds(templateMeshes)
				if (rawBounds.size.x > 0) {
					const uniformScale = bp.width / rawBounds.size.x
					template.scaling.setAll(uniformScale)
				}

				// Compute center offset after rotation + scaling.
				// The baseplate model may not be perfectly symmetric, so after
				// rotation the bounding-box center can shift from the origin.
				// We compensate in the thin instance positions (not mesh positions,
				// which get reset to identity before instancing).
				template.computeWorldMatrix(true)
				const scaledBounds = measureWorldBounds(templateMeshes)
				const centerOffsetX = (scaledBounds.min.x + scaledBounds.max.x) / 2
				const centerOffsetZ = (scaledBounds.min.z + scaledBounds.max.z) / 2

				// Find ground offset (Y only)
				const groundY = -scaledBounds.min.y

				// ── Build thin instance transforms ──
				// Use specs.halfWidth for consistency with other components
				const halfWidth = specs.halfWidth
				const totalLength = numBays * specs.bayDistance
				const halfLength = totalLength / 2
				const numLines = numBays + 1 // fence-post

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

				// Baseplates under each gable support (front + back gable ends),
				// directly below the gable arch centerline.
				const gableSupportPositions = specs.gableSupportPositions ?? []
				if (gableSupportPositions.length > 0) {
					for (const side of [-1, 1] as const) {
						const gableZ = side * halfLength
						for (const gx of gableSupportPositions) {
							transforms.push({
								position: new Vector3(
									gx - centerOffsetX,
									groundY,
									gableZ - centerOffsetZ,
								),
								rotation: template.rotation.clone(),
								scaling: template.scaling.clone(),
							})
						}
					}
				}

				// Apply thin instances to each mesh with geometry
				for (const src of templateMeshes) {
					src.parent = root

					// Reset local transform to identity — thin instance matrices
					// already carry the full rotation/scaling transform.
					src.position.setAll(0)
					src.rotationQuaternion = null
					src.rotation.setAll(0)
					src.scaling.setAll(1)

					// Enable AFTER material is applied (clones start disabled)
					src.setEnabled(true)
					createFrozenThinInstances(src, transforms)
					allDisposables.push(src)
				}

				// Dispose template container (meshes are now parented to root)
				template.dispose()

				onLoadStateChange?.(false)
			})
			.catch((err) => {
				if (!controller.signal.aborted) {
					console.error('Baseplates: failed to load', err)
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