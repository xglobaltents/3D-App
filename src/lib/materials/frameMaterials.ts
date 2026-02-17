/**
 * Shared Frame Materials — Centralized PBR materials for tent frame parts.
 *
 * All frame components should import from here instead of creating
 * materials locally. Materials are cached per-scene to avoid duplicates.
 *
 * NOTE: Materials are intentionally NOT frozen. Freezing a PBR material
 * causes `isReadyForSubMesh` to skip shader recompilation for new meshes.
 * When bay count changes, old meshes are disposed and new clones + thin
 * instances are created. On WebGPU the stale GPU pipeline from the frozen
 * material renders black or wrong colours. Leaving materials unfrozen lets
 * Babylon recompile shaders correctly for each new sub-mesh.  The per-frame
 * cost of one unfrozen PBR material is negligible (~microseconds).
 *
 * Strategy: Low metallic + high direct light response. This makes the
 * material behave like anodized aluminum that reads from scene lights
 * not environment reflections. Consistent across all presets.
 *
 * Usage:
 *   import { getAluminumMaterial } from '@lib/materials/frameMaterials'
 *   mesh.material = getAluminumMaterial(scene)
 */

import { type Scene, PBRMaterial, Color3, Constants } from '@babylonjs/core'
import type { EnvironmentPreset } from '@/lib/constants/sceneConfig'

// ─── Material Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, PBRMaterial>()
let currentPreset: EnvironmentPreset = 'default'

/**
 * Per-preset directIntensity to compensate for different total scene light.
 *
 * Total light power arriving at a surface:
 *   default  → hemi 0.8 + sun 1.5 + fill 0.8 + bottom 0.3 ≈ 3.4
 *   white    → hemi 0.8 + dir 1.2                          ≈ 2.0
 *   black    → hemi 0.35 + dir 0.7                         ≈ 1.05
 *
 * We pick directIntensity values that yield the same apparent brightness.
 * All other material properties stay identical → same colour / reflections.
 */
function getDirectIntensityForPreset(preset: EnvironmentPreset): number {
  switch (preset) {
    case 'white': return 1.35
    case 'black': return 2.5
    default:      return 0.85   // default env (brightest lights)
  }
}

function getCachedOrCreate(
  key: string,
  scene: Scene,
  factory: (mat: PBRMaterial) => void
): PBRMaterial {
  const existing = cache.get(key)
  // Return cached material if it still belongs to the active scene
  if (existing && existing.getScene() === scene) return existing
  // Stale entry from a previous scene — dispose and recreate (#26)
  if (existing) { try { existing.dispose() } catch { /* already gone */ } }
  cache.delete(key)

  const mat = new PBRMaterial(key, scene)
  factory(mat)

  // NOT frozen — see module doc comment above for rationale.
  cache.set(key, mat)
  return mat
}

// ─── Aluminum (primary frame material) ───────────────────────────────────────

/**
 * Brushed-aluminum PBR material.
 * Suitable for baseplates, uprights, purlins, beams.
 *
 * Same albedo, metallic, roughness, reflectivity across all environments.
 * Only `directIntensity` is adjusted per-preset to compensate for the
 * different total light power in each environment rig, keeping the
 * perceived brightness consistent.
 *
 * `environmentIntensity = 0` so IBL / env-texture switches have zero
 * visual effect on the aluminum.
 */
export function getAluminumMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-aluminum-frame', scene, (mat) => {
    mat.albedoColor = new Color3(0.62, 0.64, 0.66)

    mat.metallic = 0.18
    mat.roughness = 0.45

    mat.environmentIntensity = 0
    mat.directIntensity = getDirectIntensityForPreset(currentPreset)
    mat.specularIntensity = 0.7
    mat.reflectivityColor = new Color3(0.45, 0.43, 0.40)

    mat.useRadianceOverAlpha = false
    mat.useSpecularOverAlpha = true
    mat.enableSpecularAntiAliasing = true
    mat.backFaceCulling = true
  })
}

export function setFrameMaterialEnvironmentProfile(preset: EnvironmentPreset): void {
  currentPreset = preset

  const aluminum = cache.get('shared-aluminum-frame')
  if (!aluminum) return

  // Only directIntensity changes — compensates different light totals.
  aluminum.directIntensity = getDirectIntensityForPreset(preset)
}

// Re-export the type so call-sites don't need a separate import.
export type { EnvironmentPreset } from '@/lib/constants/sceneConfig'

// ─── Steel (heavier structural parts) ────────────────────────────────────────

/**
 * Galvanized-steel PBR material.
 * Suitable for heavier structural connectors and bracing.
 */
export function getSteelMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-steel-frame', scene, (mat) => {
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
  })
}

// ─── Dark Powder-Coat (optional accent material) ─────────────────────────────

/**
 * Dark powder-coated metal material.
 * Suitable for connector plates, hinges, hardware accents.
 */
export function getDarkMetalMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-dark-metal', scene, (mat) => {
    mat.albedoColor = new Color3(0.15, 0.15, 0.17)
    mat.metallic = 0.1
    mat.roughness = 0.6
    mat.environmentIntensity = 0.2
    mat.directIntensity = 1.6
    mat.specularIntensity = 0.5

    mat.backFaceCulling = true
  })
}

// ─── Refresh (after environment change) ──────────────────────────────────────

/**
 * Force all cached PBR materials to mark their defines as dirty so they
 * recompile on the next render. Call after scene.environmentTexture changes
 * (e.g. IBL load) so PBR picks up the new reflection/irradiance maps.
 */
export function refreshFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try {
      mat.markAsDirty(Constants.MATERIAL_TextureDirtyFlag)
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
