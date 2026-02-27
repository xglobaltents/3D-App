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

  // Attach drag observers helper
  const attachObservers = useCallback(() => {
    const gm = gizmoManagerRef.current
    if (!gm) return
    const attach = (gizmo: { onDragObservable?: { add: (cb: () => void) => void }; onDragEndObservable?: { add: (cb: () => void) => void } } | null) => {
      if (!gizmo) return
      gizmo.onDragObservable?.add(() => onDrag())
      gizmo.onDragEndObservable?.add(() => onDragEnd())
    }
    attach(gm.gizmos.positionGizmo)
    attach(gm.gizmos.rotationGizmo)
    attach(gm.gizmos.scaleGizmo)
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
