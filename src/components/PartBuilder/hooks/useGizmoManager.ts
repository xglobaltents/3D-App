import { useCallback, useEffect, useRef } from 'react'
import {
  GizmoManager,
  TransformNode,
  UtilityLayerRenderer,
  type Scene,
} from '@babylonjs/core'

interface UseGizmoManagerOptions {
  scene: Scene | null
  showGizmo: boolean
  gizmoSize: number
  partNodeRef: React.RefObject<TransformNode | null>
  onDrag: () => void
  onDragEnd: () => void
}

export interface UseGizmoManagerReturn {
  gizmoManagerRef: React.RefObject<GizmoManager | null>
}

/**
 * Manages the GizmoManager lifecycle: create, toggle, resize, attach observers.
 */
export function useGizmoManager(
  options: UseGizmoManagerOptions
): UseGizmoManagerReturn {
  const { scene, showGizmo, gizmoSize, partNodeRef, onDrag, onDragEnd } = options
  const gizmoManagerRef = useRef<GizmoManager | null>(null)
  const utilLayerRef = useRef<UtilityLayerRenderer | null>(null)

  // Create gizmo manager on mount
  useEffect(() => {
    if (!scene) return
    const utilLayer = new UtilityLayerRenderer(scene)
    const gm = new GizmoManager(scene, undefined, utilLayer)
    gm.positionGizmoEnabled = false
    gm.rotationGizmoEnabled = false
    gm.scaleGizmoEnabled = false
    gm.usePointerToAttachGizmos = false
    gizmoManagerRef.current = gm
    utilLayerRef.current = utilLayer

    return () => {
      gm.dispose()
      utilLayer.dispose()
      gizmoManagerRef.current = null
      utilLayerRef.current = null
    }
  }, [scene])

  // Remove all previous observers, then re-attach fresh ones
  const attachObservers = useCallback(() => {
    const gm = gizmoManagerRef.current
    if (!gm) return

    // Clear + re-add observers to prevent accumulation when gizmo size changes
    const gizmos = [gm.gizmos.positionGizmo, gm.gizmos.rotationGizmo, gm.gizmos.scaleGizmo]
    for (const gizmo of gizmos) {
      if (!gizmo) continue
      gizmo.onDragObservable?.clear()
      gizmo.onDragEndObservable?.clear()
      gizmo.onDragObservable?.add(() => onDrag())
      gizmo.onDragEndObservable?.add(() => onDragEnd())
    }
  }, [onDrag, onDragEnd])

  // Toggle gizmo visibility + attach to part node
  useEffect(() => {
    const gm = gizmoManagerRef.current
    if (!gm) return

    gm.positionGizmoEnabled = showGizmo
    gm.rotationGizmoEnabled = false
    gm.scaleGizmoEnabled = false

    if (showGizmo) {
      if (gm.gizmos.positionGizmo) {
        gm.gizmos.positionGizmo.scaleRatio = gizmoSize
      }
      if (partNodeRef.current) {
        gm.attachToNode(partNodeRef.current)
        attachObservers()
      }
    }
  }, [showGizmo, gizmoSize, partNodeRef, attachObservers])

  return { gizmoManagerRef }
}
