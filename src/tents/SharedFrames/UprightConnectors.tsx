import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, getGLBRootTransform } from '@/lib/utils/GLBLoader'
import { getAluminumClone } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

interface UprightConnectorsProps {
	numBays: number
	specs: TentSpecs
	enabled?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

const SHARED_FRAME_PATH = '/tents/SharedFrames/'
const CONNECTOR_GLB = 'upright-connector-r.glb'

const FALLBACK_MODEL_SCALE = new Vector3(0.0004, 0.0004, 0.0022)
const FALLBACK_MODEL_ROTATION = Quaternion.FromEulerAngles(0, Math.PI, 0)
const CONNECTOR_INSET_FROM_EDGE = 0.096
const CONNECTOR_EAVE_OFFSET_Y = 0.0426
const CONNECTOR_ROLL_RAD = (1.5 * Math.PI) / 180

function isValidConnectorScale(scale: Vector3): boolean {
	const min = 1e-5
	const max = 0.01
	return (
		scale.x >= min && scale.x <= max
		&& scale.y >= min && scale.y <= max
		&& scale.z >= min && scale.z <= max
	)
}

/**
 * UprightConnectors — loads the connector GLB and places one mirrored pair
 * on the front gable line (lineZs[0]) using calibrated 212x112 placement.
 *
 * Matrix chain:
 *   thinMatrix = meshLocal × modelMatrix × partMatrix
 *
 *   meshLocal:   preserves sub-mesh offsets from the GLB
 *   modelMatrix: parent-chain transform reconstructed from loaded GLB data
 *   partMatrix:  world placement (position + rotation)
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

			const connectorMat = getAluminumClone(scene, 'aluminum-connectors', (m) => {
				m.backFaceCulling = false
			})

			onLoadStateChange?.(true)

			loadGLB(scene, SHARED_FRAME_PATH, CONNECTOR_GLB, ctrl.signal)
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
						console.warn('[UprightConnectors] No geometry meshes in GLB')
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
					const rootTransform = getGLBRootTransform(SHARED_FRAME_PATH, CONNECTOR_GLB)
					if (rootTransform) {
						const s = new Vector3(1, 1, 1)
						const r = Quaternion.Identity()
						const t = Vector3.Zero()
						rootTransform.decompose(s, r, t)
						if (isValidConnectorScale(s)) {
							modelScale = s
							modelRotation = r
						} else {
							console.warn('[UprightConnectors] Ignoring invalid GLTF root scale; using calibrated fallback:', s)
						}
					}

					// ── 4. Dispose non-geometry nodes (__root__ etc.) ─────────
					for (const m of loaded) {
						if (!templateMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* gone */ }
						}
					}

					stripAndApplyMaterial(templateMeshes, connectorMat)

					// ── 5. Compose model matrix from loaded GLB transform ─────
					const modelMatrix = Matrix.Compose(modelScale, modelRotation, Vector3.Zero())

					// ── 6. Placement — calibrated Upright Connector (212x112) ─
					const baseplateTop = specs.baseplate?.height ?? 0
					const xRight = -specs.halfWidth + CONNECTOR_INSET_FROM_EDGE
					const yPos = baseplateTop + specs.eaveHeight + CONNECTOR_EAVE_OFFSET_Y

					const totalLength = numBays * specs.bayDistance
					const halfLength = totalLength / 2
					const lineZs = Array.from(
						{ length: numBays + 1 },
						(_, i) => i * specs.bayDistance - halfLength,
					)
					const frontLineZ = lineZs[0] ?? -halfLength

					// ── 7. Build placement (part) matrices ────────────────────
					const partMatrices: Matrix[] = [
						// Original (right side): pitch 180°, yaw 0°, roll +1.5°
						Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, 0, CONNECTOR_ROLL_RAD),
							new Vector3(xRight, yPos, frontLineZ),
						),
						// Mirror X (left side): pitch 180°, yaw 180°, roll -1.5°
						Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, Math.PI, -CONNECTOR_ROLL_RAD),
							new Vector3(-xRight, yPos, frontLineZ),
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
						console.error('[UprightConnectors] Failed to load:', err)
					}
					onLoadStateChange?.(false)
				})

			return () => {
				ctrl.abort()
				for (const d of allDisposables) {
					try { d.dispose() } catch { /* gone */ }
				}
				// Material is cached — do NOT dispose here
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)

UprightConnectors.displayName = 'UprightConnectors'