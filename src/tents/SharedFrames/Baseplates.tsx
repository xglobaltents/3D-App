import { type FC, useEffect, memo } from 'react'
import { useScene } from 'react-babylonjs'
import { TransformNode, Mesh } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial, freezeStaticMeshes } from '../../lib/utils/GLBLoader'
import { getAluminumMaterial } from '../../lib/materials/frameMaterials'

interface BaseplatesProps {
  enabled: boolean
}

/**
 * Shared Baseplates component — identical geometry across all tent types.
 * Loads from: public/tents/SharedFrames/basePlates.glb
 */
export const Baseplates: FC<BaseplatesProps> = memo(({ enabled }) => {
  const scene = useScene()

  useEffect(() => {
    if (!scene || !enabled) return

    const root = new TransformNode('baseplates-root', scene)
    root.position.y = 0

    let disposed = false
    let meshes: Mesh[] = []

    // Shared frozen PBR material — created once, reused everywhere
    const aluminumMat = getAluminumMaterial(scene)

    loadGLB(scene, '/tents/SharedFrames/', 'basePlates.glb')
      .then((loaded) => {
        if (disposed) return
        meshes = loaded.filter((m): m is Mesh => m instanceof Mesh)

        // Strip embedded GLB materials → apply shared aluminum
        stripAndApplyMaterial(meshes, aluminumMat)

        // Calculate bounding to lift mesh so bottom sits at ground level
        let minY = Infinity
        for (const mesh of meshes) {
          mesh.refreshBoundingInfo()
          const bounds = mesh.getBoundingInfo().boundingBox
          const worldMin = bounds.minimumWorld.y
          if (worldMin < minY) minY = worldMin
        }

        // Offset root to place bottom of mesh at Y=0
        if (isFinite(minY)) {
          root.position.y = -minY
        }

        for (const mesh of meshes) {
          mesh.parent = root
        }

        // Freeze static geometry — no per-frame recalculation
        freezeStaticMeshes(meshes)
      })
      .catch(() => {
        if (!disposed) {
          root.dispose()
        }
      })

    return () => {
      disposed = true
      for (const mesh of meshes) {
        mesh.dispose()
      }
      root.dispose()
    }
  }, [scene, enabled])

  return null
})
