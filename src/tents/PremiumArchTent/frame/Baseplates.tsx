import { type FC, useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { TransformNode, Mesh } from '@babylonjs/core'
import { loadGLB } from '../../../lib/utils/GLBLoader'

interface BaseplatesProps {
  enabled: boolean
}

export const Baseplates: FC<BaseplatesProps> = ({ enabled }) => {
  const scene = useScene()

  useEffect(() => {
    if (!scene || !enabled) return

    const root = new TransformNode('baseplates-root', scene)
    // Lift to sit on ground level
    root.position.y = 0

    let disposed = false
    let meshes: Mesh[] = []

    loadGLB(scene, '/tents/PremiumArchTent/frame/', 'basePlates.glb')
      .then((loaded) => {
        if (disposed) return
        meshes = loaded.filter((m): m is Mesh => m instanceof Mesh)
        
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
}
