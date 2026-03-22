import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Matrix, Quaternion } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

interface GableEaveBeamsProps {
	numBays: number
	specs: TentSpecs
	enabled: boolean
	onLoadStateChange?: (loading: boolean) => void
}

const FOLDER = '/tents/SharedFrames/'
const FILE = 'gable-beam-80x150.glb'

// GLTF handedness rotation (right→left)
const MODEL_QUAT = Quaternion.FromEulerAngles(0, Math.PI, 0)

// Part orientation: yaw 90° so beam spans across X (tent width)
const PART_QUAT = Quaternion.FromEulerAngles(0, Math.PI / 2, 0)

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
 * GableEaveBeams — horizontal beams spanning across front and back
 * gable faces at eave height.
 *
 * Scaling is computed dynamically from GLB raw bounds → specs profile
 * dimensions, not hardcoded from PartBuilder measurements.
 *
 * Raw GLB axes → target specs mapping:
 *   GLB X → gableBeam profile width  (0.127m for 15m/20m)
 *   GLB Y → gableBeam profile height (0.076m for 15m/20m)
 *   GLB Z → beam length (full tent width)
 *
 * Layout: 2 beams total (front + back gable).
 */
export const GableEaveBeams: FC<GableEaveBeamsProps> = memo(({ numBays, specs, enabled, onLoadStateChange }) => {
	const scene = useScene()
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		if (!scene || !enabled) return

		abortRef.current?.abort()
		const controller = new AbortController()
		abortRef.current = controller

		const root = new TransformNode('gable-eave-beams-root', scene)
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

				const meshes = loaded.filter(
					(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
				)
				if (meshes.length === 0) {
					for (const m of loaded) { try { m.dispose() } catch { /* gone */ } }
					onLoadStateChange?.(false)
					return
				}

				for (const m of loaded) {
					if (!meshes.includes(m as Mesh)) {
						try { m.dispose() } catch { /* gone */ }
					}
				}

				stripAndApplyMaterial(meshes, aluminumMat)

				// Capture each mesh's local transform before zeroing
				const meshLocals = new Map<Mesh, Matrix>()
				for (const m of meshes) {
					const rot = m.rotationQuaternion?.clone()
						?? Quaternion.FromEulerAngles(m.rotation.x, m.rotation.y, m.rotation.z)
					meshLocals.set(m, Matrix.Compose(m.scaling.clone(), rot, m.position.clone()))
					console.log('[GableEaveBeams] mesh', m.name, 'pos:', m.position.toString(), 'scale:', m.scaling.toString(), 'rotQ:', m.rotationQuaternion?.toString())
				}

				// Reset mesh transforms to identity
				for (const m of meshes) {
					m.rotationQuaternion = null
					m.rotation.setAll(0)
					m.position.setAll(0)
					m.scaling.setAll(1)
				}

				// Compute scale from raw GLB bounds → specs profile dimensions
				const rawSize = measureRawBounds(meshes)
				const profile = specs.profiles.gableBeam
				const scaleX = rawSize.x > 0 ? profile.width / rawSize.x : 1
				const scaleY = rawSize.y > 0 ? profile.height / rawSize.y : 1
				// Beam length = full tent width (it spans the entire gable face)
				const scaleZ = rawSize.z > 0 ? specs.width / rawSize.z : 1
				const modelScale = new Vector3(scaleX, scaleY, scaleZ)

				console.log('[GableEaveBeams] rawSize:', rawSize.toString(), 'scale:', modelScale.toString(), 'target profile:', profile.width, profile.height, 'tentWidth:', specs.width)
				const modelMatrix = Matrix.Compose(modelScale, MODEL_QUAT, Vector3.Zero())

				// Compute placement positions
				const baseplateTop = specs.baseplate?.height ?? 0
				const eaveY = baseplateTop + specs.eaveHeight
				const halfLength = (numBays * specs.bayDistance) / 2

				// Build part matrices — front and back gable beams
				const partMatrices: Matrix[] = []
				for (const gz of [-halfLength, halfLength]) {
					partMatrices.push(Matrix.Compose(
						Vector3.One(),
						PART_QUAT,
						new Vector3(0, eaveY, gz),
					))
				}

				// Apply thin instances: thinMatrix = meshLocal × modelMatrix × partMatrix
				for (const src of meshes) {
					const meshLocal = meshLocals.get(src) ?? Matrix.Identity()
					const prefix = meshLocal.multiply(modelMatrix)

					const buf = new Float32Array(partMatrices.length * 16)
					for (let j = 0; j < partMatrices.length; j++) {
						prefix.multiply(partMatrices[j]).copyToArray(buf, j * 16)
					}

					src.parent = root
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
					console.error('GableEaveBeams: failed to load', err)
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
