import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, measureWorldBounds, freezeThinInstancedMesh } from '@/lib/utils/GLBLoader'
import { makeFrameBottomHeightFn } from '@/lib/utils/archMath'
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

// Cross-section is now derived dynamically from the GLB's measured bounds
// (see widthCorrection / heightCorrection below). Z extrusion is also
// derived analytically from a single probe, so no calibration constant
// is needed.

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
          for (const m of loaded) {
            try {
              m.dispose()
            } catch {
              // Ignore cleanup failures while tearing down partially loaded meshes.
            }
          }
          onLoadStateChange?.(false)
          return
        }
        for (const m of loaded) {
          if (!geoMeshes.includes(m as Mesh)) {
            try {
              m.dispose()
            } catch {
              // Ignore cleanup failures while disposing non-geometry nodes.
            }
          }
        }

        stripAndApplyMaterial(geoMeshes, aluminumMat)

        // Capture mesh-local transforms
        const meshLocals = new Map<Mesh, Matrix>()
        for (const mesh of geoMeshes) {
          const rot = mesh.rotationQuaternion?.clone()
            ?? Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
          meshLocals.set(mesh, Matrix.Compose(mesh.scaling.clone(), rot, mesh.position.clone()))
        }

        const measureRoot = new TransformNode('gable-supports-measure', scene)
        measureRoot.rotationQuaternion = new Quaternion()
        allDisposables.push(measureRoot)
        for (const mesh of geoMeshes) {
          mesh.parent = measureRoot
        }

        const measureScale = new Vector3(1, 1, 1)
        const measurePosition = new Vector3()
        const measureInstanceBounds = (modelMatrix: Matrix, partMatrix: Matrix) => {
          const combined = modelMatrix.multiply(partMatrix)
          combined.decompose(measureScale, measureRoot.rotationQuaternion!, measurePosition)
          measureRoot.scaling.copyFrom(measureScale)
          measureRoot.position.copyFrom(measurePosition)
          measureRoot.computeWorldMatrix(true)
          return measureWorldBounds(geoMeshes)
        }

        // ── Model scale: dynamically derived from actual GLB bounds ──
        // Gable column profile is capped to never exceed the main upright,
        // so gable supports always render the same size as or smaller than
        // the uprights they sit beneath. Bounds-based normalization makes
        // the cross-section match the spec exactly (independent of any
        // calibration drift in the GLB).
        const targetW = Math.min(specs.profiles.gableColumn.width, specs.profiles.upright.width)
        const targetH = Math.min(specs.profiles.gableColumn.height, specs.profiles.upright.height)

        // Measure the GLB's natural cross-section at unit scale so we can
        // normalize against true bounds rather than a calibration constant.
        // Probe at unit scale so we can derive every dimension analytically.
        // World-space dimensions are linear in modelScale, so a single probe
        // is enough to compute cross-section AND height-axis (Y) scaling for
        // every instance — no per-instance measureWorldBounds() needed.
        const probeMatrix = Matrix.Compose(Vector3.One(), MODEL_ROT_QUAT, Vector3.Zero())
        const probePart = Matrix.Compose(Vector3.One(), PART_ROT_QUAT, Vector3.Zero())
        const probeBounds = measureInstanceBounds(probeMatrix, probePart)
        const naturalCrossX = Math.max(probeBounds.max.x - probeBounds.min.x, 1e-6)
        const naturalCrossY = Math.max(probeBounds.max.z - probeBounds.min.z, 1e-6)
        const naturalHeight = Math.max(probeBounds.max.y - probeBounds.min.y, 1e-6)
        const naturalMinY = probeBounds.min.y
        const crossScaleX = targetW / naturalCrossX
        const crossScaleY = targetH / naturalCrossY

        const baseplateTop = specs.baseplate?.height ?? 0
        const halfLength = (numBays * specs.bayDistance) / 2
        const archBottomFn = makeFrameBottomHeightFn(specs, specs.profiles.rafter.width, 0)

        // Build per-instance matrices (Z scale varies with arch height)
        interface InstanceDef { modelMatrix: Matrix; partMatrix: Matrix }
        const instances: InstanceDef[] = []
        const makeModelMatrix = (scaleZ: number) => Matrix.Compose(
          new Vector3(crossScaleX, crossScaleY, scaleZ),
          MODEL_ROT_QUAT,
          Vector3.Zero(),
        )
        const makePartMatrix = (gx: number, y: number, gz: number) => Matrix.Compose(
          Vector3.One(),
          PART_ROT_QUAT,
          new Vector3(gx, y, gz),
        )

        for (const gz of [-halfLength, halfLength]) {
          for (const gx of specs.gableSupportPositions) {
            const topY = Math.max(baseplateTop, baseplateTop + archBottomFn(gx))
            const supportHeight = topY - baseplateTop
            if (supportHeight <= 1e-4) continue

            // Closed-form: world-Y extent = scaleZ * naturalHeight, so
            //   scaleZ = supportHeight / naturalHeight  (matches old iterative result)
            // and the bottom of the bounds in world Y after part placement is
            //   bounds.min.y = partY + scaleZ * naturalMinY
            // We want bounds.min.y = baseplateTop, so:
            //   partY = baseplateTop - scaleZ * naturalMinY
            const scaleZ = supportHeight / naturalHeight
            const partY = baseplateTop - scaleZ * naturalMinY
            instances.push({
              modelMatrix: makeModelMatrix(scaleZ),
              partMatrix: makePartMatrix(gx, partY, gz),
            })
          }
        }

        for (const mesh of geoMeshes) {
          mesh.parent = root
        }
        try {
          measureRoot.dispose()
        } catch {
          // Ignore cleanup failures when disposing the temporary measure root.
        }

        // ── Thin instances ──
        const scratchA = new Matrix()
        const scratchB = new Matrix()
        for (const src of geoMeshes) {
          const meshLocal = meshLocals.get(src) ?? Matrix.Identity()
          const buf = new Float32Array(instances.length * 16)
          for (let j = 0; j < instances.length; j++) {
            const { modelMatrix, partMatrix } = instances[j]
            meshLocal.multiplyToRef(modelMatrix, scratchA)
            scratchA.multiplyToRef(partMatrix, scratchB)
            scratchB.copyToArray(buf, j * 16)
          }
          src.parent = root
          src.position.setAll(0)
          src.rotationQuaternion = null
          src.rotation.setAll(0)
          src.scaling.setAll(1)
          src.setEnabled(true)
          src.thinInstanceSetBuffer('matrix', buf, 16)
          freezeThinInstancedMesh(src)
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
      for (const d of allDisposables) {
        try {
          d.dispose()
        } catch {
          // Ignore cleanup failures during unmount.
        }
      }
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})