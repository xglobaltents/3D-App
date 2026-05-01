/**
 * Shared Frame Materials — Centralized PBR materials for tent frame parts.
 *
 * Aluminum uses PBRMaterial with high metallic (0.92) for realistic
 * reflective aluminum.  To make it environment-independent, the material
 * gets its own FIXED reflection cubemap that never changes when the user
 * switches environment presets.  Scene.environmentTexture is ignored.
 *
 * ── Per-Preset Intensity Tuning ──
 * Each environment preset has a different light rig (4-light default,
 * 2-light studio white/black).  To keep aluminum looking consistent,
 * `setFrameMaterialEnvironmentProfile()` adjusts directIntensity and
 * environmentIntensity to compensate for the different scene lighting.
 *
 * ── Render-Loop Gating (Flash Prevention) ──
 * The render loop is deferred (in BabylonProvider) until environment
 * textures are loaded, so materials always compile with proper REFLECTION
 * shader defines.  No intensity ramp-up needed.
 *
 * Materials are NOT frozen — freezing causes stale GPU pipeline state on
 * WebGPU when meshes are disposed + re-created (bay change).
 *
 * Usage:
 *   import { getAluminumMaterial } from '@lib/materials/frameMaterials'
 *   mesh.material = getAluminumMaterial(scene)
 */

import {
  type Scene,
  PBRMaterial,
  Color3,
  Constants,
  CubeTexture,
  type Material,
} from '@babylonjs/core'
import type { EnvironmentPreset } from '@/lib/constants/sceneConfig'

// ─── Per-Preset Intensity Profiles ───────────────────────────────────────────
// Compensate for each preset's different light rig so aluminum/steel/dark-metal
// look visually consistent regardless of which environment is active.

interface MaterialIntensityProfile {
  aluminum: { directIntensity: number; environmentIntensity: number; specularIntensity: number }
  steel:    { directIntensity: number; environmentIntensity: number; specularIntensity: number }
  darkMetal:{ directIntensity: number; environmentIntensity: number; specularIntensity: number }
}

const INTENSITY_PROFILES: Record<EnvironmentPreset, MaterialIntensityProfile> = {
  // Default: 4 lights (hemi + sun + fill + bottom) — strongest rig
  default: {
    aluminum:  { directIntensity: 0.55, environmentIntensity: 1.1, specularIntensity: 1.0 },
    steel:     { directIntensity: 1.6,  environmentIntensity: 0.3, specularIntensity: 0.7 },
    darkMetal: { directIntensity: 1.4,  environmentIntensity: 0.2, specularIntensity: 0.5 },
  },
}

/** Current active preset — used when creating materials mid-session */
let activePreset: EnvironmentPreset = 'default'

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

// ─── Fixed Reflection for All Metals ─────────────────────────────────────────
// A dedicated CubeTexture that never changes with env preset switches.
// PBRMaterial.reflectionTexture overrides scene.environmentTexture when set.
// Uses the neutral (grayscale) specular env so metals pick up no colour tint.

const METAL_REFLECTION_URL = '/environments/environmentSpecular.env'
let metalReflection: CubeTexture | null = null
let metalReflectionSceneUid: string | null = null

function isTextureDisposed(tex: CubeTexture): boolean {
  const t = tex as unknown as Record<string, unknown>
  if (typeof t.isDisposed === 'function') return (t.isDisposed as () => boolean)()
  if (typeof t.isDisposed === 'boolean') return t.isDisposed
  if (typeof t._isDisposed === 'boolean') return t._isDisposed
  return false
}

function getMetalReflection(scene: Scene): CubeTexture {
  if (
    metalReflection &&
    metalReflectionSceneUid === scene.uid &&
    !isTextureDisposed(metalReflection)
  ) {
    return metalReflection
  }
  // Dispose stale texture from a previous scene
  if (metalReflection) {
    try { metalReflection.dispose() } catch { /* gone */ }
  }
  metalReflection = CubeTexture.CreateFromPrefilteredData(
    METAL_REFLECTION_URL,
    scene,
  )
  metalReflection.onLoadObservable.addOnce(() => {
    console.log('frameMaterials: Fixed metal reflection cubemap ready')
    // Mark all cached PBR materials dirty so they recompile with the
    // now-ready reflection texture.  Without this, materials that compiled
    // before the cubemap loaded may have stale shader defines (no REFLECTION)
    // causing flat/dull metal appearance.
    for (const [, mat] of cache.entries()) {
      try {
        if (mat instanceof PBRMaterial) {
          mat.markAsDirty(Constants.MATERIAL_TextureDirtyFlag)
        }
      } catch { /* disposed */ }
    }
  })
  metalReflectionSceneUid = scene.uid
  return metalReflection
}

