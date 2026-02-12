/**
 * Shared Frame Materials — Centralized PBR materials for tent frame parts.
 *
 * All frame components should import from here instead of creating
 * materials locally. Materials are cached per-scene and frozen after
 * creation to eliminate per-frame uniform uploads.
 *
 * Usage:
 *   import { getAluminumMaterial } from '@lib/materials/frameMaterials'
 *   mesh.material = getAluminumMaterial(scene)
 */

import { type Scene, PBRMaterial, Color3 } from '@babylonjs/core'

// ─── Material Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, PBRMaterial>()

function getCachedOrCreate(
  key: string,
  scene: Scene,
  factory: (mat: PBRMaterial) => void
): PBRMaterial {
  const existing = cache.get(key)
  // Return cached material if it still belongs to the active scene
  if (existing && existing.getScene() === scene) return existing
  // Stale entry from a previous scene — dispose and recreate
  if (existing) { try { existing.dispose() } catch { /* already gone */ } }

  const mat = new PBRMaterial(key, scene)
  factory(mat)

  // Freeze after setup — prevents Babylon from re-evaluating every frame
  mat.freeze()
  cache.set(key, mat)
  return mat
}

// ─── Aluminum (primary frame material) ───────────────────────────────────────

/**
 * Brushed-aluminum PBR material.
 * Suitable for baseplates, uprights, purlins, beams.
 */
export function getAluminumMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-aluminum-frame', scene, (mat) => {
    mat.albedoColor = new Color3(0.6, 0.61, 0.62) // medium aluminum gray
    mat.metallic = 0.9
    mat.roughness = 0.5
    mat.ambientColor = new Color3(0.15, 0.15, 0.16)
    mat.environmentIntensity = 0.6

    mat.enableSpecularAntiAliasing = true

    mat.backFaceCulling = true
  })
}

// ─── Steel (heavier structural parts) ────────────────────────────────────────

/**
 * Galvanized-steel PBR material.
 * Suitable for heavier structural connectors and bracing.
 */
export function getSteelMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-steel-frame', scene, (mat) => {
    mat.albedoColor = new Color3(0.55, 0.56, 0.58)
    mat.metallic = 1.0
    mat.roughness = 0.45 // slightly rougher than aluminum
    mat.ambientColor = new Color3(0.1, 0.1, 0.12)

    mat.useRadianceOverAlpha = true
    mat.useSpecularOverAlpha = true
    mat.enableSpecularAntiAliasing = true

    mat.backFaceCulling = true
  })
}

// ─── Dark Powder-Coat (optional accent material) ─────────────────────────────

/**
 * Dark powder-coated metal material.
 * Suitable for connector plates, hinges, hardware accents.
 */
export function getDarkMetalMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-dark-metal', scene, (mat) => {
    mat.albedoColor = new Color3(0.12, 0.12, 0.14)
    mat.metallic = 0.85
    mat.roughness = 0.55

    mat.backFaceCulling = true
  })
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Dispose all cached frame materials. Call on scene teardown.
 */
export function disposeFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.dispose() } catch { /* already disposed */ }
  }
  cache.clear()
}
