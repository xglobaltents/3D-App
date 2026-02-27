import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3 } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, createFrozenThinInstances, type InstanceTransform } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ─── Constants ───────────────────────────────────────────────────────────────

const SHARED_FRAME_PATH = '/tents/SharedFrames/'
const CONNECTOR_GLB     = 'upright-connector-r.glb'

const HMR_VERSION = (() => {
	if (!import.meta.hot) return 0
	const data = import.meta.hot.data as { uprightConnectorsVersion?: number }
	data.uprightConnectorsVersion = (data.uprightConnectorsVersion ?? 0) + 1
	return data.uprightConnectorsVersion
})()

function clamp(v: number, lo: number, hi: number) {
	return Math.max(lo, Math.min(hi, v))
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface BoundsResult { min: Vector3; max: Vector3; size: Vector3 }

function measureWorldBounds(meshes: Mesh[]): BoundsResult {
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
	return { min, max, size: max.subtract(min) }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface UprightConnectorsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

/**
 * UprightConnectors — places connector plates on top of each upright,
 * tilted to match the miter-cut surface angle.
 *
 * Same pattern as Baseplates / Uprights:
 *   1. Parent meshes to template with rotation.x = -PI/2 (flatten)
 *   2. Compute per-axis scaling from world bounds
 *   3. Keep flatten + scaling on the MESH itself
 *   4. Instances carry ONLY tilt + position
 *
 * Babylon thin instances: finalMatrix = instanceMatrix × meshWorldMatrix
 * So mesh carries flatten+scale, instance carries tilt+position.
 * No gimbal lock because the -PI/2 is on the mesh, not in the instance Euler.
 *
 * Left-side connectors use plain cloned geometry (same scaling/material).
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
			const disposables: (Mesh | TransformNode)[] = [root]
			const mat = getAluminumMaterial(scene)

			onLoadStateChange?.(true)

			loadGLB(scene, SHARED_FRAME_PATH, CONNECTOR_GLB, ctrl.signal)
				.then((loaded) => {
					if (ctrl.signal.aborted) {
						for (const m of loaded) m.dispose()
						onLoadStateChange?.(false)
						return
					}

					// ── Keep only real geometry ──────────────────────
					const rightMeshes = loaded.filter(
						(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
					)
					if (rightMeshes.length === 0) {
						console.warn('[UprightConnectors] No geometry in GLB')
						onLoadStateChange?.(false)
						return
					}

					for (const m of loaded) {
						if (!rightMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* already gone */ }
						}
					}

					stripAndApplyMaterial(rightMeshes, mat)
					for (const m of rightMeshes) m.makeGeometryUnique()

					// ── Left-side meshes (plain clones, same as Uprights pattern) ──
					const leftMeshes = rightMeshes
						.map((m) => {
							const clone = m.clone(m.name + '-L', null)
							if (clone instanceof Mesh) {
								clone.makeGeometryUnique()
								clone.material = mat
								return clone
							}
							return null
						})
						.filter((m): m is Mesh => m !== null)

					// ── Template for measuring ───────────────────────
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

					// Flatten: local Y → world -Z, local Z → world +Y
					template.rotation.x = -Math.PI / 2

					// ── Target world dimensions ──────────────────────
					const pw = specs.profiles.upright.width   // 0.212
					const ph = specs.profiles.upright.height  // 0.112
					const cp = specs.connectorPlate

					const targetX = cp?.length ?? (2 * pw) // 0.424 — across tent
					const targetY = cp?.height ?? pw        // 0.212 — face height
					const targetZ = cp?.depth  ?? ph        // 0.112 — along tent

					// ── Per-axis scaling ─────────────────────────────
					// After rotation.x = -PI/2:
					//   scaling.x → world X
					//   scaling.z → world Y  (local Z → world +Y)
					//   scaling.y → world Z  (local Y → world -Z)
					template.computeWorldMatrix(true)
					const rawBounds = measureWorldBounds(rightMeshes)

					if (rawBounds.size.x > 0) template.scaling.x = targetX / rawBounds.size.x
					if (rawBounds.size.y > 0) template.scaling.z = targetY / rawBounds.size.y
					if (rawBounds.size.z > 0) template.scaling.y = targetZ / rawBounds.size.z

					// ── Center offset (world space) ──────────────────
					template.computeWorldMatrix(true)
					const finalBounds = measureWorldBounds(rightMeshes)
					const cx = (finalBounds.min.x + finalBounds.max.x) / 2
					const cy = (finalBounds.min.y + finalBounds.max.y) / 2
					const cz = (finalBounds.min.z + finalBounds.max.z) / 2

					// Save template rotation + scaling to apply on meshes
					const meshRotation = template.rotation.clone()
					const meshScaling = template.scaling.clone()

					// ── Miter / slope geometry ───────────────────────
					const hw = specs.halfWidth
					const bpTop = specs.baseplate?.height ?? 0
					const rise = specs.ridgeHeight - specs.eaveHeight
					const slope = specs.rafterSlopeAtEave ?? (hw > 1e-6 ? rise / hw : 0.2)
					const tilt = Math.atan(slope)
					const drop = clamp(slope * pw, 0.01, 0.12)

					const sinT = Math.sin(tilt)
					const cosT = Math.cos(tilt)

					const innerTopY = bpTop + specs.eaveHeight
					const outerTopY = innerTopY - drop
					const miterMidY = (innerTopY + outerTopY) / 2

					// Half face height along miter normal
					const halfFaceH = targetY / 2
					const normalOffsetX = sinT * halfFaceH
					const normalOffsetY = cosT * halfFaceH

					// Plate extends inward only
					const inwardShift = (targetX - pw) / 2

					// ── Thin-instance transforms ─────────────────────
					// Instances carry ONLY tilt + position.
					// Flatten + scaling lives on the mesh world matrix.
					// Final = instanceMatrix × meshWorldMatrix
					//       = Tilt(Z) × Position  ×  Flatten(X) × Scale
					const totLen = numBays * specs.bayDistance
					const halfLen = totLen / 2
					const nLines = numBays + 1

					const rightTransforms: InstanceTransform[] = []
					const leftTransforms: InstanceTransform[] = []

					for (let i = 0; i < nLines; i++) {
						const z = i * specs.bayDistance - halfLen

						rightTransforms.push({
							position: new Vector3(
								hw - inwardShift + normalOffsetX - cx,
								miterMidY + normalOffsetY - cy,
								z - cz,
							),
							rotation: new Vector3(0, 0, -tilt),
						})

						leftTransforms.push({
							position: new Vector3(
								-hw + inwardShift - normalOffsetX + cx,
								miterMidY + normalOffsetY - cy,
								z - cz,
							),
							rotation: new Vector3(0, 0, tilt),
						})
					}

					// ── Apply: mesh carries flatten+scaling,
					//           instances carry tilt+position ─────────
					for (const m of rightMeshes) {
						m.parent = root
						m.position.setAll(0)
						m.rotationQuaternion = null
						m.rotation.copyFrom(meshRotation)
						m.scaling.copyFrom(meshScaling)
						m.setEnabled(true)
						createFrozenThinInstances(m, rightTransforms)
						disposables.push(m)
					}

					for (const m of leftMeshes) {
						m.parent = root
						m.position.setAll(0)
						m.rotationQuaternion = null
						m.rotation.copyFrom(meshRotation)
						m.scaling.copyFrom(meshScaling)
						m.setEnabled(true)
						createFrozenThinInstances(m, leftTransforms)
						disposables.push(m)
					}

					template.dispose()
					onLoadStateChange?.(false)
				})
				.catch((err) => {
					if (!ctrl.signal.aborted) {
						console.error('[UprightConnectors] GLB load failed:', err)
					}
					onLoadStateChange?.(false)
				})

			return () => {
				ctrl.abort()
				for (const d of disposables) {
					try { d.dispose() } catch { /* already gone */ }
				}
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange, HMR_VERSION])

		return null
	},
)