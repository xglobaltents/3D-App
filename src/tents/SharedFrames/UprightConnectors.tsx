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
 * Connector placement — fully dynamic from specs.connectorPlate + upright profile + rafter slope.
 *
 * Scaling is computed dynamically from GLB raw bounds → specs.connectorPlate dimensions.
 * Raw GLB axes → target specs mapping:
 *   GLB X → connectorPlate.depth  (0.112m for 15m/20m)
 *   GLB Y → connectorPlate.height (0.212m for 15m/20m)
 *   GLB Z → connectorPlate.length (0.424m for 15m/20m)
 *
 * Position offsets:
 *   X inset:   uprightWidth / 2  (connector starts at upright's inner edge)
 *   Y offset:  rafter rise at the inset point (slope × uprightWidth / 2)
 *   Roll:      atan(slope × connectorPlate.depth / connectorPlate.length)
 */

/** Measure combined AABB of geometry meshes, returning min corner and size. */
function measureRawBoundsMinMax(meshes: Mesh[]): { min: Vector3; size: Vector3 } {
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
	return { min, size: max.subtract(min) }
}

/**
 * UprightConnectors — loads the connector GLB and places thin instances
 * at the top of every upright on both sides.
 *
 * Matrix chain:
 *   thinMatrix = meshLocal × modelMatrix × partMatrix
 *
 *   meshLocal:   preserves sub-mesh offsets from the GLB
 *   modelMatrix: GLTF __root__ rotation (read from GLB) + specs-derived scale
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

					// ── 3. Capture each mesh's LOCAL transform before zeroing ─
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

					// ── 5. Build model matrix from raw bounds → specs ─────────
					const plate = specs.connectorPlate
						?? { length: 0.424, height: 0.212, depth: 0.112 }
					const rawBounds = measureRawBoundsMinMax(templateMeshes)
					const rawSize = rawBounds.size

					const scaleX = rawSize.x > 0 ? plate.depth / rawSize.x : 1
					const scaleY = rawSize.y > 0 ? plate.height / rawSize.y : 1
					const scaleZ = rawSize.z > 0 ? plate.length / rawSize.z : 1
					const modelScale = new Vector3(scaleX, scaleY, scaleZ)

					console.log('[UprightConnectors] rawSize:', rawSize.toString(), 'scale:', modelScale.toString(), 'target plate:', plate.depth, plate.height, plate.length, 'rawMin:', rawBounds.min.toString())
					const modelMatrix = Matrix.Compose(modelScale, gltfRotation, Vector3.Zero())

					// GLB origin Y offset → world offset after scaling
					const originYOffsetWorld = rawBounds.min.y * scaleY

					// ── 6. Placement — dynamic from upright profile + slope ───
					const baseplateTop = specs.baseplate?.height ?? 0
					const halfWidth = specs.halfWidth
					const slope = specs.rafterSlopeAtEave ?? 0

					// X: connector starts at upright’s inner edge
					const xInset = specs.profiles.upright.width / 2
					const xPos = halfWidth - xInset

					// Y: eave + rafter rise at inset, compensated for GLB origin
					const yPos = baseplateTop + specs.eaveHeight
						+ slope * xInset + originYOffsetWorld

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
				try { connectorMat.dispose() } catch { /* gone */ }
			}
		}, [scene, enabled, specs, numBays, onLoadStateChange])

		return null
	},
)

UprightConnectors.displayName = 'UprightConnectors'