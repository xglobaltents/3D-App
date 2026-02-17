/**
 * Shared Frame Materials — Centralized materials for tent frame parts.
 *
 * Aluminum uses StandardMaterial (Phong/Blinn) instead of PBRMaterial.
 * StandardMaterial responds only to direct scene lights — it has zero
 * dependency on IBL / environment textures.  This makes the aluminum
 * look identical across default, white-studio, and black-studio presets
 * without any per-preset compensation hacks.
 *
 * Steel and dark-metal remain PBRMaterial for now (not yet in use).
 *
 * Usage:
 *   import { getAluminumMaterial } from '@lib/materials/frameMaterials'
 *   mesh.material = getAluminumMaterial(scene)
 */

import { type Scene, StandardMaterial, PBRMaterial, Color3, Constants, type Material } from '@babylonjs/core'
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
 * Brushed-aluminum StandardMaterial.
 * Suitable for baseplates, uprights, purlins, beams.
 *
 * StandardMaterial uses Phong/Blinn shading driven entirely by scene lights.
 * No IBL / environment texture dependency → looks the same in every preset.
 */
export function getAluminumMaterial(scene: Scene): StandardMaterial {
  return getCachedOrCreate('shared-aluminum-frame', scene, (s) => {
    const mat = new StandardMaterial('shared-aluminum-frame', s)

    // ── Diffuse: neutral aluminum grey ──
    mat.diffuseColor = new Color3(0.62, 0.64, 0.66)

    // ── Specular: bright white-ish highlights for metallic sheen ──
    mat.specularColor = new Color3(0.6, 0.58, 0.55)
    mat.specularPower = 48   // moderately tight highlight = brushed metal

    // ── Ambient: slight fill so it's not pitch-black in shadow ──
    mat.ambientColor = new Color3(0.15, 0.15, 0.16)

    // ── Emissive: none ──
    mat.emissiveColor = Color3.Black()

    mat.backFaceCulling = true

    return mat
  })
}

/**
 * No-op — StandardMaterial aluminum is env-independent by nature.
 * Kept for API compatibility with SceneSetup callers.
 */
export function setFrameMaterialEnvironmentProfile(_preset: EnvironmentPreset): void {
  // Nothing to do. StandardMaterial doesn't use IBL.
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
 * Mark cached materials dirty after scene env changes (IBL load).
 * StandardMaterial aluminum doesn't need this, but steel/dark-metal PBR do.
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
 * Dispose all cached frame materials. Call on scene teardown.
 */
export function disposeFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.dispose() } catch { /* already disposed */ }
  }
  cache.clear()
}
