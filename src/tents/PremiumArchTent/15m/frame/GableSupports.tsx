import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ═════════════════════════════════════════════════════════════
// Part:  Gable Support (127×76 profile — vertical column)
// GLB:   /tents/SharedFrames/gable-support-77x127.glb
// PDF:   Profile 03 — Gable Column
//
// PartBuilder export (15m tent, eaveHeight=3.2m):
//   Scale:  (0.001, 0.001, 0.1396)
//   Dims:   0.649 × 6.980 × 0.406 m
//   Pos:    X=gableSupportPositions[i], Y=baseplateTop-0.3, Z=lineZs[0]
//   Rot:    Pitch=90° | Yaw=90°
//
// Axis mapping:
//   X = cross-section (FIXED at 0.001)
//   Y = column HEIGHT (6.980m at scale 0.001 → PARAMETRIC with eaveHeight)
//   Z = cross-section depth (FIXED at 0.1396)
//
// Height ratio: 0.001 / 6.980 = 0.0001433 per meter
// So: Y_scale = 0.0001433 × specs.eaveHeight
//
// Pattern D: gable positions × front + back, count = positions.length × 2
// ═════════════════════════════════════════════════════════════

const FOLDER = '/tents/SharedFrames/'
const FILE = 'gable-support-77x127.glb'

// Cross-section scales — FIXED for this GLB
const CROSS_X = 0.001     // mm→m
const CROSS_Z = 0.1396    // depth

// Height scale ratio: 0.001 / 6.980 = 0.0001433 per meter
const Y_SCALE_PER_METER = 0.001 / 6.980

const MODEL_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI, 0)
// Pitch 90° + Yaw 90° from PartBuilder export
const PART_ROT_QUAT = Quaternion.FromEulerAngles(Math.PI / 2, Math.PI / 2, 0)

interface GableSupportsProps {
  numBays: number
  specs: TentSpecs
  enabled: boolean
  onLoadStateChange?: (loading: boolean) => void
}

export const GableSupports: FC<GableSupportsProps> = memo(({
  numBays, specs, enabled, onLoadStateChange
}) => {
  const scene = useScene()
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!scene || !enabled) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const root = new TransformNode('gable-supports-root', scene)
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

        // ── Model scale: cross-section fixed, height parametric ──
        const modelScale = new Vector3(
          CROSS_X,                               // cross-section (fixed)
          Y_SCALE_PER_METER * specs.eaveHeight,  // column height = eave height
          CROSS_Z                                 // cross-section depth (fixed)
        )
        const modelMatrix = Matrix.Compose(modelScale, MODEL_ROT_QUAT, Vector3.Zero())

        // ── Placement: Pattern D — gable positions × front + back ──
        const baseplateTop = specs.baseplate?.height ?? 0
        const halfLength = (numBays * specs.bayDistance) / 2

        const partMatrices: Matrix[] = []
        for (const gz of [-halfLength, halfLength]) {
          for (const gx of specs.gableSupportPositions) {
            partMatrices.push(Matrix.Compose(
              Vector3.One(), PART_ROT_QUAT,
              new Vector3(gx, baseplateTop, gz)
            ))
          }
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
        if (!controller.signal.aborted) console.error('GableSupports: load failed', err)
        onLoadStateChange?.(false)
      })

    return () => {
      controller.abort()
      for (const d of allDisposables) { try { d.dispose() } catch {} }
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})