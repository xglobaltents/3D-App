import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ═════════════════════════════════════════════════════════════
// Part:  Gable Beam (127x76) — 0.03m above eave (in arch zone)
// GLB:   /tents/SharedFrames/gable-beam-80x150.glb
//
// Single instance at front gable (frame line 0).
// ═════════════════════════════════════════════════════════════

const FOLDER = '/tents/SharedFrames/'
const FILE = 'gable-beam-80x150.glb'

const MODEL_SCALE = new Vector3(0.0001245, 0.0001, 0.2985)
const MODEL_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI, 0)
const PART_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI / 2, 0) // yaw 90°

interface GableBeamsProps {
  numBays: number
  specs: TentSpecs
  enabled: boolean
  onLoadStateChange?: (loading: boolean) => void
}

export const GableBeams: FC<GableBeamsProps> = memo(({
  numBays, specs, enabled, onLoadStateChange
}) => {
  const scene = useScene()
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!scene || !enabled) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const root = new TransformNode('gable-beams-root', scene)
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

        // ── Model transform ──
        const modelMatrix = Matrix.Compose(MODEL_SCALE, MODEL_ROT_QUAT, Vector3.Zero())

        // ── Placement: single instance at front gable ──
        const baseplateTop = specs.baseplate?.height ?? 0
        const beamY = baseplateTop + specs.eaveHeight + 0.03
        const halfLength = (numBays * specs.bayDistance) / 2

        const partMatrices: Matrix[] = [
          Matrix.Compose(
            Vector3.One(), PART_ROT_QUAT,
            new Vector3(0, beamY, -halfLength)
          ),
          Matrix.Compose(
            Vector3.One(), PART_ROT_QUAT,
            new Vector3(0, beamY, halfLength)
          ),
        ]

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
        if (!controller.signal.aborted) console.error('GableBeams: load failed', err)
        onLoadStateChange?.(false)
      })

    return () => {
      controller.abort()
      for (const d of allDisposables) { try { d.dispose() } catch {} }
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})
