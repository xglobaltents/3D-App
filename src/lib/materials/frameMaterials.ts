/**
 * Shared Frame Materials — Centralized PBR materials for tent frame parts.
 *
 * Standard PBR using scene.environmentTexture for reflections.
 * Scene lights provide direct illumination.
 *
 * Materials are NOT frozen — freezing causes stale GPU pipeline state on
 * WebGPU when meshes are disposed + re-created (bay change).
 *
 * Usage:
 *   import { getAluminumMaterial } from '@lib/materials/frameMaterials'
 *   mesh.material = getAluminumMaterial(scene)
 */

import { type Scene, PBRMaterial, Color3, Constants, type Material } from '@babylonjs/core'
import type { EnvironmentPreset } from '@/lib/constants/sceneConfig'

// ─── Material Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, Material>()

function getCachedOrCreate<T extends Material>(
  key: string,
  scene: Scene,
  factory: (scene: Scene) => T
): T {
  const existing = cache.get(key)
  if (existing && existing.getScene() === scene) return existing as T
  if (existing) { try { existing.dispose() } catch { /* already gone */ } }
  cache.delete(key)

  const mat = factory(scene)
  cache.set(key, mat)
  return mat
}

// ─── Aluminum (primary frame material) ───────────────────────────────────────

/**
 * Brushed-aluminum PBR material (metallic 0.92).
 * Suitable for baseplates, uprights, purlins, beams.
 *
 * Uses standard PBR with scene.environmentTexture — no custom cubemap,
 * no async loading, no flash.  At metallic 0.92 the reflections are
 * strongly tinted by albedoColor so the look is naturally consistent.
 */
export function getAluminumMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-aluminum-frame', scene, (s) => {
    const mat = new PBRMaterial('shared-aluminum-frame', s)

    mat.albedoColor = new Color3(0.62, 0.64, 0.66)
    mat.metallic = 0.92
    mat.roughness = 0.42
    mat.microSurface = 0.58

    // Uses scene.environmentTexture for IBL reflections (no custom cubemap).
    // Scene lights provide direct illumination.
    mat.environmentIntensity = 0.8
    mat.directIntensity = 1.0
    mat.specularIntensity = 1.0

    mat.useRadianceOverAlpha = true
    mat.useSpecularOverAlpha = true
    mat.enableSpecularAntiAliasing = true
    mat.backFaceCulling = true

    return mat
  })
}

/**
 * No-op — kept for API compatibility with SceneSetup callers.
 */
export function setFrameMaterialEnvironmentProfile(_preset: EnvironmentPreset): void {
  // Reserved for future per-preset tweaks.
}

// Re-export the type so call-sites don't need a separate import.
export type { EnvironmentPreset } from '@/lib/constants/sceneConfig'

// ─── Steel (heavier structural parts) ────────────────────────────────────────

/**
 * Galvanized-steel PBR material.
 * Suitable for heavier structural connectors and bracing.
 */
export function getSteelMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-steel-frame', scene, (s) => {
    const mat = new PBRMaterial('shared-steel-frame', s)
    mat.albedoColor = new Color3(0.58, 0.60, 0.63)
    mat.metallic = 0.2
    mat.roughness = 0.5
    mat.environmentIntensity = 0.3
    mat.directIntensity = 1.8
    mat.specularIntensity = 0.7

    mat.useRadianceOverAlpha = true
    mat.useSpecularOverAlpha = true
    mat.enableSpecularAntiAliasing = true
    mat.backFaceCulling = true
    return mat
  })
}

// ─── Dark Powder-Coat (optional accent material) ─────────────────────────────

/**
 * Dark powder-coated metal material.
 * Suitable for connector plates, hinges, hardware accents.
 */
export function getDarkMetalMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-dark-metal', scene, (s) => {
    const mat = new PBRMaterial('shared-dark-metal', s)
    mat.albedoColor = new Color3(0.15, 0.15, 0.17)
    mat.metallic = 0.1
    mat.roughness = 0.6
    mat.environmentIntensity = 0.2
    mat.directIntensity = 1.6
    mat.specularIntensity = 0.5
    mat.backFaceCulling = true
    return mat
  })
}

// ─── Refresh (after environment change) ──────────────────────────────────────

/**
 * Mark all cached PBR materials dirty after scene env changes (IBL load).
 */
export function refreshFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try {
      if (mat instanceof PBRMaterial) {
        mat.markAsDirty(Constants.MATERIAL_TextureDirtyFlag)
      }
    } catch { /* disposed */ }
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Dispose all cached frame materials.
 * Call on scene teardown.
 */
export function disposeFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.dispose() } catch { /* already disposed */ }
  }
  cache.clear()
}
