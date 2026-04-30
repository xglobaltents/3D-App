import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, freezeThinInstancedMesh } from '@/lib/utils/GLBLoader'
import { getAluminumClone } from '@/lib/materials/frameMaterials'
import { GABLE_BEAM_REG, computePartScale } from '@/lib/constants/glbRegistry'
import type { TentSpecs } from '@/types'

// ═════════════════════════════════════════════════════════════
// Part:  Gable Beam (127x76) — 0.06m above eave (in arch zone)
// GLB:   /tents/SharedFrames/gable-beam-80x150.glb
//
// Instance at front + back gable.
//
// Scaling follows the shared registry mapping so runtime matches
// PartBuilder for this GLB.
// ═════════════════════════════════════════════════════════════

const FOLDER = '/tents/SharedFrames/'
const FILE = 'gable-beam-80x150.glb'

const MODEL_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI, 0)
const PART_ROT_QUAT = Quaternion.FromEulerAngles(0, Math.PI / 2, 0) // yaw 90°
const GABLE_BEAM_EAVE_OFFSET = 0.06

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

    // Cached clone with backFaceCulling disabled — per Rule 11 & 13.
    // The GLB's internal mesh rotations combined with handedness rotation
    // and extreme non-uniform scaling flip winding order on some triangles,
    // causing face flickering when culling is enabled. Disabling culling
    // is the only reliable fix; the singleton path produces visible flicker.
    const aluminumMat = getAluminumClone(scene, 'aluminum-gable-beams', (m) => {
      m.backFaceCulling = false
      // Gable-beam GLB has no UV1 coordinates, so the shared aluminum's
      // brushed bump + roughness textures (which sample UV1) cannot be
      // applied — they render as black/invisible. Strip them here.
      m.bumpTexture = null
      m.metallicTexture = null
      m.useRoughnessFromMetallicTextureGreen = false
      m.useMetallnessFromMetallicTextureBlue = false
      m.useAmbientOcclusionFromMetallicTextureRed = false
      // Slightly higher roughness compensates for the missing micro-detail.
      m.roughness = 0.32
    })

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

        // ── Model transform (dynamic from shared registry) ──
        const regScale = computePartScale(GABLE_BEAM_REG, {
          profiles: specs.profiles,
          bayDistance: specs.bayDistance,
          eaveHeight: specs.eaveHeight,
          tentWidth: specs.width,
          halfWidth: specs.halfWidth,
        })
        const modelMatrix = Matrix.Compose(
          new Vector3(regScale.x, regScale.y, regScale.z),
          MODEL_ROT_QUAT,
          Vector3.Zero(),
        )

        // ── Placement: instances at front and back gables ──
        const baseplateTop = specs.baseplate?.height ?? 0
        const beamY = baseplateTop + specs.eaveHeight + GABLE_BEAM_EAVE_OFFSET
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
          freezeThinInstancedMesh(src)
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
      for (const d of allDisposables) {
        try {
          d.dispose()
        } catch {
          // Ignore cleanup failures during unmount.
        }
      }
      // Material is cached via getAluminumClone — do NOT dispose here
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})
