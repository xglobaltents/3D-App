import { type FC, memo, useEffect, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Matrix, Mesh, Quaternion, TransformNode, Vector3 } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, getGLBRootTransform } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import { getConnectorTriangleBaseTransform } from '@/lib/constants/connectorTrianglePlacement'
import type { TentSpecs } from '@/types'

interface ConnectorTriangleProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

const SHARED_FRAME_PATH = '/tents/SharedFrames/'
const TRIANGLE_GLB = 'connector-triangle.glb'

// Fallback values from validated PartBuilder export in case matrix extraction fails.
const FALLBACK_MODEL_SCALE = new Vector3(0.0003055, 0.0003055, 0.001)
const FALLBACK_MODEL_ROTATION = Quaternion.FromEulerAngles(0, Math.PI, 0)

function isValidTriangleScale(scale: Vector3): boolean {
	const min = 1e-5
	const max = 0.01
	return (
		scale.x >= min && scale.x <= max
		&& scale.y >= min && scale.y <= max
		&& scale.z >= min && scale.z <= max
	)
}

/**
 * ConnectorTriangle — places the authored front-right triangle, then mirrors
 * it across X and Z to populate all four gable corners.
 *
 * Matrix chain (same as UprightConnectors):
 *   thinMatrix = meshLocal × modelMatrix × partMatrix
 */
export const ConnectorTriangle: FC<ConnectorTriangleProps> = memo(
	({ numBays, specs, enabled = true, onLoadStateChange }) => {
		const scene = useScene()
		const abortRef = useRef<AbortController | null>(null)

		useEffect(() => {
			if (!scene || !enabled) return

			abortRef.current?.abort()
			const ctrl = new AbortController()
			abortRef.current = ctrl

			const root = new TransformNode('connector-triangle-root', scene)
			const allDisposables: (Mesh | TransformNode)[] = [root]

			const triangleMat = getAluminumMaterial(scene).clone('aluminum-connector-triangle')
			triangleMat.backFaceCulling = false

			onLoadStateChange?.(true)

			loadGLB(scene, SHARED_FRAME_PATH, TRIANGLE_GLB, ctrl.signal)
				.then((loaded) => {
					if (ctrl.signal.aborted) {
						for (const m of loaded) { try { m.dispose() } catch { /* gone */ } }
						onLoadStateChange?.(false)
						return
					}

					// ── 1. Filter geometry meshes ─────────────────────────
					const templateMeshes = loaded.filter(
						(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
					)

					if (templateMeshes.length === 0) {
						console.warn('[ConnectorTriangle] No geometry meshes in GLB')
						for (const m of loaded) { try { m.dispose() } catch { /* gone */ } }
						onLoadStateChange?.(false)
						return
					}

					// ── 2. Capture each mesh's LOCAL transform before zeroing ─
					const meshLocalMatrices = new Map<Mesh, Matrix>()
					for (const mesh of templateMeshes) {
						const rot = mesh.rotationQuaternion?.clone()
							?? Quaternion.FromEulerAngles(
								mesh.rotation.x,
								mesh.rotation.y,
								mesh.rotation.z,
							)
						const localMat = Matrix.Compose(
							mesh.scaling.clone(),
							rot,
							mesh.position.clone(),
						)
						meshLocalMatrices.set(mesh, localMat)
					}

					// ── 3. Read model transform from the cached GLTF root ──────
					let modelScale = FALLBACK_MODEL_SCALE.clone()
					let modelRotation = FALLBACK_MODEL_ROTATION.clone()
					const rootTransform = getGLBRootTransform(SHARED_FRAME_PATH, TRIANGLE_GLB)
					if (rootTransform) {
						const s = new Vector3(1, 1, 1)
						const r = Quaternion.Identity()
						const t = Vector3.Zero()
						rootTransform.decompose(s, r, t)
						if (isValidTriangleScale(s)) {
							modelScale = s
							modelRotation = r
						} else {
							console.warn('[ConnectorTriangle] Ignoring invalid GLTF root scale; using calibrated fallback:', s)
						}
					}

					// ── 4. Dispose non-geometry nodes (__root__ etc.) ─────────
					for (const m of loaded) {
						if (!templateMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* gone */ }
						}
					}

					stripAndApplyMaterial(templateMeshes, triangleMat)

					// ── 5. Compose model matrix from loaded GLB transform ─────
					const modelMatrix = Matrix.Compose(modelScale, modelRotation, Vector3.Zero())

					// ── 6. Placement — calibrated connector triangle ──────────
					const baseplateTop = specs.baseplate?.height ?? 0
					const totalLength = numBays * specs.bayDistance
					const halfLength = totalLength / 2
					const lineZs = Array.from(
						{ length: numBays + 1 },
						(_, i) => i * specs.bayDistance - halfLength,
					)
					const frontLineZ = lineZs[0] ?? -halfLength
					const base = getConnectorTriangleBaseTransform(specs, baseplateTop, frontLineZ)

					// ── 7. Build placement (part) matrices for all 4 corners ──
					const partMatrices: Matrix[] = [
						// Front-right (original): roll only
						Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(base.rx, base.ry, base.rz),
							new Vector3(base.x, base.y, base.z),
						),
						// Front-left (X mirror): flip yaw + negate roll
						Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(base.rx, Math.PI, -base.rz),
							new Vector3(-base.x, base.y, base.z),
						),
						// Back-right (Z mirror): flip pitch + negate roll
						Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, base.ry, -base.rz),
							new Vector3(base.x, base.y, -base.z),
						),
						// Back-left (XZ mirror): flip pitch + yaw, keep roll
						Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, Math.PI, base.rz),
							new Vector3(-base.x, base.y, -base.z),
						),
					]

					// ── 8. Per-mesh thin instance buffers ─────────────────────
					for (const src of templateMeshes) {
						const meshLocal = meshLocalMatrices.get(src) ?? Matrix.Identity()
						const meshModelPrefix = meshLocal.multiply(modelMatrix)

						const matrixData = new Float32Array(partMatrices.length * 16)
						for (let j = 0; j < partMatrices.length; j++) {
							meshModelPrefix.multiply(partMatrices[j]).copyToArray(matrixData, j * 16)
						}

						src.parent = root
						src.position.setAll(0)
						src.rotationQuaternion = null
						src.rotation.setAll(0)
						src.scaling.setAll(1)
						src.setEnabled(true)

						src.thinInstanceSetBuffer('matrix', matrixData, 16)
						src.thinInstanceRefreshBoundingInfo(false)
						src.alwaysSelectAsActiveMesh = true
						src.freezeWorldMatrix()
						src.freezeNormals()
						allDisposables.push(src)
					}

					onLoadStateChange?.(false)
				})
				.catch((err) => {
					if (!ctrl.signal.aborted) {
						console.error('[ConnectorTriangle] Failed to load:', err)
					}
					onLoadStateChange?.(false)
				})

			return () => {
				ctrl.abort()
				for (const d of allDisposables) {
					try { d.dispose() } catch { /* gone */ }
				}
				try { triangleMat.dispose() } catch { /* gone */ }
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)

ConnectorTriangle.displayName = 'ConnectorTriangle'