// ─── Aluminum (primary frame material) ───────────────────────────────────────

/**
 * Brushed-aluminum PBR material (metallic 0.92).
 * Suitable for baseplates, uprights, purlins, beams.
 *
 * Uses a fixed CubeTexture for IBL reflections so the metallic look
 * stays consistent across environment presets.  Scene lights are kept
 * enabled for proper illumination brightness.
 *
 * Intensities are tuned per-preset via setFrameMaterialEnvironmentProfile().
 */
export function getAluminumMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-aluminum-frame', scene, (s) => {
    const mat = new PBRMaterial('shared-aluminum-frame', s)
    const profile = INTENSITY_PROFILES[activePreset].aluminum

    // Darker mid-grey aluminum tone. With four scene lights summing to
    // >1.0 illumination, a brighter albedo would saturate sun-facing faces
    // to pure white while shadowed faces stayed grey — making every part
    // look like a different shade. A low albedo + dimmed directIntensity
    // keeps the whole frame in mid-grey range.
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
    mat.useRadianceOverAlpha = true
    mat.useSpecularOverAlpha = true
    mat.enableSpecularAntiAliasing = true
    mat.backFaceCulling = true

    return mat
  })
}

// ─── Steel (heavier structural parts) ────────────────────────────────────────

/**
 * Galvanized-steel PBR material.
 * Suitable for heavier structural connectors and bracing.
 *
 * Now uses the same fixed cubemap as aluminum for consistent reflections.
 */
export function getSteelMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-steel-frame', scene, (s) => {
    const mat = new PBRMaterial('shared-steel-frame', s)
    const profile = INTENSITY_PROFILES[activePreset].steel

    mat.albedoColor = new Color3(0.58, 0.60, 0.63)
    mat.metallic = 0.2
    mat.roughness = 0.5

    // Fixed reflection cubemap — no more dependency on scene.environmentTexture
    mat.reflectionTexture = getMetalReflection(s)

    mat.environmentIntensity = profile.environmentIntensity
    mat.directIntensity = profile.directIntensity
    mat.specularIntensity = profile.specularIntensity

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
 *
 * Now uses the same fixed cubemap for consistent subtle reflections.
 */
export function getDarkMetalMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-dark-metal', scene, (s) => {
    const mat = new PBRMaterial('shared-dark-metal', s)
    const profile = INTENSITY_PROFILES[activePreset].darkMetal

    mat.albedoColor = new Color3(0.15, 0.15, 0.17)
    mat.metallic = 0.1
    mat.roughness = 0.6

    // Fixed reflection cubemap
    mat.reflectionTexture = getMetalReflection(s)

    mat.environmentIntensity = profile.environmentIntensity
    mat.directIntensity = profile.directIntensity
    mat.specularIntensity = profile.specularIntensity

    mat.backFaceCulling = true
    return mat
  })
}

// ─── Matte Aluminum (no reflections, no flicker) ─────────────────────────────

/**
 * Matte-aluminum PBR material — reads as aluminum visually, but is purely
 * diffuse: no IBL reflections, no specular highlights, therefore zero
 * shimmer/flicker on thin geometry and rock-solid appearance at any distance
 * or screen resolution.
 *
 * Use for parts where the reflective look of `getAluminumMaterial()` causes
 * sparkle/flicker artefacts (e.g. very thin tubing, distant detail meshes,
 * or accessory hardware).
 *
 * Implementation notes:
 *  - `metallic = 0` so the surface is a dielectric — albedo drives the colour
 *    instead of relying on environment reflection (a metal with no reflection
 *    map renders nearly black).
 *  - `roughness = 1.0` collapses the specular lobe — no view-dependent
 *    highlight => no temporal aliasing on sub-pixel features.
 *  - `reflectionTexture = null` + `environmentIntensity = 0` removes IBL
 *    contribution entirely; the material is environment-independent by
 *    construction so no per-preset profile is needed.
 *  - `specularIntensity = 0` belt-and-braces against any residual highlight.
 *  - `enableSpecularAntiAliasing = true` is harmless here and protects
 *    against shader recompiles if roughness is later lowered.
 */
