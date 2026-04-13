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
// Instance at front + back gable.
//
// Calibrated at: 15m width, 127×76mm gableBeam profile.
// Scale adapts dynamically to tent width and profile dimensions.
// ═════════════════════════════════════════════════════════════

const FOLDER = '/tents/SharedFrames/'
const FILE = 'gable-beam-80x150.glb'

// ── Calibration reference (15m tent, 127×76mm profile) ──
// Raw vertex extents (from GLB vertex buffer, no parent transforms):
//   X = 435 (profile height face), Y = 809 (profile width face), Z = 50 (length)
// Axis mapping:  X,Y = cross-section,  Z = beam length (tent width)
const CALIB_WIDTH = 15
const CALIB_PROFILE_W = 0.127
const CALIB_PROFILE_H = 0.076
const BASE_SCALE_X = 0.0001747  // profile height face — 76mm / raw 435
const BASE_SCALE_Y = 0.000157   // profile width face  — 127mm / raw 809
const BASE_SCALE_Z = 0.2985     // length axis — scales with tent width

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

    // Clone material BEFORE async — per Rule 11 & 13.
    // backFaceCulling = false because the GLB's internal mesh rotations
    // combined with handedness rotation + extreme non-uniform scaling
    // flip winding order on some triangles, causing face flickering.
    const gableBeamMat = getAluminumMaterial(scene).clone('aluminum-gable-beams')
    gableBeamMat.backFaceCulling = false

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

        stripAndApplyMaterial(geoMeshes, gableBeamMat)

        // Capture mesh-local transforms
        const meshLocals = new Map<Mesh, Matrix>()
        for (const mesh of geoMeshes) {
          const rot = mesh.rotationQuaternion?.clone()
            ?? Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
          meshLocals.set(mesh, Matrix.Compose(mesh.scaling.clone(), rot, mesh.position.clone()))
        }

        // ── Model transform (dynamic from specs) ──
        const profile = specs.profiles.gableBeam
        const modelScale = new Vector3(
          BASE_SCALE_X * (profile.height / CALIB_PROFILE_H),  // X = profile height face
          BASE_SCALE_Y * (profile.width / CALIB_PROFILE_W),   // Y = profile width face
          BASE_SCALE_Z * (specs.width / CALIB_WIDTH),          // Z = beam length
        )
        const modelMatrix = Matrix.Compose(modelScale, MODEL_ROT_QUAT, Vector3.Zero())

        // ── Placement: instances at front and back gables ──
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
      try { gableBeamMat.dispose() } catch { /* gone */ }
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})
