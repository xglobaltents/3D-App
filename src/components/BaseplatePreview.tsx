import { FC, useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { TransformNode, Vector3, Mesh } from '@babylonjs/core'
import { loadGLB } from '../lib/utils/GLBLoader'

interface BaseplatePreviewProps {
  enabled: boolean
}

export const BaseplatePreview: FC<BaseplatePreviewProps> = ({ enabled }) => {
  const scene = useScene()

  useEffect(() => {
    if (!scene || !enabled) return

    const root = new TransformNode('baseplate-preview-root', scene)
    root.rotation = new Vector3(-Math.PI / 2, 0, 0)

    let disposed = false
    let meshes: Mesh[] = []

    loadGLB(scene, '/tents/PremiumArchTent/15m/frame/', 'basePlates.glb')
      .then((loaded) => {
        if (disposed) return
        meshes = loaded.filter((m): m is Mesh => m instanceof Mesh)
        for (const mesh of meshes) {
          mesh.parent = root
          mesh.position = Vector3.Zero()
          mesh.rotation = Vector3.Zero()
          mesh.scaling = Vector3.One()
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
