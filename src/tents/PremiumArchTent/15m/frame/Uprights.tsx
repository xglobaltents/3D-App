import { type FC, useEffect, memo } from 'react'
import { useScene } from 'react-babylonjs'
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, freezeStaticMeshes } from '../../../../lib/utils/GLBLoader'
import { getAluminumMaterial } from '../../../../lib/materials/frameMaterials'
import type { TentSpecs } from '../../../../types'
import { FRAME_PATH } from '../specs'

interface UprightsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
}

function updateWorldBounds(mesh: Mesh): void {
	mesh.computeWorldMatrix(true)
	mesh.refreshBoundingInfo()
	mesh.getBoundingInfo().update(mesh.getWorldMatrix())
}

function measureWorldBounds(meshes: Mesh[]): { min: Vector3; max: Vector3; size: Vector3 } {
	let min = new Vector3(Infinity, Infinity, Infinity)
	let max = new Vector3(-Infinity, -Infinity, -Infinity)
	for (const m of meshes) {
		if (m.getTotalVertices() > 0) {
			updateWorldBounds(m)
			const bb = m.getBoundingInfo().boundingBox
			min = Vector3.Minimize(min, bb.minimumWorld)
			max = Vector3.Maximize(max, bb.maximumWorld)
		}
	}
	return { min, max, size: max.subtract(min) }
}

/**
 * Uprights — loads upright.glb, builds a correctly scaled template,
 * then clones it to every bay line on both sides of the tent.
 *
 * Layout (top-down, looking at Z axis):
 *
 *   L ---+---+---+--- R    ← numBays + 1 lines of uprights
 *        bay  bay  bay
 *
 * Positions are centered on origin:
 *   Z from -totalLength/2 to +totalLength/2
 *   X at ±width/2
 */
export const Uprights: FC<UprightsProps> = memo(({ numBays, specs, enabled = true }) => {
	const scene = useScene()

	useEffect(() => {
		if (!scene || !enabled) return

		const root = new TransformNode('uprights-root', scene)
		let disposed = false
		const allDisposables: (Mesh | TransformNode)[] = []
		const aluminumMat = getAluminumMaterial(scene)

		loadGLB(scene, FRAME_PATH, 'upright.glb')
			.then((loaded) => {
				if (disposed) {
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

				// Z-up → Y-up
				template.rotation.x = -Math.PI / 2

				// Per-axis scaling to match profile specs
				template.computeWorldMatrix(true)
				const rotatedBounds = measureWorldBounds(templateMeshes)

				const profile = specs.profiles.upright
				if (rotatedBounds.size.y > 0) {
					template.scaling.y = specs.eaveHeight / rotatedBounds.size.y
				}
				if (rotatedBounds.size.x > 0) {
					template.scaling.x = profile.width / rotatedBounds.size.x
				}
				if (rotatedBounds.size.z > 0) {
					template.scaling.z = profile.height / rotatedBounds.size.z
				}

				// Find ground offset
				template.computeWorldMatrix(true)
				const { min: finalMin } = measureWorldBounds(templateMeshes)
				const groundY = -finalMin.y

				// ── Place uprights at every bay line, both sides ──
				const halfWidth = specs.width / 2
				const totalLength = numBays * specs.bayDistance
				const halfLength = totalLength / 2
				const numLines = numBays + 1 // fence-post

				for (let i = 0; i < numLines; i++) {
					const z = i * specs.bayDistance - halfLength

					for (const side of [-1, 1] as const) {
						const x = side * halfWidth
						const label = side === -1 ? 'L' : 'R'

						const container = new TransformNode(`upright-${label}-${i}`, scene)
						container.rotation.copyFrom(template.rotation)
						container.scaling.copyFrom(template.scaling)
						container.position.set(x, groundY, z)
						container.parent = root
						allDisposables.push(container)

						for (const src of templateMeshes) {
							const clone = src.clone(`${src.name}-${label}-${i}`, container)
							if (clone) {
								clone.material = aluminumMat
								allDisposables.push(clone)
							}
						}
					}
				}

				// Template served its purpose — dispose it
				for (const m of templateMeshes) m.dispose()
				template.dispose()

				// Freeze all cloned meshes
				const clonedMeshes = allDisposables.filter((d): d is Mesh => d instanceof Mesh)
				freezeStaticMeshes(clonedMeshes)
			})
			.catch((err) => {
				console.error('Uprights: failed to load', err)
				if (!disposed) root.dispose()
			})

		return () => {
			disposed = true
			for (const d of allDisposables) {
				try { d.dispose() } catch { /* already gone */ }
			}
			root.dispose()
		}
	}, [scene, enabled, specs, numBays])

	return null
})
