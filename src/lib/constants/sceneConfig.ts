/**
 * Scene Configuration - Centralized constants for 3D scene setup (Babylon.js)
 * Adjust these values to modify ground, sky, lighting, and shadows
 */

import { Color3, Vector3 } from '@babylonjs/core'

// ─── Helper to convert hex to Color3 ─────────────────────────────────────────

function hexToColor3(hex: string): Color3 {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  if (!result) return new Color3(1, 1, 1)
  return new Color3(
    parseInt(result[1], 16) / 255,
    parseInt(result[2], 16) / 255,
    parseInt(result[3], 16) / 255
  )
}

// ─── Sky Preset Type ─────────────────────────────────────────────────────────

export type SkyPreset = 'default' | 'dark' | 'midnight'

export interface SkyGradientColors {
  horizon: Color3
  low: Color3
  mid: Color3
  zenith: Color3
}

// ─── Scene Configuration ─────────────────────────────────────────────────────

export const SCENE_CONFIG = {
  // Ground settings
  ground: {
    size: 600,              // Larger ground so side views don't show edges
    tileRepeat: 150,        // Keep tile scale consistent (size / 4m per texture)
    groutWidthPx: 1,        // Thin grout lines for subtle tile pattern
    roughness: 0.8,
    colors: {
      grout: '#7a7067',     // Gray mortar
      tileBase: '#a94a34',  // Classic red brick
    }
  },

  // Sky dome settings
  sky: {
    diameter: 1200,         // Sky sphere diameter (2x ground size)
    segments: 32,           // Sphere detail level
    
    // Default gradient colors
    gradientColors: {
      horizon: hexToColor3('#c4d4e0'),  // Pale/hazy at horizon
      low: hexToColor3('#87CEEB'),      // Light blue
      mid: hexToColor3('#5BA3D9'),      // Medium blue
      zenith: hexToColor3('#4A90C2'),   // Deeper blue at top
    } as SkyGradientColors,

    // Presets (select via UI dropdown)
    presets: {
      default: {
        horizon: hexToColor3('#c4d4e0'),
        low: hexToColor3('#87CEEB'),
        mid: hexToColor3('#5BA3D9'),
        zenith: hexToColor3('#4A90C2'),
      },
      dark: {
        horizon: hexToColor3('#2A2C38'),
        low: hexToColor3('#2A2C38'),
        mid: hexToColor3('#2A2C38'),
        zenith: hexToColor3('#2A2C38'),
      },
      midnight: {
        horizon: hexToColor3('#10101C'),
        low: hexToColor3('#10101C'),
        mid: hexToColor3('#10101C'),
        zenith: hexToColor3('#10101C'),
      },
    } as Record<SkyPreset, SkyGradientColors>
  },

  // Camera settings (Arc Rotate Camera in Babylon.js)
  camera: {
    fov: 0.8,               // Field of view in radians (~45°)
    minZ: 0.5,              // Near plane
    maxZ: 1000,             // Far plane
    wheelPrecision: 15,     // Zoom sensitivity
    panningSensibility: 100,
    
    desktop: {
      radius: 25,
      target: new Vector3(0, 3, 7.5),
      lowerRadiusLimit: 5,
      upperRadiusLimit: 100,
    },
    mobile: {
      radius: 40,
      target: new Vector3(0, 3, 7.5),
      lowerRadiusLimit: 10,
      upperRadiusLimit: 150,
    },
    
    // Beta limits (vertical rotation)
    lowerBetaLimit: 0.1,
    upperBetaLimit: Math.PI / 2 - 0.1,
  },

  // Lighting settings (Babylon.js equivalents)
  lighting: {
    // Hemispheric light (ambient fill)
    hemispheric: {
      direction: Vector3.Up(),
      intensity: 0.8,
      diffuse: Color3.White(),
      groundColor: new Color3(0.67, 0.67, 0.67),  // #aaaaaa
    },
    
    // Sun (directional light)
    sun: {
      direction: new Vector3(-0.5, -0.87, -0.5).normalize(),  // From (30, 50, 30)
      intensity: 1.5,
      diffuse: Color3.White(),
    },
    
    // Fill light (secondary directional)
    fill: {
      direction: new Vector3(0.5, -0.75, 0.5).normalize(),  // From (-20, 30, -20)
      intensity: 0.8,
      diffuse: Color3.White(),
    },
    
    // Bottom fill light
    bottom: {
      direction: Vector3.Up(),  // Pointing up from below
      intensity: 0.3,
      diffuse: Color3.White(),
    },
  },

  // Shadow settings (Shadow Generator in Babylon.js)
  shadow: {
    mapSize: {
      desktop: 2048,
      mobile: 1024,
    },
    frustum: {
      minZ: 1,
      maxZ: 150,
      orthoLeft: -60,
      orthoRight: 60,
      orthoTop: 60,
      orthoBottom: -60,
    },
    bias: 0.00025,
    normalBias: 0.008,
    blurKernel: 32,
    useBlur: true,
  },

  // Responsive breakpoint
  mobileBreakpoint: 768,
} as const

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Check if current device is mobile
 */
export function isMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < SCENE_CONFIG.mobileBreakpoint
}

/**
 * Get camera config for current device
 */
export function getCameraConfig() {
  return isMobile() ? SCENE_CONFIG.camera.mobile : SCENE_CONFIG.camera.desktop
}

/**
 * Get shadow map size for current device
 */
export function getShadowMapSize(): number {
  return isMobile() ? SCENE_CONFIG.shadow.mapSize.mobile : SCENE_CONFIG.shadow.mapSize.desktop
}

/**
 * Get sky colors for a preset
 */
export function getSkyColors(preset: SkyPreset): SkyGradientColors {
  return SCENE_CONFIG.sky.presets[preset]
}
