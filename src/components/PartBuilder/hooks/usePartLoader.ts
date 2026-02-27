import { useCallback, useRef, useState } from 'react'
import {
  Mesh,
  MeshBuilder,
  TransformNode,
  Vector3,
  StandardMaterial,
  Color3,
  type Scene,
} from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import { roundTo4 } from '../utils'
import { safeDispose, safeDisposeArray } from '../utils'
import type { GLBOption } from '../catalogue'

interface UsePartLoaderOptions {
  rootRef: React.RefObject<TransformNode | null>
  onLoaded: (partNode: TransformNode, modelNode: TransformNode, meshes: Mesh[]) => void
  onBeforeLoad: () => void
}

export interface UsePartLoaderReturn {
  modelNodeRef: React.RefObject<TransformNode | null>
  meshesRef: React.RefObject<Mesh[]>
  loading: boolean
  uniformScale: number
  dimensions: { w: number; h: number; d: number }
  showBoundingBox: boolean

  setUniformScale: (scale: number) => void
  setShowBoundingBox: (show: boolean) => void
  loadPart: (scene: Scene, glb: GLBOption) => Promise<void>
  updateBoundingBox: (scene: Scene) => void
  applyScale: (scale: number) => void
  disposePart: () => void
}

/**
 * Manages GLB loading, auto-scaling, bounding box display, and mesh lifecycle.
 */
