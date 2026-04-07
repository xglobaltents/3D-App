import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'
import { GABLE_SUPPORT_REG, computePartScale } from '@/lib/constants/glbRegistry'

// ═════════════════════════════════════════════════════════════
// Part:  Gable Support (profile from specs)
// GLB:   /tents/SharedFrames/gable-support-77x127.glb
// Registry: GABLE_SUPPORT_REG (centralized RAW extents + axis mapping)
//
// Axis mapping (from registry):
//   X = cross-section (FIXED)
//   Y = column HEIGHT (PARAMETRIC with eaveHeight)
//   Z = cross-section depth (FIXED)
//
// Pattern D: gable positions × front + back, count = positions.length × 2
// ═════════════════════════════════════════════════════════════

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

        // ── Model scale from centralized registry ──
        const regScale = computePartScale(GABLE_SUPPORT_REG, {
          profiles: specs.profiles,
          bayDistance: specs.bayDistance,
          eaveHeight: specs.eaveHeight,
          tentWidth: specs.width,
          halfWidth: specs.halfWidth,
        })
        const modelScale = new Vector3(regScale.x, regScale.y, regScale.z)
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