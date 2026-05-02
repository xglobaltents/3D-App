/**
 * Shared Frame Materials — single aluminum PBR material for every tent
 * frame part.
 *
 * Design intent (May 2026):
 *   - One material on the GPU for the whole frame so every part reads as
 *     the same colour under the same lighting.
 *   - Pure diffuse (metallic 0, roughness 1, no IBL, no specular) so the
 *     surface is environment-independent and free of shimmer/flicker on
 *     thin geometry.
 *   - Per-environment intensity tuning still flows through
 *     `setFrameMaterialEnvironmentProfile()` so future preset additions
 *     can re-balance the look without forking materials.
 *
 * Materials are NOT frozen — freezing causes stale GPU pipeline state on
 * WebGPU when meshes are disposed + re-created (bay change).
 *
 * Usage:
 *   import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
 *   mesh.material = getAluminumMaterial(scene)
 */

import {
  type Scene,
  PBRMaterial,
  Color3,
  Constants,
} from '@babylonjs/core'
import type { EnvironmentPreset } from '@/lib/constants/sceneConfig'

// ─── Per-Preset Intensity Profile ────────────────────────────────────────────

interface AluminumIntensityProfile {
  directIntensity: number
  environmentIntensity: number
  specularIntensity: number
}

const INTENSITY_PROFILES: Record<EnvironmentPreset, AluminumIntensityProfile> = {
  default: { directIntensity: 0.55, environmentIntensity: 1.1, specularIntensity: 1.0 },
}

/** Current active preset — used when creating the material mid-session */
let activePreset: EnvironmentPreset = 'default'

// ─── Material Cache ──────────────────────────────────────────────────────────

const cache = new Map<string, PBRMaterial>()

const ALUMINUM_KEY = 'shared-aluminum-frame'

function getCachedOrCreate(
  key: string,
  scene: Scene,
  factory: (scene: Scene) => PBRMaterial,
): PBRMaterial {
  const existing = cache.get(key)
  if (existing && existing.getScene() === scene) return existing
  if (existing) { try { existing.dispose() } catch { /* already gone */ } }
  cache.delete(key)

  const mat = factory(scene)
  cache.set(key, mat)
  return mat
}

// ─── Aluminum (sole frame material) ──────────────────────────────────────────

/**
 * Shared aluminum-look PBR material used by every frame component.
 *
 * Pure diffuse (metallic 0, roughness 1, no reflection): consistent colour
 * across all parts and environments, no temporal aliasing on thin geometry.
 */
export function getAluminumMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate(ALUMINUM_KEY, scene, (s) => {
    const mat = new PBRMaterial(ALUMINUM_KEY, s)
    const profile = INTENSITY_PROFILES[activePreset]

    // Mid-grey aluminum tone. With four scene lights summing to >1.0
    // illumination, a brighter albedo would saturate sun-facing faces to
    // pure white while shadowed faces stayed grey — making every part look
    // like a different shade. A low albedo + dimmed directIntensity keeps
    // the whole frame in mid-grey range.
    mat.albedoColor = new Color3(0.42, 0.43, 0.45)

    // Dielectric + no IBL + no specular = purely diffuse Lambertian shading.
    mat.metallic = 0.0
    mat.roughness = 1.0
    mat.reflectionTexture = null
    mat.environmentIntensity = 0
    mat.specularIntensity = 0

    // No bump / no metallic texture — UV-less procedural meshes would
    // render differently from GLB meshes if these were present. Removing
    // them guarantees consistent shading inputs.
    mat.bumpTexture = null
    mat.metallicTexture = null
    mat.useRoughnessFromMetallicTextureGreen = false
    mat.useMetallnessFromMetallicTextureBlue = false
    mat.useAmbientOcclusionFromMetallicTextureRed = false

    mat.directIntensity = profile.directIntensity
    mat.enableSpecularAntiAliasing = true
    mat.backFaceCulling = true

    return mat
  })
}

// ─── Per-Preset Tuning ───────────────────────────────────────────────────────

/**
 * Adjust aluminum intensities to compensate for each environment preset's
 * different light rig.  Call this BEFORE refreshFrameMaterialCache() when
 * switching environments.
 */
export function setFrameMaterialEnvironmentProfile(preset: EnvironmentPreset): void {
  activePreset = preset
  const profile = INTENSITY_PROFILES[preset]

  const mat = cache.get(ALUMINUM_KEY)
  if (mat) {
    mat.directIntensity = profile.directIntensity
    mat.specularIntensity = profile.specularIntensity
    mat.environmentIntensity = profile.environmentIntensity
  }
}

// ─── Refresh (after environment change) ──────────────────────────────────────

/**
 * Mark the cached aluminum material dirty after scene env changes (IBL load).
 * Kept as a no-op-safe hook so SceneSetup callers don't need to branch.
 */
export function refreshFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.markAsDirty(Constants.MATERIAL_TextureDirtyFlag) } catch { /* disposed */ }
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Dispose the cached aluminum material. Call on scene teardown.
 */
export function disposeFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.dispose() } catch { /* already disposed */ }
  }
  cache.clear()
}

// Re-export the type so call-sites don't need a separate import.
export type { EnvironmentPreset } from '@/lib/constants/sceneConfig'
