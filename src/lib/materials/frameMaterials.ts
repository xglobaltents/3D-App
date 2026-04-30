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
  DynamicTexture,
  Texture,
  type Material,
  type BaseTexture,
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
    aluminum:  { directIntensity: 1.0,  environmentIntensity: 1.1, specularIntensity: 1.0 },
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

// ─── Brushed-Aluminum Micro-Detail (procedural normal + roughness) ───────────
// A high-frequency anisotropic streak texture generated once at 1024×1024.
// This is the difference between "metallic blob" and "real brushed aluminum":
// the per-pixel normal perturbation gives the surface true micro-detail that
// holds up at any zoom level, and the roughness modulation breaks up the
// otherwise uniform specular highlight (the main cause of the "low-res" look).
//
// Generated in-engine so there's no texture asset to load and it can't be
// downscaled by the build pipeline.

interface BrushedTextures {
  bump: DynamicTexture
  roughness: DynamicTexture
}

let brushedTextures: BrushedTextures | null = null
let brushedSceneUid: string | null = null

const BRUSHED_TEX_SIZE = 1024
// World-space tiling: 1 repeat per N metres along the bay direction.
// Tighter values = finer brush lines; we want them visible but not buzzy.
const BRUSHED_TILING_U = 8
const BRUSHED_TILING_V = 1

function isBaseTextureDisposed(tex: BaseTexture): boolean {
  const t = tex as unknown as Record<string, unknown>
  if (typeof t.isDisposed === 'function') return (t.isDisposed as () => boolean)()
  if (typeof t.isDisposed === 'boolean') return t.isDisposed
  if (typeof t._isDisposed === 'boolean') return t._isDisposed
  return false
}

/**
 * Build the brushed-aluminum normal + roughness textures (once per scene).
 *
 * Algorithm:
 *  1. Fill a height field with thin horizontal streaks of varying intensity
 *     (anisotropic 1-D noise — the hallmark of a brushed/extruded finish).
 *  2. Convert the height field to a tangent-space normal map via central
 *     differences. RG = XY normal, B = up (Z), encoded to [0..255].
 *  3. Map the same height field to a roughness modulation around the base
 *     value — brushed metal alternates micro-rough lines with smoother
 *     valleys, which creates the streaky anisotropic highlight.
 */
