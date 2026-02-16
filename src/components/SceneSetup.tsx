import { type FC, useEffect, useMemo } from 'react'
import { useScene } from 'react-babylonjs'
import {
  ArcRotateCamera,
  Color4,
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
  Vector3,
  Animation,
} from '@babylonjs/core'
import { GridMaterial } from '@babylonjs/materials'
import {
  SCENE_CONFIG,
  getShadowMapSize,
  getStudioPresetColors,
  type EnvironmentPreset,
} from '@/lib/constants/sceneConfig'
import { disposeFrameMaterialCache } from '@/lib/materials/frameMaterials'
import { disposeCoverMaterialCache } from '@/lib/materials/coverMaterials'
import { clearGLBCache } from '@/lib/utils/GLBLoader'

// ─── Re-export types ─────────────────────────────────────────────────────────

export type { EnvironmentPreset }

/** Camera view preset for animating camera position */
export type CameraView = 'orbit' | 'front' | 'side' | 'top' | 'back'

interface SceneSetupProps {
  environmentPreset?: EnvironmentPreset
  /** Reactive camera target — pass from parent based on tent dimensions */
  cameraTarget?: Vector3
  /** Reactive camera radius */
  cameraRadius?: number
  /** Upper radius limit */
  cameraUpperRadiusLimit?: number
  /** Current camera view */
  cameraView?: CameraView
  /** Called when user manually orbits — parent should reset cameraView to 'orbit' */
  onCameraViewReset?: () => void
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

// ─── Shared Shadow Caster Helper (#7 — deduplicated) ─────────────────────────

const SHADOW_TRI_THRESHOLD = 100

function shouldCastShadow(mesh: Mesh, excludeMeshes: Mesh[]): boolean {
  if (excludeMeshes.includes(mesh)) return false
  if (!mesh.isEnabled() || !mesh.isVisible) return false
  if (mesh.metadata?.noShadow) return false
  const tris = Math.floor(mesh.getTotalIndices() / 3)
  return tris >= SHADOW_TRI_THRESHOLD
}

function registerShadowCasters(
  scene: BScene,
  shadowGen: ShadowGenerator,
  excludeMeshes: Mesh[]
): { dispose(): void } {
  // Register existing meshes
  for (const m of scene.meshes) {
    if (m instanceof Mesh && shouldCastShadow(m, excludeMeshes)) {
      shadowGen.addShadowCaster(m)
    }
  }
  // Auto-register new meshes
  const addObs = scene.onNewMeshAddedObservable.add((m) => {
    if (m instanceof Mesh && shouldCastShadow(m, excludeMeshes)) {
      shadowGen.addShadowCaster(m)
    }
  })
  // Auto-remove disposed meshes (#6 — shadow cleanup)
  const removeObs = scene.onMeshRemovedObservable.add((m) => {
    if (m instanceof Mesh) {
      shadowGen.removeShadowCaster(m)
    }
  })
  return {
    dispose() {
      scene.onNewMeshAddedObservable.remove(addObs)
      scene.onMeshRemovedObservable.remove(removeObs)
    },
  }
}

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
  const texSize = defaultGround.texSize   // (#8) Use config value, now 1024
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
  // (#5) Add fallback — if .env file 404s, PBR still looks reasonable
  let envTex: CubeTexture | null = null
  try {
    envTex = CubeTexture.CreateFromPrefilteredData(environment.iblUrl, scene)
    scene.environmentTexture = envTex
    scene.environmentIntensity = 0.5
  } catch {
    console.warn('SceneSetup: IBL environment texture failed to load — PBR reflections will be limited')
    scene.environmentTexture = null
  }

  // (#9) Fallback clearColor in case sky dome fails
  scene.clearColor = new Color4(0.75, 0.85, 0.92, 1.0)

  // ── Shadow generator (sun) ──
  const ds = defaultShadow
  const shadowGen = new ShadowGenerator(mapSize, sunLight)
  shadowGen.useBlurExponentialShadowMap = true
  shadowGen.blurKernel = ds.blurKernel
  shadowGen.bias = ds.bias
  shadowGen.normalBias = ds.normalBias
  shadowGen.setDarkness(ds.darkness)

