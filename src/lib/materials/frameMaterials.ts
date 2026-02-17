/**
 * Shared Frame Materials — Centralized PBR materials for tent frame parts.
 *
 * Aluminum uses PBRMaterial with high metallic (0.92) for realistic
 * reflective aluminum.  To make it environment-independent, the material
 * gets its own FIXED reflection cubemap that never changes when the user
 * switches environment presets.  Scene.environmentTexture is ignored.
 *
 * Materials are NOT frozen — freezing causes stale GPU pipeline state on
 * WebGPU when meshes are disposed + re-created (bay change).
 *
 * Usage:
 *   import { getAluminumMaterial } from '@lib/materials/frameMaterials'
 *   mesh.material = getAluminumMaterial(scene)
 */

import { type Scene, PBRMaterial, Color3, Constants, CubeTexture, type Material } from '@babylonjs/core'
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

// ─── Fixed Reflection for Aluminum ───────────────────────────────────────────
// A dedicated CubeTexture that never changes with env preset switches.
// PBRMaterial.reflectionTexture overrides scene.environmentTexture when set.

const ALUMINUM_REFLECTION_URL = '/environments/outdoor.env'
let aluminumReflection: CubeTexture | null = null
let aluminumReflectionSceneUid: string | null = null

function getAluminumReflection(scene: Scene): CubeTexture {
  if (
    aluminumReflection &&
    aluminumReflectionSceneUid === scene.uid &&
    !aluminumReflection.isDisposed()
  ) {
    return aluminumReflection
  }
  // Dispose stale texture from a previous scene
  if (aluminumReflection) {
    try { aluminumReflection.dispose() } catch { /* gone */ }
  }
  aluminumReflection = CubeTexture.CreateFromPrefilteredData(
    ALUMINUM_REFLECTION_URL,
    scene
  )
  aluminumReflectionSceneUid = scene.uid
  return aluminumReflection
}

// ─── Aluminum (primary frame material) ───────────────────────────────────────

/**
 * Brushed-aluminum PBR material (metallic 0.92).
 * Suitable for baseplates, uprights, purlins, beams.
 *
 * Uses its own fixed CubeTexture for reflections so it looks identical
 * regardless of which environment preset is active.
 */
export function getAluminumMaterial(scene: Scene): PBRMaterial {
  return getCachedOrCreate('shared-aluminum-frame', scene, (s) => {
    const mat = new PBRMaterial('shared-aluminum-frame', s)

    mat.albedoColor = new Color3(0.62, 0.64, 0.66)
    mat.metallic = 0.92
    mat.roughness = 0.42
    mat.microSurface = 0.58

    // Fixed reflection cubemap — immune to scene env switches
    mat.reflectionTexture = getAluminumReflection(s)
    mat.environmentIntensity = 0.55
    mat.directIntensity = 0.95
    mat.specularIntensity = 0.45

    mat.useRadianceOverAlpha = true
    mat.useSpecularOverAlpha = true
    mat.enableSpecularAntiAliasing = true
    mat.backFaceCulling = true

    return mat
  })
}

/**
 * No-op — aluminum uses its own fixed reflection, not scene env.
 * Kept for API compatibility with SceneSetup callers.
 */
export function setFrameMaterialEnvironmentProfile(_preset: EnvironmentPreset): void {
  // Nothing to do. Aluminum has its own cubemap.
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
 * Mark PBR materials dirty after scene env changes (IBL load).
 * Aluminum is unaffected (has its own cubemap), but steel/dark-metal need it.
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
 * Dispose all cached frame materials + the fixed reflection texture.
 * Call on scene teardown.
 */
export function disposeFrameMaterialCache(): void {
  for (const mat of cache.values()) {
    try { mat.dispose() } catch { /* already disposed */ }
  }
  cache.clear()

  if (aluminumReflection) {
    try { aluminumReflection.dispose() } catch { /* gone */ }
    aluminumReflection = null
    aluminumReflectionSceneUid = null
  }
}
