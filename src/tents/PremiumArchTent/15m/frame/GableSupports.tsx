import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ═════════════════════════════════════════════════════════════
// Part:  Gable Support (127×76 profile, gable-support-77x127.glb)
//
// PartBuilder-calibrated constants (bypass registry — internal GLTF
// mesh rotations make raw bounding-box extents unusable for scaling).
//
// Cross-section (X & Y): uniform scale preserves profile shape.
//   Correction ratio adapts to different target profiles.
// Length / height (Z): extrusion axis — each instance scaled to
//   reach from baseplateTop to the arch centerline at its X position.
//
// Pattern D: gable positions × front + back
// ═════════════════════════════════════════════════════════════

// From PartBuilder calibration (gable-support-77x127.glb)
const CROSS_SCALE_BASE = 0.0003428     // uniform X & Y at 127mm nominal
const CALIBRATED_PROFILE_W = 0.127     // 127mm — the GLB's designed-for profile width
const Z_SCALE_PER_METER = 0.1641 / 3.2 // calibrated at eaveHeight = 3.2m

const FOLDER = '/tents/SharedFrames/'
const FILE = 'gable-support-77x127.glb'

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

        // ── Model scale: PartBuilder-calibrated constants ──
        const correction = specs.profiles.gableColumn.width / CALIBRATED_PROFILE_W
        const crossScale = CROSS_SCALE_BASE * correction // X = Y

        const baseplateTop = specs.baseplate?.height ?? 0
        const halfLength = (numBays * specs.bayDistance) / 2
        const archFn = specs.getArchHeightAtEave

        // Build per-instance matrices (Z scale varies with arch height)
        interface InstanceDef { modelMatrix: Matrix; partMatrix: Matrix }
        const instances: InstanceDef[] = []

        for (const gz of [-halfLength, halfLength]) {
          for (const gx of specs.gableSupportPositions) {
            const topY = archFn ? archFn(gx) : specs.eaveHeight
            const supportHeight = topY - baseplateTop
            const scaleZ = Z_SCALE_PER_METER * supportHeight

            const modelScale = new Vector3(crossScale, crossScale, scaleZ)
            const modelMatrix = Matrix.Compose(modelScale, MODEL_ROT_QUAT, Vector3.Zero())

            const partMatrix = Matrix.Compose(
              Vector3.One(), PART_ROT_QUAT,
              new Vector3(gx, baseplateTop, gz)
            )

            instances.push({ modelMatrix, partMatrix })
          }
        }

        // ── Thin instances ──
        for (const src of geoMeshes) {
          const meshLocal = meshLocals.get(src) ?? Matrix.Identity()
          const buf = new Float32Array(instances.length * 16)
          for (let j = 0; j < instances.length; j++) {
            const { modelMatrix, partMatrix } = instances[j]
            meshLocal.multiply(modelMatrix).multiply(partMatrix).copyToArray(buf, j * 16)
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