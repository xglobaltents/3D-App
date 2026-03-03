import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
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
 * Connector placement measured via PartBuilder on the 15 m tent.
 *
 * X_INSET:      distance inward from the eave line toward centre (m).
 * Y_ABOVE_EAVE: distance above the eave datum (baseplateTop + eaveHeight) (m).
 * ROLL_ANGLE:   tilt to match arch slope at eave (radians, 5°).
 *
 * Resolved right-side position for 15 m / 3-bay, frame line 0:
 *   X = -(7.5 − 0.47) = −7.03
 *   Y =  0.30 + 3.20 + 0.18 = 3.68
 *   Z = −7.5
 *   Rotation: pitch 180° (flipped), roll 5°
 */
const X_INSET = 0.47
const Y_ABOVE_EAVE = 0.18
const ROLL_ANGLE = 5 * Math.PI / 180

/** mm → m  (GLB is authored in millimetres). */
const GLB_SCALE = 0.001

/**
 * UprightConnectors — loads the connector-plate GLB and places thin
 * instances at the top of each upright on both sides of the tent.
 *
 * Mirrors the PartBuilder two-node hierarchy baked into a single matrix:
 *
 *   modelMatrix  = Scale(0.001) × Rotate(GLTF Y=π)         ← "modelNode"
 *   partMatrix   = Rotate(placement) × Translate(position)  ← "partNode"
 *   thinInstance  = modelMatrix × partMatrix
 *
 * No bounds-based offset is applied — the PartBuilder positions already
 * account for the model's origin.
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

			// Clone material — backFaceCulling=false for GLTF handedness rotation
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

					// Dispose non-geometry clones (__root__ etc.)
					for (const m of loaded) {
						if (!templateMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* already gone */ }
						}
					}

					stripAndApplyMaterial(templateMeshes, connectorMat)

					// ── Model matrix (≡ PartBuilder modelNode) ──
					// Scale mm→m  +  GLTF right→left handedness rotation
					const modelMatrix = Matrix.Compose(
						new Vector3(GLB_SCALE, GLB_SCALE, GLB_SCALE),
						Quaternion.FromEulerAngles(0, Math.PI, 0),
						Vector3.Zero(),
					)

					// ── Position parameters ──
					const halfWidth = specs.halfWidth
					const baseplateTop = specs.baseplate?.height ?? 0
					const yPos = baseplateTop + specs.eaveHeight + Y_ABOVE_EAVE

					const totalLength = numBays * specs.bayDistance
					const halfLength = totalLength / 2
					const numLines = numBays + 1

					// ── Build thin-instance matrices ──
					// Each matrix = modelMatrix × partMatrix, exactly mirroring the
					// PartBuilder's modelNode → partNode hierarchy.
					const matrices: Matrix[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength

						// Right side: pitch 180° + roll 5°
						const rightPart = Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, 0, ROLL_ANGLE),
							new Vector3(-(halfWidth - X_INSET), yPos, z),
						)
						matrices.push(modelMatrix.multiply(rightPart))

						// Left side: pitch 180°, Y mirror 180°, roll −5°
						const leftPart = Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, Math.PI, -ROLL_ANGLE),
							new Vector3(+(halfWidth - X_INSET), yPos, z),
						)
						matrices.push(modelMatrix.multiply(leftPart))
					}

					// ── Write thin-instance buffer ──
					const matrixData = new Float32Array(matrices.length * 16)
					for (let j = 0; j < matrices.length; j++) {
						matrices[j].copyToArray(matrixData, j * 16)
					}

					for (const src of templateMeshes) {
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
					try { d.dispose() } catch { /* already gone */ }
				}
				try { connectorMat.dispose() } catch { /* already gone */ }
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)

UprightConnectors.displayName = 'UprightConnectors'