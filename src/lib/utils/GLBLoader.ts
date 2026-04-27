import {
  Scene,
  AbstractMesh,
  Mesh,
  Matrix,
  Vector3,
  Quaternion,
  type Material,
  AssetContainer,
  LoadAssetContainerAsync,
  TransformNode,
} from '@babylonjs/core'
import '@babylonjs/loaders/glTF'

// ─── GLB Asset Cache ─────────────────────────────────────────────────────────
//
// Internally the loader uses Babylon's modern AssetContainer API
// (`LoadAssetContainerAsync`) and caches the container per (scene, url).
// Each call to `loadGLB` instantiates fresh meshes via
// `instantiateModelsToScene` so callers can dispose freely without
// poisoning the cache.
//
// Public return shape is intentionally unchanged from the legacy
// `SceneLoader.ImportMeshAsync` flow — every caller already knows how to
// reset transforms / re-parent / set thin instances on the returned meshes.

interface CacheEntry {
  container: AssetContainer
  sceneUid: string
  /** World matrix of each mesh at import time (with full parent hierarchy). Keyed by mesh name. */
  worldMatrices: Map<string, Matrix>
  /** GLTF root transform captured from the container's transformNodes. */
  rootTransform?: Matrix
}

const glbCache = new Map<string, CacheEntry>()

function getContainerRootTransform(container: AssetContainer): Matrix | undefined {
  const rootNode = container.transformNodes.find((node) => node.name === '__root__')
    ?? container.transformNodes.find((node) => !node.parent)

  if (!rootNode) return undefined

  rootNode.computeWorldMatrix(true)
  return rootNode.getWorldMatrix().clone()
}

function captureWorldMatrices(container: AssetContainer): Map<string, Matrix> {
  const out = new Map<string, Matrix>()
  for (const m of container.meshes) {
    if (m instanceof Mesh && m.getTotalVertices() > 0) {
      m.computeWorldMatrix(true)
      out.set(m.name, m.getWorldMatrix().clone())
    }
  }
  return out
}

/**
 * Clear all cached GLB containers. Call on scene teardown.
 * Disposes containers that belong to the given scene (or all if no scene).
 */
export function clearGLBCache(scene?: Scene): void {
  if (!scene) {
    for (const entry of glbCache.values()) {
      try { entry.container.dispose() } catch { /* already gone */ }
    }
    glbCache.clear()
    return
  }
  const uid = scene.uid
  for (const [key, entry] of glbCache.entries()) {
    if (entry.sceneUid === uid) {
      try { entry.container.dispose() } catch { /* already gone */ }
      glbCache.delete(key)
    }
  }
}

// ─── GLB Loading ─────────────────────────────────────────────────────────────

// Concurrency limiter: caps simultaneous LoadAssetContainerAsync calls.
// Parsing GLBs is CPU-heavy (geometry decode, texture upload). Running 8+ in
// parallel blocks the main thread and delays first visible frame.
const GLB_CONCURRENCY = 3
let activeLoads = 0
const loadQueue: Array<() => void> = []

function acquireLoadSlot(): Promise<void> {
  if (activeLoads < GLB_CONCURRENCY) {
    activeLoads++
    return Promise.resolve()
  }
  return new Promise<void>((resolve) => {
    loadQueue.push(() => {
      activeLoads++
      resolve()
    })
  })
}

function releaseLoadSlot(): void {
  activeLoads--
  const next = loadQueue.shift()
  if (next) next()
}

/**
 * Instantiate fresh meshes from a cached AssetContainer.
 * Returns the geometry meshes (filters out helper transformNodes).
 * Each instantiated mesh starts DISABLED until the caller assigns a material.
 */
