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
 * Connector placement — fully dynamic from upright profile + rafter slope.
 *
 * X inset:   uprightWidth / 2  (connector starts at upright’s inner edge)
 * Y offset:  rafter rise at the inset point (slope × uprightWidth / 2)
 * Roll:      atan(slope × connectorPlate.depth / connectorPlate.length)
 * Scale:     Non-uniform — measured in PartBuilder to fit the connector profile.
 */

/** PartBuilder-measured non-uniform scale for this GLB. */
const MODEL_SCALE_X = 0.0003548
const MODEL_SCALE_Y = 0.0003673
const MODEL_SCALE_Z = 0.002163

/** GLB origin sits ~4mm above the connector's bottom contact surface. */
const CONNECTOR_ORIGIN_Y_OFFSET = 0.004

/**
 * UprightConnectors — loads the connector GLB and places thin instances
 * at the top of every upright on both sides.
 *
 * Matrix chain mirrors the PartBuilder's two-node hierarchy:
 *
 *   thinMatrix = meshLocal × modelMatrix × partMatrix
 *
 *   meshLocal:   preserves sub-mesh offsets from the GLB
 *   modelMatrix: GLTF __root__ rotation (read from GLB) + scale
 *   partMatrix:  world placement (position + rotation)
 *
 * IMPORTANT: The __root__ rotation is READ from the loaded GLB,
 * not hardcoded, to handle any GLTF export variation.
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

			const connectorMat = getAluminumMaterial(scene).clone('aluminum-connectors')
			connectorMat.backFaceCulling = false

			onLoadStateChange?.(true)

			loadGLB(scene, SHARED_FRAME_PATH, CONNECTOR_GLB, ctrl.signal)
				.then((loaded) => {
					if (ctrl.signal.aborted) {
						for (const m of loaded) { try { m.dispose() } catch { /* gone */ } }
						onLoadStateChange?.(false)
						return
					}

					// ── 1. Separate __root__ from geometry meshes ────────────
					const rootMesh = loaded.find((m) => m.name === '__root__')
					const templateMeshes = loaded.filter(
						(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
					)

					if (templateMeshes.length === 0) {
						console.warn('[UprightConnectors] No geometry meshes in GLB')
						for (const m of loaded) { try { m.dispose() } catch { /* gone */ } }
						onLoadStateChange?.(false)
						return
					}

					// ── 2. Read __root__ transform BEFORE disposing it ───────
					// The PartBuilder copies this to modelNode — we must match it.
					let gltfRotation: Quaternion
					if (rootMesh?.rotationQuaternion) {
						gltfRotation = rootMesh.rotationQuaternion.clone()
					} else if (rootMesh) {
						gltfRotation = Quaternion.FromEulerAngles(
							rootMesh.rotation.x,
							rootMesh.rotation.y,
							rootMesh.rotation.z,
						)
					} else {
						// Fallback: standard GLTF right→left handedness
						gltfRotation = Quaternion.FromEulerAngles(0, Math.PI, 0)
						console.warn('[UprightConnectors] No __root__ found — using Y=PI fallback')
					}

					console.log(
						'[UprightConnectors] GLTF __root__ rotation (euler):',
						gltfRotation.toEulerAngles().toString(),
						'quat:', gltfRotation.toString(),
					)

					// ── 3. Capture each mesh's LOCAL transform before zeroing ─
					// The PartBuilder preserves these (only converts quat→euler).
					// Zeroing them without accounting for them shifts geometry.
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

					// ── 4. Dispose non-geometry nodes (__root__ etc.) ─────────
					for (const m of loaded) {
						if (!templateMeshes.includes(m as Mesh)) {
							try { m.dispose() } catch { /* gone */ }
						}
					}

					stripAndApplyMaterial(templateMeshes, connectorMat)

					// ── 5. Build model matrix (≡ PartBuilder modelNode) ───────
					// Non-uniform scale from PartBuilder + GLTF handedness rotation.
					const modelMatrix = Matrix.Compose(
						new Vector3(MODEL_SCALE_X, MODEL_SCALE_Y, MODEL_SCALE_Z),
						gltfRotation,
						Vector3.Zero(),
					)

					// ── 6. Placement — dynamic from upright profile + slope ───
					const baseplateTop = specs.baseplate?.height ?? 0
					const halfWidth = specs.halfWidth
					const slope = specs.rafterSlopeAtEave ?? 0
					const plate = specs.connectorPlate
						?? { length: 0.424, height: 0.212, depth: 0.112 }

					// X: connector starts at upright’s inner edge
					const xInset = specs.profiles.upright.width / 2
					const xPos = halfWidth - xInset

					// Y: eave + rafter rise at inset, minus GLB origin offset
					const yPos = baseplateTop + specs.eaveHeight
						+ slope * xInset - CONNECTOR_ORIGIN_Y_OFFSET

					// Roll: tilt across the connector plate to match rafter angle
					const rollAngle = Math.atan(slope * plate.depth / plate.length)

					const totalLength = numBays * specs.bayDistance
					const halfLength = totalLength / 2
					const numLines = numBays + 1

					// ── 7. Build placement (part) matrices ────────────────────
					const partMatrices: Matrix[] = []
					for (let i = 0; i < numLines; i++) {
						const z = i * specs.bayDistance - halfLength

						// Right side: pitch=180° (flipped), roll=+slope
						partMatrices.push(Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, 0, rollAngle),
							new Vector3(-xPos, yPos, z),
						))

						// Left side (X-mirror): pitch=180°, yaw=180°, roll=−slope
						partMatrices.push(Matrix.Compose(
							Vector3.One(),
							Quaternion.FromEulerAngles(Math.PI, Math.PI, -rollAngle),
							new Vector3(+xPos, yPos, z),
						))
					}

					// ── 8. Per-mesh thin instance buffers ─────────────────────
					// Each mesh may have different local offsets in the GLB, so:
					//   thinMatrix = meshLocal × modelMatrix × partMatrix
					for (const src of templateMeshes) {
						const meshLocal = meshLocalMatrices.get(src) ?? Matrix.Identity()

						// Combine mesh-local + model into a reusable prefix
						const meshModelPrefix = meshLocal.multiply(modelMatrix)

						const matrixData = new Float32Array(partMatrices.length * 16)
						for (let j = 0; j < partMatrices.length; j++) {
							meshModelPrefix.multiply(partMatrices[j]).copyToArray(matrixData, j * 16)
						}

						// Zero mesh transform — thin instances supply world matrices
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
				try { connectorMat.dispose() } catch { /* gone */ }
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)

UprightConnectors.displayName = 'UprightConnectors'