  // Auto-register shadow casters using shared helper (#7)
  const shadowObs = registerShadowCasters(scene, shadowGen, [groundMesh, skyDome])

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
      shadowObs.dispose()
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
      clearGLBCache(scene)
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

  // Use shared shadow helper (#7)
  const shadowObs = registerShadowCasters(scene, shadowGen, [groundMesh, gridMesh])

  // ── IBL environment ──
  let envTex: CubeTexture | null = null
  try {
    envTex = CubeTexture.CreateFromPrefilteredData(environment.iblUrl, scene)
    scene.environmentTexture = envTex
    scene.environmentIntensity = colors.environmentIntensity
  } catch {
    console.warn('SceneSetup: IBL texture failed to load in studio preset')
    scene.environmentTexture = null
  }

  // No fog in studio environments
  scene.fogMode = BScene.FOGMODE_NONE

  // ── Scene settings ──
  scene.autoClear = true
  scene.autoClearDepthAndStencil = true

  // (#10) Mild tone mapping in studio to avoid jarring brightness shift
  scene.imageProcessingConfiguration.toneMappingEnabled = true
  scene.imageProcessingConfiguration.toneMappingType = 1 // ACES
  scene.imageProcessingConfiguration.exposure = 1.0
  scene.imageProcessingConfiguration.contrast = 1.0

  return {
    dispose() {
      shadowObs.dispose()
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
      clearGLBCache(scene)
      disposeFrameMaterialCache()
      disposeCoverMaterialCache()
    },
  }
}

// ─── Camera View Animation ───────────────────────────────────────────────────

