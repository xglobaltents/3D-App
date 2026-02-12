import { Scene, SceneLoader, AbstractMesh, Mesh, Matrix, Vector3, Quaternion, type Material } from '@babylonjs/core'
import '@babylonjs/loaders/glTF'

// ─── GLB Asset Cache ─────────────────────────────────────────────────────────

const glbCache = new Map<string, AbstractMesh[]>()

/**
 * Clear all cached GLB template meshes. Call on scene teardown.
 */
export function clearGLBCache(): void {
  glbCache.clear()
}

// ─── GLB Loading ─────────────────────────────────────────────────────────────

/**
 * Load a GLB model from path. Results are cached by path so the same
 * file is only fetched/parsed once; subsequent calls clone from the
 * cached template meshes.
 * @param scene - Babylon scene
 * @param folder - Folder path (e.g., '/tents/PremiumArchTent/15m/frame/')
 * @param filename - GLB filename (e.g., 'baseplate.glb')
 */
export async function loadGLB(
  scene: Scene,
  folder: string,
  filename: string
): Promise<AbstractMesh[]> {
  const key = folder + filename

  const cached = glbCache.get(key)
  if (cached) {
    // Clone each cached template mesh into the current scene
    return cached.map((m) => {
      const clone = m.clone(m.name, null)
      if (clone) {
        clone.setEnabled(true)
        return clone
      }
      return m
    }).filter(Boolean) as AbstractMesh[]
  }

  const result = await SceneLoader.ImportMeshAsync('', folder, filename, scene)

  // Store originals as hidden templates — callers get clones so
  // disposing clones never poisons the cache.
  for (const m of result.meshes) {
    m.setEnabled(false)
  }
  glbCache.set(key, result.meshes)

  return result.meshes.map((m) => {
    const clone = m.clone(m.name, null)
    if (clone) {
      clone.setEnabled(true)
      return clone
    }
    return m
  }).filter(Boolean) as AbstractMesh[]
}

/**
 * Load GLB and get the root mesh (first mesh with geometry)
 */
export async function loadGLBMesh(
  scene: Scene,
  folder: string,
  filename: string
): Promise<Mesh | null> {
  const meshes = await loadGLB(scene, folder, filename)
  
  // Find first mesh with actual geometry (skip __root__)
  for (const mesh of meshes) {
    if (mesh instanceof Mesh && mesh.geometry) {
      return mesh
    }
  }
  
  return meshes[0] as Mesh || null
}

// ─── Thin Instances (GPU Instancing) ─────────────────────────────────────────

export interface InstanceTransform {
  position: Vector3
  rotation?: Vector3
  scaling?: Vector3
}

/**
 * Create thin instances for a mesh (Babylon's GPU instancing)
 * Similar to THREE.InstancedMesh
 */
export function createThinInstances(mesh: Mesh, transforms: InstanceTransform[]): void {
  if (transforms.length === 0) return

  const matrices: Matrix[] = []

  for (const t of transforms) {
    const matrix = Matrix.Compose(
      t.scaling || Vector3.One(),
      Quaternion.FromEulerAngles(
        t.rotation?.x || 0,
        t.rotation?.y || 0,
        t.rotation?.z || 0
      ),
      t.position
    )
    matrices.push(matrix)
  }

  // Convert to Float32Array
  const matrixData = new Float32Array(matrices.length * 16)
  for (let i = 0; i < matrices.length; i++) {
    matrices[i].copyToArray(matrixData, i * 16)
  }

  mesh.thinInstanceSetBuffer('matrix', matrixData, 16)
}

/**
 * Add a single thin instance to an existing mesh
 */
export function addThinInstance(mesh: Mesh, transform: InstanceTransform): number {
  const matrix = Matrix.Compose(
    transform.scaling || Vector3.One(),
    Quaternion.FromEulerAngles(
      transform.rotation?.x || 0,
      transform.rotation?.y || 0,
      transform.rotation?.z || 0
    ),
    transform.position
  )

  return mesh.thinInstanceAdd(matrix)
}

// ─── Material Helpers ────────────────────────────────────────────────────────

/**
 * Strip default GLB materials from loaded meshes and optionally
 * apply a replacement material.
 *
 * Always call this on GLB-loaded meshes so that default embedded
 * materials don't waste GPU memory or override code-defined looks.
 */
export function stripAndApplyMaterial(
  meshes: AbstractMesh[],
  material?: Material
): void {
  for (const mesh of meshes) {
    if (mesh instanceof Mesh) {
      // Dispose the GLB's embedded material + its textures
      if (mesh.material) {
        mesh.material.dispose(true, true)
      }
      if (material) {
        mesh.material = material
      }
    }
  }
}

// ─── Static Mesh Freeze Helpers ──────────────────────────────────────────────

/**
 * Freeze a mesh that will never move or deform at runtime.
 * Eliminates per-frame world-matrix recalculation and normal-matrix
 * recomputation — significant CPU savings on large frame assemblies.
 */
export function freezeStaticMesh(mesh: Mesh): void {
  mesh.freezeWorldMatrix()
  mesh.freezeNormals()
}

/**
 * Freeze an array of meshes (convenience wrapper).
 */
export function freezeStaticMeshes(meshes: AbstractMesh[]): void {
  for (const mesh of meshes) {
    if (mesh instanceof Mesh) {
      freezeStaticMesh(mesh)
    }
  }
}

/**
 * Enhanced thin-instance creation with automatic freezing.
 * After calling this, the mesh and its instances are fully static —
 * world matrix, normals, and bounding info are all frozen.
 */
export function createFrozenThinInstances(
  mesh: Mesh,
  transforms: InstanceTransform[]
): void {
  createThinInstances(mesh, transforms)

  // Freeze everything — thin instances are static geometry
  mesh.freezeWorldMatrix()
  mesh.freezeNormals()
  mesh.doNotSyncBoundingInfo = true
}