export function getMatteAluminumMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-matte-aluminum-frame', scene, (s) => {
    const mat = new PBRMaterial('shared-matte-aluminum-frame', s)

    // Aluminum-toned albedo — slightly brighter than the metallic version
    // because there's no IBL contribution to lift the midtones.
    mat.albedoColor = new Color3(0.82, 0.83, 0.85)

    mat.metallic = 0.0
    mat.roughness = 1.0

    // No environment reflections — fully matte.
    mat.reflectionTexture = null
    mat.environmentIntensity = 0
    mat.specularIntensity = 0
    mat.directIntensity = 1.0

    mat.useRadianceOverAlpha = true
    mat.useSpecularOverAlpha = true
    mat.enableSpecularAntiAliasing = true
    mat.backFaceCulling = true

    return mat
  })
}

// ─── Per-Preset Tuning ───────────────────────────────────────────────────────

/**
 * Adjust material intensities to compensate for each environment preset's
 * different light rig.  Call this BEFORE refreshFrameMaterialCache() when
 * switching environments.
 *
 * This ensures aluminum/steel/dark-metal look the same across all presets.
 */
export function setFrameMaterialEnvironmentProfile(preset: EnvironmentPreset): void {
  activePreset = preset
  const profile = INTENSITY_PROFILES[preset]

  for (const [key, mat] of cache.entries()) {
    if (!(mat instanceof PBRMaterial)) continue

    let p: MaterialIntensityProfile[keyof MaterialIntensityProfile] | null = null
    if (key === 'shared-aluminum-frame') p = profile.aluminum
    else if (key === 'shared-steel-frame') p = profile.steel
    else if (key === 'shared-dark-metal') p = profile.darkMetal

    if (p) {
      mat.directIntensity = p.directIntensity
      mat.specularIntensity = p.specularIntensity
      mat.environmentIntensity = p.environmentIntensity
    }
  }
}

// Re-export the type so call-sites don't need a separate import.
export type { EnvironmentPreset } from '@/lib/constants/sceneConfig'

// ─── Refresh (after environment change) ──────────────────────────────────────

/**
 * Get (or create) a named clone of the aluminum material with custom properties.
 * Cached by name — avoids re-cloning and re-compiling the PBR shader on every
 * effect re-run (bay change, StrictMode remount, etc.).
 *
 * The clone is stored in the same cache as the base materials, so it gets
 * cleaned up by disposeFrameMaterialCache() and refreshed by
 * refreshFrameMaterialCache().
 */
export function getAluminumClone(
  scene: Scene,
  name: string,
  configure?: (mat: PBRMaterial) => void,
): PBRMaterial {
  return getCachedOrCreate(name, scene, (s) => {
    const base = getAluminumMaterial(s)
    const clone = base.clone(name)
    if (configure) configure(clone)
    return clone
  }) as PBRMaterial
}

/**
 * Mark all cached PBR materials dirty after scene env changes (IBL load).
 * Since all metals now use the fixed cubemap, this just ensures shader
 * defines are up-to-date after intensity changes.
 */
export function refreshFrameMaterialCache(): void {
  for (const [, mat] of cache.entries()) {
    try {
      if (mat instanceof PBRMaterial) {
        mat.markAsDirty(Constants.MATERIAL_TextureDirtyFlag)
      }
    } catch { /* disposed */ }
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

/**
 * Dispose all cached frame materials + the fixed reflection texture.
 * Call on scene teardown.
 */
export function disposeFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.dispose() } catch { /* already disposed */ }
  }
  cache.clear()

  if (metalReflection) {
    try { metalReflection.dispose() } catch { /* gone */ }
    metalReflection = null
    metalReflectionSceneUid = null
  }
}