function instantiateFromCache(entry: CacheEntry): AbstractMesh[] {
  // doNotInstantiate: true → real geometry clones (not GPU-instanced linked copies).
  // Each tent component sets its own thin instances on the returned meshes,
  // which requires independent geometry per call.
  const entries = entry.container.instantiateModelsToScene(
    (name) => name,
    /* cloneMaterials */ false,
    { doNotInstantiate: true },
  )

  // Collect every geometry mesh under each cloned root, detach it from its
  // parent (callers reparent freely), then dispose the empty TransformNode
  // skeleton with doNotRecurse=true so the meshes survive.
  const out: AbstractMesh[] = []
  for (const root of entries.rootNodes) {
    if (!(root instanceof TransformNode)) {
      continue
    }
    // getChildMeshes() with no arg = recursive descendants (matches legacy
    // ImportMeshAsync.meshes which was a flat list of all geometry).
    for (const child of root.getChildMeshes()) {
      // Use raw parent assignment (NOT setParent) so the mesh keeps its
      // LOCAL transform unchanged. Callers — e.g. the Matrix Chain pattern
      // documented in /memories/repo/frame-parts-guidance.md — expect the
      // mesh's matrix to match what `Mesh.clone(name, null)` produced under
      // the legacy ImportMeshAsync flow: local transform preserved, world
      // transform recomputed against the new (null) parent. `setParent(null)`
      // would bake the old world matrix into local and invalidate the chain.
      child.parent = null
      out.push(child)
    }
    // Now the root and any intermediate TransformNodes are empty — dispose
    // them WITHOUT recursion so we don't kill the detached meshes.
    try { root.dispose(/* doNotRecurse */ true) } catch { /* already gone */ }
  }

  // Match legacy behaviour: clones start disabled until material is applied.
  for (const m of out) {
    m.setEnabled(false)
  }
  return out
}

/**
 * Load a GLB model from path. Results are cached by path+scene so the
 * same file is only fetched/parsed once per scene; subsequent calls
 * instantiate fresh meshes from the cached AssetContainer.
 *
 * GLB materials are skipped at parse time (`skipMaterials: true`) — every
 * caller replaces them anyway via `getAluminumMaterial` etc., so loading
 * them only to dispose them wastes time and risks shared-VAO bugs.
 *
 * Supports AbortSignal for cancellation in React effects.
 */
export async function loadGLB(
  scene: Scene,
  folder: string,
  filename: string,
  signal?: AbortSignal
): Promise<AbstractMesh[]> {
  const key = folder + filename

  const cached = glbCache.get(key)
  if (cached && cached.sceneUid === scene.uid) {
    return instantiateFromCache(cached)
  }
  // Stale cache from a different scene — evict it
  if (cached) {
    try { cached.container.dispose() } catch { /* already gone */ }
    glbCache.delete(key)
  }

  // Wait for a load slot (limits concurrent GLB parsing)
  await acquireLoadSlot()

  // Re-check abort and cache after waiting in queue
  if (signal?.aborted) {
    releaseLoadSlot()
    return []
  }
  // Another queued call may have loaded the same GLB while we waited
  const cachedAfterWait = glbCache.get(key)
  if (cachedAfterWait && cachedAfterWait.sceneUid === scene.uid) {
    releaseLoadSlot()
    return instantiateFromCache(cachedAfterWait)
  }

  let container: AssetContainer
  try {
    container = await LoadAssetContainerAsync(folder + filename, scene, {
      // Skip GLB-embedded materials entirely; every caller assigns its own.
      // This avoids loading + parsing + disposing throwaway PBRMaterials,
      // and side-steps the shared-VAO disposal hazards documented in the
      // legacy `stripAndApplyMaterial` helper below.
      pluginOptions: { gltf: { skipMaterials: true } },
    })
  } finally {
    releaseLoadSlot()
  }

  // Check abort after async
  if (signal?.aborted) {
    try { container.dispose() } catch { /* already gone */ }
    return []
  }

  // Capture each mesh's WORLD matrix while the full parent hierarchy is still
  // intact in the container (before any instantiation strips parents).
  // These saved world matrices let callers reconstruct the missing
  // intermediate-node transforms (e.g. Node 4 scale/rotation from
  // THREE.GLTFExporter GLBs).
  const worldMatrices = captureWorldMatrices(container)
  const rootTransform = getContainerRootTransform(container)

  // The container holds the original (template) meshes. They must NOT be
  // added to the scene — keep them inert so each `instantiateModelsToScene`
  // produces fresh independent geometry. `LoadAssetContainerAsync` already
  // returns a non-added container.
  const entry: CacheEntry = { container, sceneUid: scene.uid, worldMatrices, rootTransform }
  glbCache.set(key, entry)

  return instantiateFromCache(entry)
}

/**
 * Retrieve the cached world matrices from the ORIGINAL load for a given GLB.
 * These matrices include the full parent-chain transforms (intermediate node
 * scale, rotation, etc.) that cloned meshes lose.
 *
 * Returns undefined if the GLB hasn't been loaded yet or cache was evicted.
 */
export function getGLBWorldMatrices(
  folder: string,
  filename: string,
): Map<string, Matrix> | undefined {
  const key = folder + filename
  return glbCache.get(key)?.worldMatrices
}

/**
 * Retrieve the cached GLTF root transform captured from the container's
 * transformNodes. This is the actual model-level scale/rotation applied by
 * Babylon's GLTF loader.
 */
