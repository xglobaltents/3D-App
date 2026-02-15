/**
 * Shared Cover Materials — PBR materials for tent covers and fabrics.
 *
 * Covers use PBRMaterial for realistic fabric appearance with optional
 * subsurface translucency (light bleeding through tent skin).
 *
 * Usage:
 *   import { getWhiteCoverMaterial } from '@lib/materials/coverMaterials'
 *   mesh.material = getWhiteCoverMaterial(scene)
 */

import { type Scene, PBRMaterial, Color3 } from '@babylonjs/core'

// ─── Material Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, PBRMaterial>()

/**
 * Get a cached material or create a new one via factory.
 * Validates scene ownership \u2014 disposes stale entries from previous scenes.
 * Same pattern as frameMaterials.ts for consistency.
 */
function getCachedOrCreate(
  key: string,
  scene: Scene,
  factory: (mat: PBRMaterial) => void
): PBRMaterial {
  const existing = cache.get(key)
  // Return cached material if it still belongs to the active scene
  if (existing && existing.getScene() === scene) return existing
  // Stale entry from a previous scene \u2014 dispose and recreate
  if (existing) { try { existing.dispose() } catch { /* already gone */ } }
  cache.delete(key)

  const mat = new PBRMaterial(key, scene)
  factory(mat)

  // Freeze after setup \u2014 prevents Babylon from re-evaluating every frame
  mat.freeze()
  cache.set(key, mat)
  return mat
}

// ─── Options ─────────────────────────────────────────────────────────────────

export interface CoverMaterialOptions {
  /** Base colour of the fabric */
  color: Color3
  /** 0 = fully opaque, 1 = fully translucent (default 0) */
  translucency?: number
  /** Override roughness (default 0.65 — woven fabric) */
  roughness?: number
  /** Human-readable name override */
  name?: string
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Get (or create) a PBR cover material with the given options.
 * Materials are cached by color + translucency combo.
 */
export function getCoverMaterial(
  scene: Scene,
  options: CoverMaterialOptions
): PBRMaterial {
  const key =
    options.name ??
    `cover-${options.color.toHexString()}-t${options.translucency ?? 0}`

  return getCachedOrCreate(key, scene, (mat) => {
    // PVC / fabric look
    mat.albedoColor = options.color
    mat.metallic = 0.0
    mat.roughness = options.roughness ?? 0.65
    mat.ambientColor = new Color3(0.1, 0.1, 0.1)
    // TODO: Add bumpTexture (normal map) and microSurface roughness texture
    // when fabric texture assets become available for improved weave detail.

    // Subsurface translucency \u2014 light bleeding through fabric
    const t = options.translucency ?? 0
    if (t > 0) {
      mat.subSurface.isTranslucencyEnabled = true
      mat.subSurface.translucencyIntensity = t
      mat.subSurface.tintColor = options.color.scale(0.8)
    }

    // Two-sided \u2014 covers are visible from inside the tent
    mat.backFaceCulling = false

    // Specular AA prevents sparkling on PVC at glancing angles
    mat.enableSpecularAntiAliasing = true
  })
}

// ─── Presets ─────────────────────────────────────────────────────────────────

/** Standard white PVC tent skin. */
export function getWhiteCoverMaterial(scene: Scene): PBRMaterial {
  return getCoverMaterial(scene, {
    color: new Color3(0.95, 0.95, 0.93),
    translucency: 0.15,
    name: 'shared-white-cover',
  })
}

/** Semi-transparent clear-span PVC side panel. */
export function getTranslucentPanelMaterial(scene: Scene): PBRMaterial {
  return getCoverMaterial(scene, {
    color: new Color3(0.92, 0.94, 0.96),
    translucency: 0.55,
    roughness: 0.3,
    name: 'shared-translucent-panel',
  })
}

/** Beige / sand fabric. */
export function getBeigeCoverMaterial(scene: Scene): PBRMaterial {
  return getCoverMaterial(scene, {
    color: new Color3(0.87, 0.82, 0.72),
    translucency: 0.1,
    name: 'shared-beige-cover',
  })
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Dispose all cached cover materials. Call on scene teardown.
 */
export function disposeCoverMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.dispose() } catch { /* already disposed */ }
  }
  cache.clear()
}