export function usePartLoader(
  options: UsePartLoaderOptions
): UsePartLoaderReturn {
  const { rootRef, onLoaded, onBeforeLoad } = options

  const modelNodeRef = useRef<TransformNode | null>(null)
  const meshesRef = useRef<Mesh[]>([])
  const boundingBoxRef = useRef<Mesh | null>(null)
  const partNodeLocalRef = useRef<TransformNode | null>(null)

  const [loading, setLoading] = useState(false)
  const [uniformScale, setUniformScale] = useState(1)
  const [dimensions, setDimensions] = useState({ w: 0, h: 0, d: 0 })
  const [showBoundingBox, setShowBoundingBox] = useState(true)

  // Cancellation guard: incremented on every loadPart call so stale loads bail out
  const loadGenRef = useRef(0)

  const disposeBoundingBox = useCallback(() => {
    safeDispose(boundingBoxRef.current)
    boundingBoxRef.current = null
  }, [])

  const disposePart = useCallback(() => {
    safeDisposeArray(meshesRef.current as unknown as (Mesh | null)[])
    meshesRef.current = []
    safeDispose(modelNodeRef.current)
    modelNodeRef.current = null
    safeDispose(partNodeLocalRef.current)
    partNodeLocalRef.current = null
    disposeBoundingBox()
  }, [disposeBoundingBox])

  const updateBoundingBox = useCallback(
    (scene: Scene) => {
      disposeBoundingBox()
      if (!showBoundingBox || meshesRef.current.length === 0 || !partNodeLocalRef.current) return

      partNodeLocalRef.current.computeWorldMatrix(true)
      let min = new Vector3(Infinity, Infinity, Infinity)
      let max = new Vector3(-Infinity, -Infinity, -Infinity)

      for (const mesh of meshesRef.current) {
        mesh.computeWorldMatrix(true)
        mesh.refreshBoundingInfo()
        mesh.getBoundingInfo().update(mesh.getWorldMatrix())
        min = Vector3.Minimize(min, mesh.getBoundingInfo().boundingBox.minimumWorld)
        max = Vector3.Maximize(max, mesh.getBoundingInfo().boundingBox.maximumWorld)
      }

      const size = max.subtract(min)
      setDimensions({
        w: roundTo4(size.x),
        h: roundTo4(size.y),
        d: roundTo4(size.z),
      })

      const box = MeshBuilder.CreateBox('bounding-box', {
        width: size.x + 0.005,
        height: size.y + 0.005,
        depth: size.z + 0.005,
      }, scene)

      const mat = new StandardMaterial('bounding-box-mat', scene)
      mat.wireframe = true
      mat.diffuseColor = new Color3(1, 0.9, 0)
      mat.alpha = 0.5

      box.material = mat
      box.position = Vector3.Center(min, max)
      box.isPickable = false
      boundingBoxRef.current = box
    },
    [showBoundingBox, disposeBoundingBox]
  )

  const applyScale = useCallback((scale: number) => {
    if (modelNodeRef.current) {
      modelNodeRef.current.scaling.setAll(scale)
    }
    setUniformScale(scale)
  }, [])

  const loadPart = useCallback(
    async (scene: Scene, glb: GLBOption) => {
      // Bump generation so any in-flight load from a previous call is discarded
      const gen = ++loadGenRef.current

      onBeforeLoad()
      disposePart()
      setLoading(true)

      try {
        const loaded = await loadGLB(scene, glb.folder, glb.file)

        // If another loadPart was called while we were awaiting, discard this result
        if (gen !== loadGenRef.current) {
          for (const m of loaded) safeDispose(m)
          return
        }

        const rootMesh = loaded.find((m) => m.name === '__root__')
        const meshes = loaded.filter(
          (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0
        )

        if (!meshes.length) {
          for (const m of loaded) safeDispose(m)
          return
        }

        // Apply shared aluminum material
        const mat = getAluminumMaterial(scene)
        stripAndApplyMaterial(meshes, mat)

        // Create part node hierarchy
        const partNode = new TransformNode('builder-part', scene)
        partNode.rotationQuaternion = null
        partNode.parent = rootRef.current
        partNodeLocalRef.current = partNode

        const modelNode = new TransformNode('builder-model', scene)
        modelNode.rotationQuaternion = null
        modelNode.parent = partNode
        modelNodeRef.current = modelNode

        // Copy root transform if present
        if (rootMesh) {
          if (rootMesh.rotationQuaternion) {
            modelNode.rotationQuaternion = rootMesh.rotationQuaternion.clone()
          } else {
            modelNode.rotation.copyFrom(rootMesh.rotation)
          }
          modelNode.scaling.copyFrom(rootMesh.scaling)
          modelNode.position.copyFrom(rootMesh.position)
        }

        // Parent meshes to model node
        for (const mesh of meshes) {
          if (mesh.rotationQuaternion) {
            const euler = mesh.rotationQuaternion.toEulerAngles()
            mesh.rotationQuaternion = null
            mesh.rotation.copyFrom(euler)
          }
          mesh.parent = modelNode
          mesh.setEnabled(true)
          mesh.isPickable = true
          meshesRef.current.push(mesh)
        }

        // Dispose unused nodes
        for (const m of loaded) {
          if (!meshes.includes(m as Mesh) && m !== rootMesh) safeDispose(m)
        }
        if (rootMesh) safeDispose(rootMesh)

        // Auto-scale if too large
        partNode.computeWorldMatrix(true)
        for (const mesh of meshes) {
          mesh.computeWorldMatrix(true)
          mesh.refreshBoundingInfo()
        }

        let bbMin = new Vector3(Infinity, Infinity, Infinity)
        let bbMax = new Vector3(-Infinity, -Infinity, -Infinity)
        for (const mesh of meshes) {
          mesh.getBoundingInfo().update(mesh.getWorldMatrix())
          bbMin = Vector3.Minimize(bbMin, mesh.getBoundingInfo().boundingBox.minimumWorld)
          bbMax = Vector3.Maximize(bbMax, mesh.getBoundingInfo().boundingBox.maximumWorld)
        }

        const extent = bbMax.subtract(bbMin)
        const maxExtent = Math.max(extent.x, extent.y, extent.z)
        if (maxExtent > 5) {
          modelNode.scaling.scaleInPlace(1 / maxExtent)
        }
        setUniformScale(roundTo4(modelNode.scaling.x))

        // Notify parent
        onLoaded(partNode, modelNode, meshes)
      } catch (err) {
        console.error('Failed to load GLB part:', err)
      } finally {
        setLoading(false)
      }
    },
    [rootRef, onLoaded, onBeforeLoad, disposePart]
  )

  return {
    modelNodeRef,
    meshesRef,
    loading,
    uniformScale,
    dimensions,
    showBoundingBox,
    setUniformScale,
    setShowBoundingBox,
    loadPart,
    updateBoundingBox,
    applyScale,
    disposePart,
  }
}
