import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, freezeThinInstancedMesh } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'
import { EAVE_SIDE_BEAM_REG, computePartScale } from '@/lib/constants/glbRegistry'

// ═════════════════════════════════════════════════════════════
// Part:  Eave Side Beam (profile from specs)
// GLB:   /tents/SharedFrames/eave-side-beam.glb
// Registry: EAVE_SIDE_BEAM_REG (centralized RAW extents + axis mapping)
//
// Axis mapping (from registry):
//   X   = profile width  (from specs.profiles.eaveBeam.width)
//   Y   = profile height (from specs.profiles.eaveBeam.height)
//   Z   = beam length    (PARAMETRIC — scales with bayDistance)
//
// Pattern A: bay-to-bay × 2 sides
// ═════════════════════════════════════════════════════════════

const FOLDER = '/tents/SharedFrames/'
const FILE = 'eave-side-beam.glb'

const MODEL_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI, 0)
const PART_ROT_LEFT = Quaternion.FromEulerAngles(0, 0, -Math.PI)
const PART_ROT_RIGHT = Quaternion.FromEulerAngles(0, Math.PI, -Math.PI)
const EAVE_SIDE_BEAM_OUTWARD_OFFSET = 0.19
const EAVE_SIDE_BEAM_EAVE_OFFSET = 0.08

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

        // Capture mesh-local transforms (GLB sub-mesh offsets)
        const meshLocals = new Map<Mesh, Matrix>()
        for (const mesh of geoMeshes) {
          const rot = mesh.rotationQuaternion?.clone()
            ?? Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
          meshLocals.set(mesh, Matrix.Compose(mesh.scaling.clone(), rot, mesh.position.clone()))
        }

        // ── Model scale from centralized registry ──
        const regScale = computePartScale(EAVE_SIDE_BEAM_REG, {
          profiles: specs.profiles,
          bayDistance: specs.bayDistance,
          eaveHeight: specs.eaveHeight,
          tentWidth: specs.width,
          halfWidth: specs.halfWidth,
        })
        const modelScale = new Vector3(regScale.x, regScale.y, regScale.z)
        const modelMatrix = Matrix.Compose(modelScale, MODEL_ROT_QUAT, Vector3.Zero())

        // ── Placement: Pattern A — one per bay span × 2 sides ──
        const baseplateTop = specs.baseplate?.height ?? 0
        const eaveY = baseplateTop + specs.eaveHeight + EAVE_SIDE_BEAM_EAVE_OFFSET
        const xOffset = specs.halfWidth + EAVE_SIDE_BEAM_OUTWARD_OFFSET
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
        const scratch = new Matrix()
        for (const src of geoMeshes) {
          const meshLocal = meshLocals.get(src) ?? Matrix.Identity()
          const prefix = meshLocal.multiply(modelMatrix)
          const buf = new Float32Array(partMatrices.length * 16)
          for (let j = 0; j < partMatrices.length; j++) {
            prefix.multiplyToRef(partMatrices[j], scratch)
            scratch.copyToArray(buf, j * 16)
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
        if (!controller.signal.aborted) console.error('EaveSideBeams: load failed', err)
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