import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ═════════════════════════════════════════════════════════════
// Part:  Eave Side Beam (127×76 profile)
// GLB:   /tents/SharedFrames/eave-side-beam.glb
// PDF:   Profile 04 — Eave Beam
//
// PartBuilder export (15m tent, bayDistance=5m):
//   Scale:  (0.0001479, 0.0001479, 0.1274)
//   Dims:   0.176 × 0.155 × 6.370 m
//   Pos:    X = halfWidth + 0.31, Y = baseplateTop + eaveHeight - 0.1
//   Rot:    Roll = -PI
//
// Axis mapping:
//   X,Y = cross-section (FIXED per GLB — 0.0001479 converts this GLB's units to meters)
//   Z   = beam length (PARAMETRIC — scales with bayDistance)
//
// Length ratio: 0.1274 scale → 6.370m beam → 0.02 scale per meter
// So: Z_scale = 0.02 × bayDistance
//
// Pattern A: bay-to-bay × 2 sides
// ═════════════════════════════════════════════════════════════

const FOLDER = '/tents/SharedFrames/'
const FILE = 'eave-side-beam.glb'

// Cross-section scale — FIXED for this GLB (empirically calibrated in PartBuilder)
const PROFILE_SCALE = 0.0001479

// Length scale ratio — derived from export: 0.1274 / 6.370 = 0.02 per meter
const Z_SCALE_PER_METER = 0.1274 / 6.370

const MODEL_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI, 0)
const PART_ROT_LEFT = Quaternion.FromEulerAngles(0, 0, -Math.PI)
const PART_ROT_RIGHT = Quaternion.FromEulerAngles(0, Math.PI, -Math.PI)

interface EaveSideBeamsProps {
  numBays: number
  specs: TentSpecs
  enabled: boolean
  onLoadStateChange?: (loading: boolean) => void
}

export const EaveSideBeams: FC<EaveSideBeamsProps> = memo(({
  numBays, specs, enabled, onLoadStateChange
}) => {
  const scene = useScene()
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!scene || !enabled) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const root = new TransformNode('eave-side-beams-root', scene)
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

        // Capture mesh-local transforms (GLB sub-mesh offsets)
        const meshLocals = new Map<Mesh, Matrix>()
        for (const mesh of geoMeshes) {
          const rot = mesh.rotationQuaternion?.clone()
            ?? Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
          meshLocals.set(mesh, Matrix.Compose(mesh.scaling.clone(), rot, mesh.position.clone()))
        }

        // ── Model scale: cross-section fixed, length parametric ──
        const modelScale = new Vector3(
          PROFILE_SCALE,                        // cross-section (fixed)
          PROFILE_SCALE,                        // cross-section (fixed)
          Z_SCALE_PER_METER * specs.bayDistance  // beam length = bay distance
        )
        const modelMatrix = Matrix.Compose(modelScale, MODEL_ROT_QUAT, Vector3.Zero())

        // ── Placement: Pattern A — one per bay span × 2 sides ──
        const baseplateTop = specs.baseplate?.height ?? 0
        const eaveY = baseplateTop + specs.eaveHeight - 0.1
        const xOffset = specs.halfWidth + 0.31
        const halfLength = (numBays * specs.bayDistance) / 2

        const partMatrices: Matrix[] = []
        for (let bay = 0; bay < numBays; bay++) {
          const z = (bay + 0.5) * specs.bayDistance - halfLength

          // Left side (+X)
          partMatrices.push(Matrix.Compose(
            Vector3.One(), PART_ROT_LEFT,
            new Vector3(xOffset, eaveY, z)
          ))
          // Right side (-X)
          partMatrices.push(Matrix.Compose(
            Vector3.One(), PART_ROT_RIGHT,
            new Vector3(-xOffset, eaveY, z)
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
        if (!controller.signal.aborted) console.error('EaveSideBeams: load failed', err)
        onLoadStateChange?.(false)
      })

    return () => {
      controller.abort()
      for (const d of allDisposables) { try { d.dispose() } catch {} }
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})