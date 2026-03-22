import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ═════════════════════════════════════════════════════════════
// Part:  Gable Eave Beam (127×76 profile)
// GLB:   /tents/SharedFrames/gable-beam-80x150.glb
// PDF:   Profile 05 — Gable Beam
//
// PartBuilder export (15m tent):
//   Scale:  (0.001, 0.001, 0.1679)
//   Dims:   8.395 × 0.809 × 0.435 m
//   Pos:    X=0, Y=baseplateTop + eaveHeight, Z=lineZs[0]
//   Rot:    Yaw=90°
//
// Axis mapping:
//   X = beam LENGTH (8.395m at scale 0.001 → PARAMETRIC with tent width)
//   Y = cross-section height (FIXED at 0.001)
//   Z = cross-section depth (FIXED at 0.1679)
//
// Length ratio: 0.001 scale → 8.395m → 0.0001191 per meter
// So: X_scale = 0.0001191 × specs.width
//
// Pattern C: front + back gable, count = 2
// ═════════════════════════════════════════════════════════════

const FOLDER = '/tents/SharedFrames/'
const FILE = 'gable-beam-80x150.glb'

// Cross-section scales — FIXED for this GLB
const CROSS_Y = 0.001     // height (mm→m conversion)
const CROSS_Z = 0.1679    // depth

// Length scale ratio: 0.001 / 8.395 = 0.0001191 per meter of beam length
const X_SCALE_PER_METER = 0.001 / 8.395

const MODEL_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI, 0)
const PART_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI / 2, 0) // yaw 90°

interface GableEaveBeamsProps {
  numBays: number
  specs: TentSpecs
  enabled: boolean
  onLoadStateChange?: (loading: boolean) => void
}

export const GableEaveBeams: FC<GableEaveBeamsProps> = memo(({
  numBays, specs, enabled, onLoadStateChange
}) => {
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

        const geoMeshes = loaded.filter(
          (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
        )
        if (!geoMeshes.length) {
          for (const m of loaded) { try { m.dispose() } catch {} }
          onLoadStateChange?.(false)
          return
        }
        for (const m of loaded) {
          if (!geoMeshes.includes(m as Mesh)) { try { m.dispose() } catch {} }
        }

        stripAndApplyMaterial(geoMeshes, aluminumMat)

        // Capture mesh-local transforms
        const meshLocals = new Map<Mesh, Matrix>()
        for (const mesh of geoMeshes) {
          const rot = mesh.rotationQuaternion?.clone()
            ?? Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
          meshLocals.set(mesh, Matrix.Compose(mesh.scaling.clone(), rot, mesh.position.clone()))
        }

        // ── Model scale: cross-section fixed, length parametric with tent width ──
        const modelScale = new Vector3(
          X_SCALE_PER_METER * specs.width,  // beam length = tent width
          CROSS_Y,                           // cross-section height (fixed)
          CROSS_Z                            // cross-section depth (fixed)
        )
        const modelMatrix = Matrix.Compose(modelScale, MODEL_ROT_QUAT, Vector3.Zero())

        // ── Placement: Pattern C — front + back gable ──
        const baseplateTop = specs.baseplate?.height ?? 0
        const beamY = baseplateTop + specs.eaveHeight
        const halfLength = (numBays * specs.bayDistance) / 2

        const partMatrices: Matrix[] = []
        for (const gz of [-halfLength, halfLength]) {
          partMatrices.push(Matrix.Compose(
            Vector3.One(), PART_ROT_QUAT,
            new Vector3(0, beamY, gz)
          ))
        }

        // ── Thin instances ──
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
        if (!controller.signal.aborted) console.error('GableEaveBeams: load failed', err)
        onLoadStateChange?.(false)
      })

    return () => {
      controller.abort()
      for (const d of allDisposables) { try { d.dispose() } catch {} }
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})