function animateCameraToView(
  camera: ArcRotateCamera,
  view: CameraView,
  target: Vector3,
  radius: number
): void {
  const fps = 60
  const frames = 30

  const views: Record<CameraView, { alpha: number; beta: number; radiusMul: number }> = {
    orbit: { alpha: Math.PI / 4, beta: Math.PI / 3, radiusMul: 1.0 },
    front: { alpha: Math.PI / 2, beta: Math.PI / 2.5, radiusMul: 1.0 },
    side: { alpha: 0, beta: Math.PI / 2.5, radiusMul: 1.0 },
    top: { alpha: 0, beta: 0.1, radiusMul: 1.2 },
    back: { alpha: -Math.PI / 2, beta: Math.PI / 2.5, radiusMul: 1.0 },
  }
  const v = views[view]
  const scene = camera.getScene()

  // Alpha animation
  const alphaAnim = new Animation('alphaAnim', 'alpha', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
  alphaAnim.setKeys([
    { frame: 0, value: camera.alpha },
    { frame: frames, value: v.alpha },
  ])

  // Beta animation
  const betaAnim = new Animation('betaAnim', 'beta', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
  betaAnim.setKeys([
    { frame: 0, value: camera.beta },
    { frame: frames, value: v.beta },
  ])

  // Radius animation
  const radiusAnim = new Animation('radiusAnim', 'radius', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
  radiusAnim.setKeys([
    { frame: 0, value: camera.radius },
    { frame: frames, value: radius * v.radiusMul },
  ])

  // Target animation — smooth transition to new target
  const targetXAnim = new Animation('targetXAnim', 'target.x', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
  targetXAnim.setKeys([
    { frame: 0, value: camera.target.x },
    { frame: frames, value: target.x },
  ])
  const targetYAnim = new Animation('targetYAnim', 'target.y', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
  targetYAnim.setKeys([
    { frame: 0, value: camera.target.y },
    { frame: frames, value: target.y },
  ])
  const targetZAnim = new Animation('targetZAnim', 'target.z', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
  targetZAnim.setKeys([
    { frame: 0, value: camera.target.z },
    { frame: frames, value: target.z },
  ])

  scene.beginDirectAnimation(camera, [alphaAnim, betaAnim, radiusAnim, targetXAnim, targetYAnim, targetZAnim], 0, frames, false)
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Scene environment with 3 modes:
 *   - default -> sky dome + terracotta ground + 4-light rig + ACES tone mapping
 *   - white   -> white studio: PBR ground + grid + IBL
 *   - black   -> black studio: same structure, dark colours
 *
 * Camera target + radius are reactive to tent dimensions (#1).
 * Entire environment rebuilds when preset changes.
 * @see docs/environment-settings.md
 */
export const SceneSetup: FC<SceneSetupProps> = ({
  environmentPreset = 'default',
  cameraTarget,
  cameraRadius,
  cameraUpperRadiusLimit,
  cameraView = 'orbit',
  onCameraViewReset,
}) => {
  const scene = useScene()

  // Default camera values
  const target = useMemo(
    () => (cameraTarget ? cameraTarget.clone() : new Vector3(0, 3, 0)),
    [cameraTarget]
  )
  const radius = cameraRadius ?? 25
  const upperLimit = cameraUpperRadiusLimit ?? 150

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

  // (#1) Update camera target/radius reactively when tent dimensions change
  /* eslint-disable react-hooks/immutability */
  useEffect(() => {
    if (!scene) return
    const camera = scene.activeCamera as ArcRotateCamera | null
    if (!camera) return
    camera.setTarget(target)
    camera.radius = radius
    camera.upperRadiusLimit = upperLimit
  }, [scene, target, radius, upperLimit])
  /* eslint-enable react-hooks/immutability */

  // (#2) Animate camera on view changes
  useEffect(() => {
    if (!scene) return
    const camera = scene.activeCamera as ArcRotateCamera | null
    if (!camera) return
    animateCameraToView(camera, cameraView, target, radius)
  }, [scene, cameraView, target, radius])

  // Reset cameraView to 'orbit' when user manually interacts with the camera
  useEffect(() => {
    if (!scene || !onCameraViewReset) return
    const camera = scene.activeCamera as ArcRotateCamera | null
    if (!camera) return

    // Debounce: only fire once after user starts interacting
    let isAnimating = false
    const obs = camera.onAfterCheckInputsObservable.add(() => {
      // Skip if we're in the middle of a programmatic animation
      if (scene.getAllAnimatablesByTarget(camera).length > 0) {
        isAnimating = true
        return
      }
      // Only reset if we were NOT just animating (animation just ended)
      if (isAnimating) {
        isAnimating = false
        return
      }
    })

    // Detect actual user input via pointer events on the canvas
    const canvas = scene.getEngine().getRenderingCanvas()
    if (canvas) {
      const handleUserInput = () => {
        // Only reset if not currently in orbit and no active animations
        if (cameraView !== 'orbit' && scene.getAllAnimatablesByTarget(camera).length === 0) {
          onCameraViewReset()
        }
      }
      canvas.addEventListener('pointerdown', handleUserInput)
      return () => {
        canvas.removeEventListener('pointerdown', handleUserInput)
        camera.onAfterCheckInputsObservable.remove(obs)
      }
    }
    return () => {
      camera.onAfterCheckInputsObservable.remove(obs)
    }
  }, [scene, cameraView, onCameraViewReset])

  const { camera: camConfig } = SCENE_CONFIG

  return (
    <arcRotateCamera
      name="main-camera"
      alpha={Math.PI / 4}
      beta={Math.PI / 3}
      radius={radius}
      target={target}
      minZ={camConfig.minZ}
      wheelPrecision={camConfig.wheelPrecision}
      panningSensibility={camConfig.panningSensibility}
      lowerRadiusLimit={5}
      upperRadiusLimit={upperLimit}
      lowerBetaLimit={camConfig.lowerBetaLimit}
      upperBetaLimit={camConfig.upperBetaLimit}
      inertia={camConfig.inertia}
      panningInertia={camConfig.panningInertia}
      pinchPrecision={camConfig.pinchPrecision}
      angularSensibilityX={camConfig.angularSensibilityX}
      angularSensibilityY={camConfig.angularSensibilityY}
    />
  )
}
