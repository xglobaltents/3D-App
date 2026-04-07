import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { Mesh, TransformNode, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'
import { UPRIGHT_CONNECTOR_REG, computePartScale } from '@/lib/constants/glbRegistry'

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
 * Scaling uses centralized RAW constants from UPRIGHT_CONNECTOR_REG.
 * Raw GLB axes → target specs mapping:
 *   GLB X → connectorPlate.depth  (raw 315.7)
 *   GLB Y → connectorPlate.height (raw 577.2)
 *   GLB Z → connectorPlate.length (raw 196.0)
 *
 * Position offsets:
 *   X inset:   uprightWidth / 2  (connector starts at upright's inner edge)
 *   Y offset:  rafter rise at the inset point (slope × uprightWidth / 2)
 *   Roll:      atan(slope × connectorPlate.depth / connectorPlate.length)
 */

// RAW origin Y offset from registry (in mm, convert to m by dividing by 1000)
const RAW_ORIGIN_Y_OFFSET = UPRIGHT_CONNECTOR_REG.rawOriginOffsetY ?? 0

// Standard GLTF handedness rotation (Y=PI) — constant, never read from __root__
const GLTF_ROTATION = Quaternion.FromEulerAngles(0, Math.PI, 0)

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

					// ── 2. Use constant GLTF handedness rotation ──────────
					// Per Rule 10: never read __root__ — use known constant
					const gltfRotation = GLTF_ROTATION

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

					// ── 5. Build model matrix from registry constants ───────
					const plate = specs.connectorPlate
						?? { length: 0.424, height: 0.212, depth: 0.112 }

					// Use centralized registry instead of runtime bounds measurement
					const regScale = computePartScale(UPRIGHT_CONNECTOR_REG, {
						profiles: specs.profiles,
						bayDistance: specs.bayDistance,
						eaveHeight: specs.eaveHeight,
						tentWidth: specs.width,
						halfWidth: specs.halfWidth,
					}, { depth: plate.depth, height: plate.height, length: plate.length })
					const modelScale = new Vector3(regScale.x, regScale.y, regScale.z)

					const modelMatrix = Matrix.Compose(modelScale, gltfRotation, Vector3.Zero())

					// GLB origin Y offset: raw value × scale = world offset
					const originYOffsetWorld = RAW_ORIGIN_Y_OFFSET * regScale.y

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