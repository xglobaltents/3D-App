import { useCallback, useRef } from 'react'
import {
  Mesh,
  TransformNode,
  PBRMetallicRoughnessMaterial,
  type Scene,
} from '@babylonjs/core'
import type { MirrorAxis, MirrorFlags, MirrorInstance } from '../types'
import { MIRROR_CONFIGS } from '../catalogue'
import { safeDispose } from '../utils'

interface UseMirrorSystemOptions {
  rootRef: React.RefObject<TransformNode | null>
  partNodeRef: React.RefObject<TransformNode | null>
  modelNodeRef: React.RefObject<TransformNode | null>
  meshesRef: React.RefObject<Mesh[]>
}

export interface UseMirrorSystemReturn {
  mirrorInstancesRef: React.RefObject<MirrorInstance[]>
  updateMirrorPositions: () => void
  syncMirrorVisibility: (flags: MirrorFlags) => void
  createMirrors: (scene: Scene) => void
  disposeMirrors: () => void
}

/**
 * Manages mirror clones (X, Z, XZ) of the active part.
 */
export function useMirrorSystem(
  options: UseMirrorSystemOptions
): UseMirrorSystemReturn {
  const { rootRef, partNodeRef, modelNodeRef, meshesRef } = options
  const mirrorInstancesRef = useRef<MirrorInstance[]>([])

  const updateMirrorPositions = useCallback(() => {
    const partNode = partNodeRef.current
    if (!partNode) return
    for (const mirror of mirrorInstancesRef.current) {
      const cfg = MIRROR_CONFIGS.find((c) => c.axis === mirror.axis)
      if (!cfg) continue
      mirror.node.position.copyFrom(cfg.posFn(partNode.position))
      mirror.node.rotation.copyFrom(cfg.rotFn(partNode.rotation))
      mirror.node.scaling.copyFrom(partNode.scaling)
    }
  }, [partNodeRef])

  const syncMirrorVisibility = useCallback(
    (flags: MirrorFlags) => {
      for (const mirror of mirrorInstancesRef.current) {
        const enabled = flags[mirror.axis] ?? false
        for (const mesh of mirror.meshes) {
          mesh.setEnabled(enabled)
        }
      }
      updateMirrorPositions()
    },
    [updateMirrorPositions]
  )

  const disposeMirrors = useCallback(() => {
    for (const m of mirrorInstancesRef.current) {
      for (const mesh of m.meshes) safeDispose(mesh)
      safeDispose(m.mat, m.modelNode, m.node)
    }
    mirrorInstancesRef.current = []
  }, [])

  const createMirrors = useCallback(
    (scene: Scene) => {
      disposeMirrors()

      const modelNode = modelNodeRef.current
      const meshes = meshesRef.current
      if (!modelNode || !meshes?.length) return

      for (const cfg of MIRROR_CONFIGS) {
        // Mirror root node
        const node = new TransformNode(`mirror-${cfg.axis}`, scene)
        node.rotationQuaternion = null
        node.parent = rootRef.current

        // Mirror model node (copies model's local transform)
        const mirrorModelNode = new TransformNode(`mirror-model-${cfg.axis}`, scene)
        mirrorModelNode.rotationQuaternion = null
        mirrorModelNode.parent = node

        if (modelNode.rotationQuaternion) {
          mirrorModelNode.rotationQuaternion = modelNode.rotationQuaternion.clone()
        } else {
          mirrorModelNode.rotation.copyFrom(modelNode.rotation)
        }
        mirrorModelNode.scaling.copyFrom(modelNode.scaling)
        mirrorModelNode.position.copyFrom(modelNode.position)

        // Mirror material
        const mat = new PBRMetallicRoughnessMaterial(`mirror-mat-${cfg.axis}`, scene)
        mat.baseColor = cfg.color
        mat.metallic = 0.8
        mat.roughness = 0.3
        mat.alpha = 0.65

        // Clone each mesh
        const clones: Mesh[] = []
        for (const mesh of meshes) {
          const clone = mesh.clone(`${mesh.name}-mirror-${cfg.axis}`, mirrorModelNode)
          if (clone) {
            if (clone.rotationQuaternion) {
              const euler = clone.rotationQuaternion.toEulerAngles()
              clone.rotationQuaternion = null
              clone.rotation.copyFrom(euler)
            }
            clone.material = mat
            clone.isPickable = false
            clone.setEnabled(false)
            clones.push(clone)
          }
        }

        mirrorInstancesRef.current.push({
          axis: cfg.axis,
          node,
          modelNode: mirrorModelNode,
          meshes: clones,
          mat,
        })
      }
    },
    [rootRef, modelNodeRef, meshesRef, disposeMirrors]
  )

  return {
    mirrorInstancesRef,
    updateMirrorPositions,
    syncMirrorVisibility,
    createMirrors,
    disposeMirrors,
  }
}

/** Count active mirrors. */
export function countMirrors(flags: MirrorFlags): number {
  return (flags.x ? 1 : 0) + (flags.z ? 1 : 0) + (flags.xz ? 1 : 0)
}

/** Apply a mirror preset. */
export function getMirrorPreset(preset: string): MirrorFlags {
  switch (preset) {
    case 'sides':
      return { x: true, z: false, xz: false }
    case 'ends':
      return { x: false, z: true, xz: false }
    case 'all4':
      return { x: true, z: true, xz: true }
    default:
      return { x: false, z: false, xz: false }
  }
}

/** Toggle a single mirror axis. */
export function toggleMirrorAxis(
  flags: MirrorFlags,
  axis: MirrorAxis
): MirrorFlags {
  return { ...flags, [axis]: !flags[axis] }
}
