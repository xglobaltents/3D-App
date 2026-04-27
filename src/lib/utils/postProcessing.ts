/**
 * Post-Processing Pipeline
 *
 * Wraps Babylon's DefaultRenderingPipeline with optional TAA + SSAO2,
 * tunable per environment preset via SCENE_CONFIG.postProcessing.
 *
 * Why a single helper:
 *   - Keeps tone-mapping, sharpen, bloom, AA, and ambient occlusion in
 *     one place (was scattered across two scene-setup helpers).
 *   - TAA replaces the legacy "no FXAA" decision — it gives proper edge
 *     AA without flattening the brushed-aluminum specular highlights.
 *   - SSAO2 adds soft contact shadows that the directional shadow map misses
 *     (under baseplates, gable supports, connector clusters).
 *
 * WebGPU compatibility:
 *   - DefaultRenderingPipeline + Bloom + Sharpen: fully supported.
 *   - TAA: requires float-render textures; gated on engine caps.
 *   - SSAO2: requires depth renderer (auto-attached) + float textures;
 *     also gated on engine caps.
 *
 * Discipline:
 *   - Pipelines outlive cameras only as long as the scene; always dispose
 *     in reverse-creation order on cleanup.
 *   - Switching environment preset disposes + rebuilds the pipeline.
 */

import {
  type Scene,
  type Camera,
  DefaultRenderingPipeline,
  TAARenderingPipeline,
  SSAO2RenderingPipeline,
} from '@babylonjs/core'
import { SCENE_CONFIG, isMobile, type EnvironmentPreset } from '@/lib/constants/sceneConfig'

export interface PostProcessingHandle {
  dispose(): void
}

export function setupPostProcessingPipeline(
  scene: Scene,
  camera: Camera,
  preset: EnvironmentPreset,
): PostProcessingHandle {
  const cfg = SCENE_CONFIG.postProcessing[preset]
  const engine = scene.getEngine()
  const caps = engine.getCaps()
  const supportsFloatRT = !!caps.textureFloatRender || !!caps.textureHalfFloatRender

  // WebGPU + DefaultRenderingPipeline (HDR) currently crashes on TAA/SSAO2/SSR
  // due to Babylon's `rgba16float` ping-pong target being read+written in the
  // same scope (binding-resource conflict). Until that's resolved upstream,
  // these post-FX run only on WebGL where they're battle-tested.
  // Track: https://github.com/BabylonJS/Babylon.js (search "rgba16float TAA")
  const isWebGPU = engine.name === 'WebGPU'

  // ── Default pipeline (HDR enabled so tone mapping works correctly) ──
  const pipeline = new DefaultRenderingPipeline('default-pipeline', true, scene, [camera])

  // MSAA on the pipeline's HDR render targets (back-buffer antialias flag
  // does not propagate). Combined with TAA this kills the sub-pixel
  // specular shimmer on thin frame tubing. FXAA is intentionally OFF —
  // it blurs over MSAA edges and softens distant tubing.
  pipeline.samples = isMobile() ? 2 : 4
  pipeline.fxaaEnabled = false

  // Tone mapping moves from scene.imageProcessingConfiguration into the pipeline
  pipeline.imageProcessingEnabled = true
  pipeline.imageProcessing.toneMappingEnabled = cfg.tone.enabled
  pipeline.imageProcessing.toneMappingType = cfg.tone.type
  pipeline.imageProcessing.exposure = cfg.tone.exposure
  pipeline.imageProcessing.contrast = cfg.tone.contrast

  // Sharpen — recovers crispness lost by HDR resolve / TAA blend
  pipeline.sharpenEnabled = cfg.sharpen.enabled
  if (cfg.sharpen.enabled) {
    pipeline.sharpen.edgeAmount = cfg.sharpen.edgeAmount
    pipeline.sharpen.colorAmount = cfg.sharpen.colorAmount
  }

  // Bloom — subtle highlight glow on metal hotspots
  pipeline.bloomEnabled = cfg.bloom.enabled
  if (cfg.bloom.enabled) {
    pipeline.bloomThreshold = cfg.bloom.threshold
    pipeline.bloomWeight = cfg.bloom.weight
    pipeline.bloomKernel = cfg.bloom.kernel
    pipeline.bloomScale = cfg.bloom.scale
  }

  // ── TAA — temporal anti-aliasing (preserves specular detail) ──
  let taa: TAARenderingPipeline | null = null
  if (cfg.taa.enabled && supportsFloatRT && !isWebGPU) {
    try {
      taa = new TAARenderingPipeline('taa', scene, [camera])
      taa.samples = cfg.taa.samples
      taa.factor = cfg.taa.factor
    } catch (err) {
      console.warn('[postProcessing] TAA init failed:', err)
      taa = null
    }
  } else if (cfg.taa.enabled && isWebGPU) {
    console.info('[postProcessing] TAA skipped on WebGPU (HDR pipeline conflict)')
  } else if (cfg.taa.enabled) {
    console.warn('[postProcessing] TAA skipped — engine lacks float render targets')
  }

  // ── SSAO2 — screen-space ambient occlusion ──
  let ssao: SSAO2RenderingPipeline | null = null
  if (cfg.ssao.enabled && supportsFloatRT && !isWebGPU) {
    try {
      ssao = new SSAO2RenderingPipeline('ssao', scene, {
        ssaoRatio: cfg.ssao.ssaoRatio,
        blurRatio: cfg.ssao.blurRatio,
      }, [camera])
      ssao.totalStrength = cfg.ssao.totalStrength
      ssao.samples = cfg.ssao.samples
      ssao.maxZ = cfg.ssao.maxZ
      ssao.minZAspect = cfg.ssao.minZAspect
      ssao.radius = cfg.ssao.radius
      ssao.expensiveBlur = cfg.ssao.expensiveBlur
    } catch (err) {
      console.warn('[postProcessing] SSAO2 init failed:', err)
      ssao = null
    }
  } else if (cfg.ssao.enabled && isWebGPU) {
    console.info('[postProcessing] SSAO2 skipped on WebGPU (HDR pipeline conflict)')
  } else if (cfg.ssao.enabled) {
    console.warn('[postProcessing] SSAO2 skipped — engine lacks float render targets')
  }

  return {
    dispose() {
      // Dispose in reverse-creation order so each pipeline detaches cleanly
      try { ssao?.dispose() } catch { /* already gone */ }
      try { taa?.dispose() } catch { /* already gone */ }
      try { pipeline.dispose() } catch { /* already gone */ }
    },
  }
}
