import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ═════════════════════════════════════════════════════════════
// Part:  Eave Side Beam
// GLB:   /tents/SharedFrames/eave-side-beam.glb
// ═════════════════════════════════════════════════════════════
//
// Raw GLB axes → target specs mapping:
//   GLB X → eaveBeam profile width  (beam cross-section)
//   GLB Y → eaveBeam profile height (beam cross-section)
//   GLB Z → beam length (one bay span = specs.bayDistance)
//
// PLACEMENT:
//   X: ±(halfWidth + upright.width/2 + eaveBeam.height/2)
//   Y: baseplateTop + eaveHeight - eaveBeam.width/2
//   Z: bay midpoints between frame lines
//
// INSTANCE PATTERN: bay-to-bay × 2 sides
//   Count: numBays × 2
// ═════════════════════════════════════════════════════════════

interface EaveSideBeamsProps {
	numBays: number
	specs: TentSpecs
	enabled: boolean
	onLoadStateChange?: (loading: boolean) => void
}

const FOLDER = '/tents/SharedFrames/'
const FILE = 'eave-side-beam.glb'
const MODEL_ROT_Q = Quaternion.FromEulerAngles(0, Math.PI, 0)
// Left side (positive X) = export placement. Right side = mirrored with Y=PI.
const PART_ROT_LEFT  = Quaternion.FromEulerAngles(0, 0, -Math.PI)
const PART_ROT_RIGHT = Quaternion.FromEulerAngles(0, Math.PI, -Math.PI)

/** Measure combined axis-aligned bounding box of geometry meshes. */
function measureRawBounds(meshes: Mesh[]): Vector3 {
	let min = new Vector3(Infinity, Infinity, Infinity)
	let max = new Vector3(-Infinity, -Infinity, -Infinity)
	for (const m of meshes) {
		if (m.getTotalVertices() > 0) {
			m.computeWorldMatrix(true)
			m.refreshBoundingInfo()
			const bb = m.getBoundingInfo().boundingBox
			min = Vector3.Minimize(min, bb.minimumWorld)
			max = Vector3.Maximize(max, bb.maximumWorld)
		}
	}
	return max.subtract(min)
}

/**
 * EaveSideBeams — horizontal beams running along both eave sides,
 * spanning between adjacent bay lines.
 *
 * Scaling is computed dynamically from GLB raw bounds → specs profile
 * dimensions, not hardcoded from PartBuilder measurements.
 *
 * Layout: numBays beams per side × 2 sides.
 */
export const EaveSideBeams: FC<EaveSideBeamsProps> = memo(({ numBays, specs, enabled, onLoadStateChange }) => {
	const scene = useScene()
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		if (!scene || !enabled) return

		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller

		const root = new TransformNode('eave-side-beams-root', scene)
		const allDisposables: (Mesh | TransformNode)[] = [root]
		const aluminumMat = getAluminumMaterial(scene)

		onLoadStateChange?.(true)

		loadGLB(scene, FOLDER, FILE, controller.signal)
			.then((loaded) => {
				if (controller.signal.aborted) {
					for (const m of loaded) m.dispose()
					onLoadStateChange?.(false)
					return
				}

				const geoMeshes = loaded.filter(
					(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
				)
				if (geoMeshes.length === 0) {
					for (const m of loaded) { try { m.dispose() } catch { /* gone */ } }
					onLoadStateChange?.(false)
					return
				}

				for (const m of loaded) {
					if (!geoMeshes.includes(m as Mesh)) {
						try { m.dispose() } catch { /* gone */ }
					}
				}

				stripAndApplyMaterial(geoMeshes, aluminumMat)

				// Capture each mesh's local transform from the GLB
				const meshLocals = new Map<Mesh, Matrix>()
				for (const mesh of geoMeshes) {
					const rot = mesh.rotationQuaternion?.clone()
						?? Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
					meshLocals.set(mesh, Matrix.Compose(mesh.scaling.clone(), rot, mesh.position.clone()))
					console.log('[EaveSideBeams] mesh', mesh.name, 'pos:', mesh.position.toString(), 'scale:', mesh.scaling.toString(), 'rotQ:', mesh.rotationQuaternion?.toString())
				}

				// Compute scale from raw GLB bounds → specs profile dimensions
				const rawSize = measureRawBounds(geoMeshes)
				const profile = specs.profiles.eaveBeam
				const scaleX = rawSize.x > 0 ? profile.width / rawSize.x : 1
				const scaleY = rawSize.y > 0 ? profile.height / rawSize.y : 1
				// Beam length = one bay span
				const scaleZ = rawSize.z > 0 ? specs.bayDistance / rawSize.z : 1
				const modelScale = new Vector3(scaleX, scaleY, scaleZ)

				console.log('[EaveSideBeams] rawSize:', rawSize.toString(), 'scale:', modelScale.toString(), 'target profile:', profile.width, profile.height, 'bayDist:', specs.bayDistance)
				// modelMatrix: scale + GLTF handedness rotation
				const modelMatrix = Matrix.Compose(modelScale, MODEL_ROT_Q, Vector3.Zero())

				// Placement offsets derived from profiles:
				//   X: beam sits just outside the upright — offset by half upright + half beam depth
				//   Y: beam top aligns with eave — center is half beam width below eave
				const baseplateTop = specs.baseplate?.height ?? 0
				const xOffset = specs.profiles.upright.width / 2 + profile.height / 2
				const halfLength = (numBays * specs.bayDistance) / 2
				const y = baseplateTop + specs.eaveHeight - profile.width / 2

				const partMatrices: Matrix[] = []
				for (let bay = 0; bay < numBays; bay++) {
					const z = (bay + 0.5) * specs.bayDistance - halfLength
					for (const side of [-1, 1] as const) {
						const rot = side === 1 ? PART_ROT_LEFT : PART_ROT_RIGHT
						partMatrices.push(Matrix.Compose(
							Vector3.One(),
							rot,
							new Vector3(side * (specs.halfWidth + xOffset), y, z)
						))
					}
				}

				// Apply thin instances: thinMatrix = meshLocal × modelMatrix × partMatrix
				for (const src of geoMeshes) {
					const meshLocal = meshLocals.get(src) ?? Matrix.Identity()
					const prefix = meshLocal.multiply(modelMatrix)

					const buf = new Float32Array(partMatrices.length * 16)
					for (let j = 0; j < partMatrices.length; j++) {
						prefix.multiply(partMatrices[j]).copyToArray(buf, j * 16)
					}

					src.parent = root
					src.position.setAll(0)
					src.rotationQuaternion = null
					src.rotation.setAll(0)
					src.scaling.setAll(1)
					src.setEnabled(true)

					src.thinInstanceSetBuffer('matrix', buf, 16)
					src.thinInstanceRefreshBoundingInfo(false)
					src.alwaysSelectAsActiveMesh = true
					src.freezeWorldMatrix()
					src.freezeNormals()
					allDisposables.push(src)
				}

				onLoadStateChange?.(false)
			})
			.catch((err) => {
				if (!controller.signal.aborted) {
					console.error('EaveSideBeams: failed to load', err)
				}
				onLoadStateChange?.(false)
			})

		return () => {
			controller.abort()
			for (const d of allDisposables) {
				try { d.dispose() } catch { /* gone */ }
			}
		}
	}, [scene, enabled, specs, numBays, onLoadStateChange])

	return null
})