function getBrushedTextures(scene: Scene): BrushedTextures {
  if (
    brushedTextures &&
    brushedSceneUid === scene.uid &&
    !isBaseTextureDisposed(brushedTextures.bump) &&
    !isBaseTextureDisposed(brushedTextures.roughness)
  ) {
    return brushedTextures
  }
  if (brushedTextures) {
    try { brushedTextures.bump.dispose() } catch { /* gone */ }
    try { brushedTextures.roughness.dispose() } catch { /* gone */ }
  }

  const size = BRUSHED_TEX_SIZE
  // Height field: for each row, a constant intensity (so brush lines run
  // horizontally), with two scales of 1-D value noise added together.
  const heights = new Float32Array(size)
  // Coarse + fine noise for natural variation
  for (let y = 0; y < size; y++) {
    const coarse = Math.sin(y * 0.07) * 0.35 + Math.sin(y * 0.013 + 1.7) * 0.2
    const fine   = Math.sin(y * 0.91 + 0.5) * 0.18 + Math.sin(y * 1.73) * 0.12
    // Sparse "deeper scratch" lines
    const scratch = (y % 31 === 0) ? -0.4 : (y % 17 === 0 ? 0.25 : 0)
    heights[y] = coarse + fine + scratch
  }
  // Add a small per-pixel jitter along U so each row isn't perfectly flat —
  // breaks visible banding without disturbing the anisotropic look.
  function heightAt(x: number, y: number): number {
    const yi = ((y % size) + size) % size
    const h = heights[yi]
    const jitter = Math.sin(x * 6.28 + yi * 0.3) * 0.04
    return h + jitter
  }

  // ── Normal map (RGBA8) ──
  const bump = new DynamicTexture(
    'brushed-aluminum-normal',
    { width: size, height: size },
    scene,
    true, // generate mipmaps
    Texture.TRILINEAR_SAMPLINGMODE,
  )
  bump.hasAlpha = false
  const bumpCtx = bump.getContext() as CanvasRenderingContext2D
  const bumpImg = bumpCtx.createImageData(size, size)
  const strength = 4.0 // tangent-vector strength
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Central differences on the height field
      const hL = heightAt(x - 1, y)
      const hR = heightAt(x + 1, y)
      const hU = heightAt(x, y - 1)
      const hD = heightAt(x, y + 1)
      const dx = (hR - hL) * strength
      const dy = (hD - hU) * strength
      const dz = 1.0
      const len = Math.hypot(dx, dy, dz)
      const nx = dx / len
      const ny = dy / len
      const nz = dz / len
      const idx = (y * size + x) * 4
      bumpImg.data[idx + 0] = Math.round((nx * 0.5 + 0.5) * 255)
      bumpImg.data[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      bumpImg.data[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      bumpImg.data[idx + 3] = 255
    }
  }
  bumpCtx.putImageData(bumpImg, 0, 0)
  bump.update(false)
  bump.wrapU = Texture.WRAP_ADDRESSMODE
  bump.wrapV = Texture.WRAP_ADDRESSMODE
  bump.anisotropicFilteringLevel = 16

  // ── Roughness modulation (RGBA8, grayscale) ──
  // Stored in green channel for use as metallicTexture (PBR convention:
  // R=ambient occlusion, G=roughness, B=metallic) so it modulates roughness
  // without disturbing albedo or metallic.
  const rough = new DynamicTexture(
    'brushed-aluminum-roughness',
    { width: size, height: size },
    scene,
    true,
    Texture.TRILINEAR_SAMPLINGMODE,
  )
  rough.hasAlpha = false
  const roughCtx = rough.getContext() as CanvasRenderingContext2D
  const roughImg = roughCtx.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const h = heightAt(x, y)
      // Map height [-1..1] to roughness multiplier [0.55..1.0] in green.
      // useRoughnessFromMetallicTextureGreen multiplies this with the base
      // roughness, so peaks reflect sharper, valleys are dustier — the
      // hallmark of brushed metal.
      const m = 0.55 + (h * 0.5 + 0.5) * 0.45
      const v = Math.max(0, Math.min(255, Math.round(m * 255)))
      const idx = (y * size + x) * 4
      roughImg.data[idx + 0] = 255 // R: AO = 1 (no occlusion)
      roughImg.data[idx + 1] = v   // G: roughness modulator
      roughImg.data[idx + 2] = 255 // B: metallic = 1 (preserves metallic)
      roughImg.data[idx + 3] = 255
    }
  }
  roughCtx.putImageData(roughImg, 0, 0)
  rough.update(false)
  rough.wrapU = Texture.WRAP_ADDRESSMODE
  rough.wrapV = Texture.WRAP_ADDRESSMODE
  rough.anisotropicFilteringLevel = 16

  brushedTextures = { bump, roughness: rough }
  brushedSceneUid = scene.uid
  return brushedTextures
}



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

    // Cool-neutral aluminum tint. Slight blue bias counter-balances the
    // warm sun light (1.0, 0.98, 0.95) and prevents the warm IBL bounce
    // (terracotta ground) from making the metal look orange/red.
    // Real anodized aluminum F0 ≈ (0.91, 0.92, 0.93) — neutral-cool.
    mat.albedoColor = new Color3(0.86, 0.88, 0.92)
    mat.metallic = 0.85
    // Slightly higher roughness softens the specular hotspot so warm
    // sun + warm ground reflections don't pop as orange peaks. Brushed
    // roughness map still modulates this per-pixel for the streaky look.
    mat.roughness = 0.32

    // Reflection tinted slightly cool to neutralize warm scene content
    // bouncing into the metal (the main source of the red/orange cast).
    const refl = getMetalReflection(s)
    refl.anisotropicFilteringLevel = 16
    mat.reflectionTexture = refl
    mat.reflectionColor = new Color3(0.92, 0.95, 1.0)

    // ── Brushed-aluminum micro-detail ──
    const { bump, roughness: roughTex } = getBrushedTextures(s)
    mat.bumpTexture = bump
    // Only use the GREEN channel (roughness modulation). Disabling the
    // metallic + AO channels means `mat.metallic` (0.85) is the actual
    // metallic value — previously the texture's blue=255 was forcing
    // metallic to 1.0 per-pixel, making the spec hotspot extra hungry
    // for warm light and visibly red.
    mat.metallicTexture = roughTex
    mat.useRoughnessFromMetallicTextureGreen = true
    mat.useMetallnessFromMetallicTextureBlue = false
    mat.useAmbientOcclusionFromMetallicTextureRed = false
    mat.bumpTexture.level = 0.3
    mat.invertNormalMapX = false
    mat.invertNormalMapY = false

    bump.uScale = BRUSHED_TILING_U
    bump.vScale = BRUSHED_TILING_V
    roughTex.uScale = BRUSHED_TILING_U
    roughTex.vScale = BRUSHED_TILING_V

    // Slightly trim direct-light intensity to dial the warm-sun spec
    // contribution back without darkening the diffuse read.
    mat.environmentIntensity = profile.environmentIntensity
    mat.directIntensity = profile.directIntensity * 0.85
    mat.specularIntensity = profile.specularIntensity * 0.8

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

  if (brushedTextures) {
    try { brushedTextures.bump.dispose() } catch { /* gone */ }
    try { brushedTextures.roughness.dispose() } catch { /* gone */ }
    brushedTextures = null
    brushedSceneUid = null
  }
}