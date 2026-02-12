import { type FC, useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import {
  CubeTexture,
  DirectionalLight,
  DynamicTexture,
  Effect,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  Scene as BScene,
  ShadowGenerator,
  ShaderMaterial,
  Texture,
} from '@babylonjs/core'
import { GridMaterial } from '@babylonjs/materials'
import {
  SCENE_CONFIG,
  getCameraConfig,
  getShadowMapSize,
  getStudioPresetColors,
  type EnvironmentPreset,
} from '../lib/constants/sceneConfig'
import { disposeFrameMaterialCache } from '../lib/materials/frameMaterials'
import { disposeCoverMaterialCache } from '../lib/materials/coverMaterials'

// ─── Re-export types ─────────────────────────────────────────────────────────

export type { EnvironmentPreset }

interface SceneSetupProps {
  environmentPreset?: EnvironmentPreset
}

// ─── Sky Gradient Shader (default preset) ────────────────────────────────────
// Registered once at module level to avoid re-registration on preset switches.

const SKY_VERTEX = `
  precision highp float;
  attribute vec3 position;
  uniform mat4 worldViewProjection;
  varying float vY;
  void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vY = normalize(position).y;
  }
`

const SKY_FRAGMENT = `
  precision highp float;
  uniform vec3 horizonColor;
  uniform vec3 lowColor;
  uniform vec3 midColor;
  uniform vec3 zenithColor;
  varying float vY;
  void main() {
    float y = clamp(vY, 0.0, 1.0);
    vec3 color;
    if (y < 0.15) {
      color = mix(horizonColor, lowColor, y / 0.15);
    } else if (y < 0.5) {
      color = mix(lowColor, midColor, (y - 0.15) / 0.35);
    } else {
      color = mix(midColor, zenithColor, (y - 0.5) / 0.5);
    }
    gl_FragColor = vec4(color, 1.0);
  }
`

Effect.ShadersStore['skyGradientVertexShader'] = SKY_VERTEX
Effect.ShadersStore['skyGradientFragmentShader'] = SKY_FRAGMENT

// ─── Disposable interface ────────────────────────────────────────────────────

interface Disposable { dispose(): void }

// ─── Default Environment: sky dome + terracotta ground + 4-light rig ─────────

function setupDefaultEnvironment(scene: BScene): Disposable {
  const {
    sky, defaultGround, defaultLighting, defaultShadow, defaultImageProcessing,
    environment,
  } = SCENE_CONFIG
  const mapSize = getShadowMapSize()

  // ── Sky shader ──
  const skyDome = MeshBuilder.CreateSphere('sky-dome', {
    diameter: sky.radius * 2,
    segments: sky.segments,
    sideOrientation: 2,
  }, scene)
  skyDome.isPickable = false
  skyDome.infiniteDistance = true
  skyDome.renderingGroupId = 0

  const skyMat = new ShaderMaterial('sky-mat', scene, {
    vertex: 'skyGradient',
    fragment: 'skyGradient',
  }, {
    attributes: ['position'],
    uniforms: ['worldViewProjection', 'horizonColor', 'lowColor', 'midColor', 'zenithColor'],
  })
  skyMat.backFaceCulling = false
  const gc = sky.gradientColors
  skyMat.setColor3('horizonColor', gc.horizon)
  skyMat.setColor3('lowColor', gc.low)
  skyMat.setColor3('midColor', gc.mid)
  skyMat.setColor3('zenithColor', gc.zenith)
  skyDome.material = skyMat

  // ── Terracotta tile ground (multi-tile with colour variation) ──
  const tilesPerSide = 8          // 8×8 tile grid in texture
  const texSize = 512
  const grout = defaultGround.groutWidthPx * 2 // thicker grout at higher res
  const cellSize = texSize / tilesPerSide
  const groundTex = new DynamicTexture('ground-tile-tex', texSize, scene, false)
  const ctx = groundTex.getContext()

  // Fill grout as background
  ctx.fillStyle = defaultGround.colors.grout
  ctx.fillRect(0, 0, texSize, texSize)

  // Paint each tile with subtle random colour variation
  const { r, g, b } = defaultGround.colors.tileBase
  for (let row = 0; row < tilesPerSide; row++) {
    for (let col = 0; col < tilesPerSide; col++) {
      const vary = Math.floor(Math.random() * 20) - 10 // ±10
      const tr = Math.min(255, Math.max(0, r + vary))
      const tg = Math.min(255, Math.max(0, g + vary * 0.7))
      const tb = Math.min(255, Math.max(0, b + vary * 0.5))
      ctx.fillStyle = `rgb(${tr},${tg},${tb})`
      const x = col * cellSize + grout
      const y = row * cellSize + grout
      ctx.fillRect(x, y, cellSize - grout * 2, cellSize - grout * 2)
    }
  }
  groundTex.update()
  groundTex.wrapU = Texture.WRAP_ADDRESSMODE
  groundTex.wrapV = Texture.WRAP_ADDRESSMODE
  groundTex.anisotropicFilteringLevel = 16 // sharpen at oblique angles
  // Repeat count adjusted: each texture tile covers 8 tiles, so fewer repeats
  groundTex.uScale = defaultGround.tileRepeat / tilesPerSide
  groundTex.vScale = defaultGround.tileRepeat / tilesPerSide

  const groundMesh = MeshBuilder.CreateGround('ground', {
    width: defaultGround.size,
    height: defaultGround.size,
    subdivisions: 1,
  }, scene)

  const groundMat = new PBRMaterial('ground-mat', scene)
  groundMat.albedoTexture = groundTex
  groundMat.roughness = 0.8
  groundMat.metallic = defaultGround.metallic
  groundMat.environmentIntensity = 0.15
  groundMat.freeze()
  groundMesh.material = groundMat
  groundMesh.receiveShadows = true
  groundMesh.freezeWorldMatrix()

  // ── 4-Light rig ──
  const dl = defaultLighting

  const hemiLight = new HemisphericLight('hemi-light', dl.hemispheric.direction.clone(), scene)
  hemiLight.intensity = dl.hemispheric.intensity
  hemiLight.diffuse = dl.hemispheric.skyColor.clone()
  hemiLight.groundColor = dl.hemispheric.groundColor.clone()

  const sunLight = new DirectionalLight('sun-light', dl.sun.direction.clone(), scene)
  sunLight.intensity = dl.sun.intensity
  sunLight.diffuse = dl.sun.color.clone()

  const fillLight = new DirectionalLight('fill-light', dl.fill.direction.clone(), scene)
  fillLight.intensity = dl.fill.intensity
  fillLight.diffuse = dl.fill.color.clone()

  const bottomLight = new DirectionalLight('bottom-light', dl.bottom.direction.clone(), scene)
  bottomLight.intensity = dl.bottom.intensity
  bottomLight.diffuse = dl.bottom.color.clone()

  // ── IBL environment texture for PBR material reflections ──
  let envTex: CubeTexture | null = null
  try {
    envTex = CubeTexture.CreateFromPrefilteredData(environment.iblUrl, scene)
    scene.environmentTexture = envTex
    scene.environmentIntensity = 0.5
  } catch {
    console.warn('SceneSetup: Failed to load IBL environment texture, PBR reflections disabled')
  }

  // ── Shadow generator (sun) ──
  const ds = defaultShadow
  const shadowGen = new ShadowGenerator(mapSize, sunLight)
  shadowGen.useBlurExponentialShadowMap = true
  shadowGen.blurKernel = ds.blurKernel
  shadowGen.bias = ds.bias
  shadowGen.normalBias = ds.normalBias
  shadowGen.setDarkness(ds.darkness)

  // Auto-register shadow casters (skip small meshes below triangle threshold)
  const SHADOW_TRI_THRESHOLD = 100
  const shouldCastShadow = (m: Mesh): boolean => {
    if (m === groundMesh || m === skyDome) return false
    if (!m.isEnabled() || !m.isVisible) return false
    if (m.metadata?.noShadow) return false
    const tris = Math.floor(m.getTotalIndices() / 3)
    return tris >= SHADOW_TRI_THRESHOLD
  }

  for (const m of scene.meshes) {
    if (m instanceof Mesh && shouldCastShadow(m)) {
      shadowGen.addShadowCaster(m)
    }
  }
  const obs = scene.onNewMeshAddedObservable.add((m) => {
    if (m instanceof Mesh && shouldCastShadow(m)) {
      shadowGen.addShadowCaster(m)
    }
  })

  // ── Scene settings ──
  scene.autoClear = false           // sky dome covers background
  scene.autoClearDepthAndStencil = true
  scene.fogMode = BScene.FOGMODE_NONE

  // ACES tone mapping
  const ip = defaultImageProcessing
  scene.imageProcessingConfiguration.toneMappingEnabled = ip.toneMappingEnabled
  scene.imageProcessingConfiguration.toneMappingType = ip.toneMappingType
  scene.imageProcessingConfiguration.exposure = ip.exposure
  scene.imageProcessingConfiguration.contrast = ip.contrast

  return {
    dispose() {
      scene.onNewMeshAddedObservable.remove(obs)
      shadowGen.dispose()
      bottomLight.dispose()
      fillLight.dispose()
      sunLight.dispose()
      hemiLight.dispose()
      if (envTex) { envTex.dispose(); scene.environmentTexture = null }
      groundMesh.dispose()
      groundMat.dispose()
      groundTex.dispose()
      skyDome.dispose()
      skyMat.dispose()
      disposeFrameMaterialCache()
      disposeCoverMaterialCache()
    },
  }
}

// ─── Studio Environment: PBR ground + grid + IBL + 2-light rig ──────────────

function setupStudioEnvironment(scene: BScene, preset: 'white' | 'black'): Disposable {
  const { studioGround, grid, environment, studioLighting, studioShadow } = SCENE_CONFIG
  const colors = getStudioPresetColors(preset)
  const mapSize = getShadowMapSize()

  // ── Background ──
  scene.clearColor = colors.clearColor.clone()

  // ── PBR ground ──
  const groundMesh = MeshBuilder.CreateGround('ground', {
    width: studioGround.size,
    height: studioGround.size,
    subdivisions: studioGround.subdivisions,
  }, scene)
  groundMesh.receiveShadows = true

  const groundMat = new PBRMaterial('groundMat', scene)
  groundMat.albedoColor = colors.groundAlbedo.clone()
  groundMat.metallic = studioGround.metallic
  groundMat.roughness = studioGround.roughness
  groundMat.backFaceCulling = false
  groundMat.environmentIntensity = colors.groundEnvironmentIntensity
  groundMesh.material = groundMat
  groundMesh.freezeWorldMatrix()

  // ── Grid overlay ──
  const gridMesh = MeshBuilder.CreateGround('gridGround', {
    width: grid.size,
    height: grid.size,
    subdivisions: grid.subdivisions,
  }, scene)
  gridMesh.position.y = grid.yOffset

  const gridMat = new GridMaterial('gridMat', scene)
  gridMat.majorUnitFrequency = grid.majorUnitFrequency
  gridMat.minorUnitVisibility = grid.minorUnitVisibility
  gridMat.gridRatio = grid.gridRatio
  gridMat.mainColor = colors.gridMainColor.clone()
  gridMat.lineColor = colors.gridLineColor.clone()
  gridMat.opacity = colors.gridOpacity
  gridMat.backFaceCulling = false
  gridMesh.material = gridMat
  gridMesh.freezeWorldMatrix()

  // ── Hemispheric light ──
  const sl = studioLighting
  const hemiLight = new HemisphericLight('hemiLight', sl.hemispheric.direction.clone(), scene)
  hemiLight.intensity = colors.hemiIntensity
  hemiLight.diffuse = colors.hemiDiffuse.clone()
  hemiLight.groundColor = colors.hemiGroundColor.clone()
  hemiLight.specular = sl.hemispheric.specular.clone()

  // ── Directional light ──
  const dirLight = new DirectionalLight('dirLight', sl.directional.direction.clone(), scene)
  dirLight.position = sl.directional.position.clone()
  dirLight.intensity = colors.dirIntensity

  // ── Shadow generator ──
  const ss = studioShadow
  const shadowGen = new ShadowGenerator(mapSize, dirLight)
  shadowGen.useBlurExponentialShadowMap = true
  shadowGen.blurKernel = ss.blurKernel
  shadowGen.setDarkness(ss.darkness)

  const SHADOW_TRI_THRESHOLD = 100
  const shouldCastShadow = (m: Mesh): boolean => {
    if (m === groundMesh || m === gridMesh) return false
    if (!m.isEnabled() || !m.isVisible) return false
    if (m.metadata?.noShadow) return false
    const tris = Math.floor(m.getTotalIndices() / 3)
    return tris >= SHADOW_TRI_THRESHOLD
  }

  for (const m of scene.meshes) {
    if (m instanceof Mesh && shouldCastShadow(m)) {
      shadowGen.addShadowCaster(m)
    }
  }
  const obs = scene.onNewMeshAddedObservable.add((m) => {
    if (m instanceof Mesh && shouldCastShadow(m)) {
      shadowGen.addShadowCaster(m)
    }
  })

  // ── IBL environment ──
  let envTex: CubeTexture | null = null
  try {
    envTex = CubeTexture.CreateFromPrefilteredData(environment.iblUrl, scene)
    scene.environmentTexture = envTex
    scene.environmentIntensity = colors.environmentIntensity
  } catch {
    console.warn('SceneSetup: Failed to load IBL environment texture for studio preset')
  }

  // No fog in studio environments
  scene.fogMode = BScene.FOGMODE_NONE

  // ── Scene settings ──
  scene.autoClear = true
  scene.autoClearDepthAndStencil = true

  // Neutral image processing for studio
  scene.imageProcessingConfiguration.toneMappingEnabled = false
  scene.imageProcessingConfiguration.exposure = 1.0
  scene.imageProcessingConfiguration.contrast = 1.0

  return {
    dispose() {
      scene.onNewMeshAddedObservable.remove(obs)
      shadowGen.dispose()
      dirLight.dispose()
      hemiLight.dispose()
      gridMesh.dispose()
      gridMat.dispose()
      groundMesh.dispose()
      groundMat.dispose()
      if (envTex) {
        envTex.dispose()
        scene.environmentTexture = null
      }
      disposeFrameMaterialCache()
      disposeCoverMaterialCache()
    },
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Scene environment with 3 modes:
 *   - default → sky dome + terracotta ground + 4-light rig + ACES tone mapping
 *   - white   → white studio: PBR ground + grid + fog + IBL
 *   - black   → black studio: same structure, dark colours
 *
 * Entire environment rebuilds when preset changes.
 * @see docs/environment-settings.md
 */
export const SceneSetup: FC<SceneSetupProps> = ({ environmentPreset = 'default' }) => {
  const scene = useScene()
  const cameraConfig = getCameraConfig()

  useEffect(() => {
    if (!scene) return

    // Attach camera
    const camera = scene.activeCamera
    const canvas = scene.getEngine().getRenderingCanvas()
    if (camera && canvas) camera.attachControl(canvas, true)

    // Build environment for the active preset
    let env: Disposable
    if (environmentPreset === 'default') {
      env = setupDefaultEnvironment(scene)
    } else {
      env = setupStudioEnvironment(scene, environmentPreset)
    }

    return () => {
      env.dispose()
      if (camera && canvas) camera.detachControl()
    }
  }, [scene, environmentPreset])

  const { camera: camConfig } = SCENE_CONFIG

  return (
    <arcRotateCamera
      name="main-camera"
      alpha={Math.PI / 4}
      beta={Math.PI / 3}
      radius={cameraConfig.radius}
      target={cameraConfig.target}
      minZ={camConfig.minZ}
      wheelPrecision={camConfig.wheelPrecision}
      panningSensibility={camConfig.panningSensibility}
      lowerRadiusLimit={cameraConfig.lowerRadiusLimit}
      upperRadiusLimit={cameraConfig.upperRadiusLimit}
      lowerBetaLimit={camConfig.lowerBetaLimit}
      upperBetaLimit={camConfig.upperBetaLimit}
    />
  )
}
