/**
 * Scene Configuration - Centralized constants for 3D scene setup (Babylon.js)
 *
 * Single environment mode:
 *   - default  → Sky dome + terracotta tile ground + 4-light rig + ACES tone mapping
 *
 * @see docs/environment-settings.md
 */

import { Color3, Vector3 } from '@babylonjs/core'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hexToColor3(hex: string): Color3 {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!r) return new Color3(1, 1, 1)
  return new Color3(
    parseInt(r[1], 16) / 255,
    parseInt(r[2], 16) / 255,
    parseInt(r[3], 16) / 255
  )
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type EnvironmentPreset = 'default'
export type ScenePerformanceTier = 'standard' | 'large-tent'

export interface SkyGradientColors {
  horizon: Color3
  low: Color3
  mid: Color3
  zenith: Color3
}

// ─── Scene Configuration ─────────────────────────────────────────────────────

export const SCENE_CONFIG = {

  // ══════════════════════════════════════════════════════════════════════════
  //  DEFAULT PRESET — Sky dome + terracotta ground + 4-light rig
  // ══════════════════════════════════════════════════════════════════════════

  sky: {
    // When `useIBLSkybox` is true the gradient sky-dome is replaced by a
    // skybox built from the scene's IBL cubemap (outdoor.env). This makes
    // the visible sky match the reflections in PBR materials. Default off
    // because the procedural gradient is brand-tuned and lighter weight.
    useIBLSkybox: false,
    iblSkyboxSize: 1000,
    iblSkyboxBlur: 0.0,
    radius: 600,
    segments: 32,
    gradientColors: {
      horizon: hexToColor3('#dce8f0'),
      low: hexToColor3('#8ED4F0'),
      mid: hexToColor3('#64BDE8'),
      zenith: hexToColor3('#4AA8D8'),
    } as SkyGradientColors,
  },

  defaultGround: {
    size: 600,
    tileRepeat: 150,
    texSize: 1024,
    groutWidthPx: 1,
    roughness: 0.95,
    metallic: 0,
    colors: {
      grout: '#8a5545',
      tileBase: { r: 145, g: 78, b: 62 },  // Terracotta
    },
  },

  defaultLighting: {
    hemispheric: {
      direction: new Vector3(0, 1, 0),
      skyColor: Color3.White(),
      groundColor: new Color3(0.67, 0.67, 0.67),
      intensity: 0.8,
      specular: new Color3(0.3, 0.3, 0.3),  // helps PBR catch highlights without IBL
    },
    sun: {
      color: new Color3(1.0, 0.98, 0.95),   // slightly warm
      intensity: 1.5,
      position: new Vector3(30, 50, 30),
      direction: new Vector3(-30, -50, -30).normalize(),
      // Neutral white specular: warm-tinted specular (0.95 blue) clips into
      // orange/red on saturated metal hotspots after ACES tone mapping.
      specular: new Color3(1.0, 1.0, 1.0),
    },
    fill: {
      color: new Color3(0.9, 0.92, 1.0),    // slightly cool for contrast
      intensity: 0.8,
      position: new Vector3(-20, 30, -20),
      direction: new Vector3(20, -30, 20).normalize(),
      specular: new Color3(0.5, 0.52, 0.55), // mild specular from fill
    },
    bottom: {
      color: Color3.White(),
      intensity: 0.3,
      direction: new Vector3(0, 1, 0),
    },
  },

  defaultShadow: {
    blurKernel: 32,
    bias: -0.00025,
    normalBias: 0.008,
    darkness: 0.35,          // was 0.4 — slightly lighter shadows
  },

  defaultImageProcessing: {
    toneMappingEnabled: true,
    toneMappingType: 1,   // ACES
    exposure: 1.0,
    contrast: 1.08,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  POST-PROCESSING — DefaultRenderingPipeline + TAA + SSAO2 (per preset)
  // ══════════════════════════════════════════════════════════════════════════
  // Tunables for src/lib/utils/postProcessing.ts. Tone mapping values mirror
  // the per-preset image-processing settings so the active pipeline owns
  // the final colour transform (scene.imageProcessingConfiguration is left
  // untouched at defaults).

  postProcessing: {
    default: {
      tone: { enabled: true, type: 1, exposure: 1.0, contrast: 1.08 },
      sharpen: { enabled: true, edgeAmount: 0.5, colorAmount: 1.0 },
      bloom: { enabled: true, threshold: 1.2, weight: 0.10, kernel: 64, scale: 0.5 },
      taa:  { enabled: true, samples: 8,  factor: 0.85 },
      // SSAO2 + TAA: gated to WebGL only in postProcessing.ts. WebGPU
      // (HDR + rgba16float) trips a binding-resource conflict upstream.
      ssao: { enabled: false, ssaoRatio: 0.5, blurRatio: 1.0, totalStrength: 1.0,
              samples: 16, maxZ: 60, minZAspect: 0.5, radius: 1.0, expensiveBlur: true },
    },
  },

  environment: {
    iblUrl: '/environments/outdoor.env',
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  SHARED — Camera, shadow map size, exports
  // ══════════════════════════════════════════════════════════════════════════

  camera: {
    fov: 50 * (Math.PI / 180),
    minZ: 0.5,
    maxZ: 1000,
    wheelPrecision: 15,
    panningSensibility: 100,

    desktop: {
      position: new Vector3(15, 8, -12),
      radius: 25,
      target: new Vector3(0, 3, 7.5),
      lowerRadiusLimit: 5,
      upperRadiusLimit: 100,
    },
    mobile: {
      position: new Vector3(25, 12, -20),
      radius: 40,
      target: new Vector3(0, 3, 7.5),
      lowerRadiusLimit: 10,
      upperRadiusLimit: 150,
    },

    lowerBetaLimit: 0.3,
    // Allow the camera to dip below the target so users can look upward
    // from inside the tent. SceneSetup applies a dynamic ground-safe clamp.
    upperBetaLimit: Math.PI - 0.1,

    // Inertia & damping (#4)
    inertia: 0.85,
    panningInertia: 0.85,
    pinchPrecision: 50,
    angularSensibilityX: 500,
    angularSensibilityY: 500,
  },

  shadowMapSize: {
    desktop: 2048,
    mobile: 1024,
  },

  exportPresets: {
    standard: { width: 1920, height: 1080, pixelRatio: 2 },
    high: { width: 2560, height: 1440, pixelRatio: 2 },
    ultra: { width: 3840, height: 2160, pixelRatio: 2 },
    print: { width: 4096, height: 2732, pixelRatio: 3 },
  },

  mobileBreakpoint: 768,
} as const

// ─── Utility Functions ───────────────────────────────────────────────────────

export function isMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < SCENE_CONFIG.mobileBreakpoint
}

export function getCameraConfig() {
  return isMobile() ? SCENE_CONFIG.camera.mobile : SCENE_CONFIG.camera.desktop
}

export function getShadowMapSize(): number {
  return isMobile() ? SCENE_CONFIG.shadowMapSize.mobile : SCENE_CONFIG.shadowMapSize.desktop
}

/**
 * Compute reactive camera target and radius based on tent dimensions.
 * Target centers on the tent vertically; radius ensures full visibility.
 */
export function getReactiveCameraConfig(numBays: number, eaveHeight: number, bayDistance: number) {
  const tentLength = numBays * bayDistance
  const base = isMobile() ? SCENE_CONFIG.camera.mobile : SCENE_CONFIG.camera.desktop
  return {
    ...base,
    target: new Vector3(0, eaveHeight * 0.6, 0),
    radius: Math.max(base.radius, tentLength * 0.5 + 10),
    upperRadiusLimit: Math.max(base.upperRadiusLimit, tentLength * 1.5),
  }
}

export function getScenePerformanceTier(tentWidth: number, tentLength: number): ScenePerformanceTier {
  const footprint = tentWidth * tentLength

  if (tentWidth >= 40 || tentLength >= 20 || footprint >= 500) {
    return 'large-tent'
  }

  return 'standard'
}