export function getGLBRootTransform(
  folder: string,
  filename: string,
): Matrix | undefined {
  const key = folder + filename
  return glbCache.get(key)?.rootTransform?.clone()
}

/**
 * Load GLB and get the first mesh with actual geometry.
 * Supports AbortSignal for cancellation.
 */
export async function loadGLBMesh(
  scene: Scene,
  folder: string,
  filename: string,
  signal?: AbortSignal
): Promise<Mesh | null> {
  const meshes = await loadGLB(scene, folder, filename, signal)
  
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
 *
 * IMPORTANT: We do NOT call dispose(true, true) on GLB materials.
 * Cloned meshes share geometry with cached templates, and Material.dispose()
 * releases VAOs from shared geometry and can destroy shared shader effects —
 * causing black / wrong-colour rendering on subsequent re-creates (e.g. bay
 * count change).  Instead we detach the old material, collect unique refs,
 * and dispose safely with notBoundToMesh=true, forceDisposeEffect=false.
 */
export function stripAndApplyMaterial(
  meshes: AbstractMesh[],
  material?: Material
): void {
  const toDispose = new Set<Material>()
  for (const mesh of meshes) {
    if (mesh instanceof Mesh) {
      const oldMat = mesh.material
      // Detach old material FIRST, then mark for disposal
      mesh.material = material ?? null
      if (oldMat && oldMat !== material) {
        toDispose.add(oldMat)
      }
    }
  }
  // Dispose old GLB materials safely:
  //  - forceDisposeEffect  = false → keep shared shader programs intact
  //  - forceDisposeTextures = true  → free embedded GLB textures
  //  - notBoundToMesh       = true  → don't iterate scene meshes / release VAOs
  for (const mat of toDispose) {
    try { mat.dispose(false, true, true) } catch { /* already gone */ }
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
 * Apply the standard set of perf flags to a mesh that holds thin instances:
 *  - Refresh bounding info to encompass ALL instance AABBs (so frustum
 *    culling works correctly — without `applyToMesh=true` the mesh AABB
 *    only covers the template at origin and culling silently fails).
 *  - `doNotSyncBoundingInfo` skips per-frame bounds re-sync (geometry is static).
 *  - Freeze world matrix and normals for static draw cost.
 *
 * Note: we deliberately DO NOT set `alwaysSelectAsActiveMesh = true` — that
 * disables frustum culling entirely, costing GPU work for off-screen meshes.
 *
 * Call this after the LAST `thinInstanceAdd`/`thinInstanceSetBuffer` on the mesh.
 */
export function freezeThinInstancedMesh(mesh: Mesh): void {
  mesh.thinInstanceRefreshBoundingInfo(true)
  mesh.doNotSyncBoundingInfo = true
  mesh.freezeWorldMatrix()
  mesh.freezeNormals()
}

/**
 * Enhanced thin-instance creation with automatic freezing.
 * After calling this, the mesh and its instances are fully static —
 * world matrix and normals are frozen, bounding info encompasses all instances.
 */
export function createFrozenThinInstances(
  mesh: Mesh,
  transforms: InstanceTransform[]
): void {
  createThinInstances(mesh, transforms)
  freezeThinInstancedMesh(mesh)
}

// ─── World Bounds Measurement ────────────────────────────────────────────────

export interface BoundsResult { min: Vector3; max: Vector3; size: Vector3 }

const boundsCache = new Map<string, BoundsResult>()

/** Clear all cached bounds. Call when meshes change (e.g. bay count update). */
export function clearBoundsCache(): void {
  boundsCache.clear()
}

/**
 * Measure combined world-space bounding box for an array of meshes.
 * Results are cached by optional key to avoid repeated `computeWorldMatrix` calls.
 */
export function measureWorldBounds(meshes: Mesh[], cacheKey?: string): BoundsResult {
  if (cacheKey) {
    const cached = boundsCache.get(cacheKey)
    if (cached) return cached
  }
  let min = new Vector3(Infinity, Infinity, Infinity)
  let max = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const m of meshes) {
    if (m.getTotalVertices() > 0) {
      m.computeWorldMatrix(true)
      m.refreshBoundingInfo()
      m.getBoundingInfo().update(m.getWorldMatrix())
      const bb = m.getBoundingInfo().boundingBox
      min = Vector3.Minimize(min, bb.minimumWorld)
      max = Vector3.Maximize(max, bb.maximumWorld)
    }
  }
  const result = { min, max, size: max.subtract(min) }
  if (cacheKey) boundsCache.set(cacheKey, result)
  return result
}
