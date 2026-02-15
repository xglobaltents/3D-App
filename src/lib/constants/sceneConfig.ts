/**
 * Scene Configuration - Centralized constants for 3D scene setup (Babylon.js)
 *
 * Three environment modes:
 *   - default  → Sky dome + terracotta tile ground + 4-light rig + ACES tone mapping
 *   - white    → White studio: PBR ground + grid + fog + IBL + 2-light rig
 *   - black    → Black studio: same structure, dark colours
 *
 * @see docs/environment-settings.md
 */

import { Color3, Color4, Vector3 } from '@babylonjs/core'

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

export type EnvironmentPreset = 'default' | 'white' | 'black'

export interface SkyGradientColors {
  horizon: Color3
  low: Color3
  mid: Color3
  zenith: Color3
}

export interface StudioPresetColors {
  clearColor: Color4
  groundAlbedo: Color3
  groundEnvironmentIntensity: number
  gridMainColor: Color3
  gridLineColor: Color3
  gridOpacity: number
  hemiIntensity: number
  hemiDiffuse: Color3
  hemiGroundColor: Color3
  dirIntensity: number
  environmentIntensity: number
}

// ─── Scene Configuration ─────────────────────────────────────────────────────

export const SCENE_CONFIG = {

  // ══════════════════════════════════════════════════════════════════════════
  //  DEFAULT PRESET — Sky dome + terracotta ground + 4-light rig
  // ══════════════════════════════════════════════════════════════════════════

  sky: {
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
    },
    sun: {
      color: Color3.White(),
      intensity: 1.15,
      position: new Vector3(30, 50, 30),
      direction: new Vector3(-30, -50, -30).normalize(),
    },
    fill: {
      color: Color3.White(),
      intensity: 0.6,
      position: new Vector3(-20, 30, -20),
      direction: new Vector3(20, -30, 20).normalize(),
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
    darkness: 0.4,
  },

  defaultImageProcessing: {
    toneMappingEnabled: true,
    toneMappingType: 1,   // ACES
    exposure: 1.1,
    contrast: 1.05,
  },

  // ══════════════════════════════════════════════════════════════════════════
  //  STUDIO PRESETS — PBR ground + grid + fog + IBL + 2-light rig
  // ══════════════════════════════════════════════════════════════════════════

  studioGround: {
    size: 200,
    subdivisions: 1,
    metallic: 0.0,
    roughness: 0.9,
  },

  grid: {
    size: 200,
    subdivisions: 1,
    yOffset: 0.001,
    majorUnitFrequency: 10,
    minorUnitVisibility: 0.3,
    gridRatio: 1,
  },

  environment: {
    iblUrl: '/environments/environmentSpecular.env',
  },

  studioLighting: {
    hemispheric: {
      direction: new Vector3(0, 1, 0),
      specular: new Color3(0.1, 0.1, 0.1),
    },
    directional: {
      direction: new Vector3(-1, -2, -1).normalize(),
      position: new Vector3(50, 100, 50),
    },
  },

  studioShadow: {
    blurKernel: 16,
    darkness: 0.3,
  },

  studioPresets: {
    white: {
      clearColor: new Color4(0.95, 0.95, 0.95, 1.0),
      groundAlbedo: new Color3(0.85, 0.85, 0.85),
      groundEnvironmentIntensity: 0.4,
      gridMainColor: new Color3(0.85, 0.85, 0.85),
      gridLineColor: new Color3(0.7, 0.7, 0.7),
      gridOpacity: 0.6,
      hemiIntensity: 0.6,
      hemiDiffuse: new Color3(1, 1, 1),
      hemiGroundColor: new Color3(0.4, 0.4, 0.4),
      dirIntensity: 0.8,
      environmentIntensity: 0.5,
    },
    black: {
      clearColor: new Color4(0.06, 0.06, 0.08, 1.0),
      groundAlbedo: new Color3(0.10, 0.10, 0.12),
      groundEnvironmentIntensity: 0.15,
      gridMainColor: new Color3(0.10, 0.10, 0.12),
      gridLineColor: new Color3(0.20, 0.20, 0.22),
      gridOpacity: 0.35,
      hemiIntensity: 0.2,
      hemiDiffuse: new Color3(0.5, 0.5, 0.6),
      hemiGroundColor: new Color3(0.08, 0.08, 0.10),
      dirIntensity: 0.4,
      environmentIntensity: 0.2,
    },
  } as Record<'white' | 'black', StudioPresetColors>,

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
    upperBetaLimit: Math.PI / 2 - 0.1,

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

export function getStudioPresetColors(preset: 'white' | 'black'): StudioPresetColors {
  return SCENE_CONFIG.studioPresets[preset]
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
