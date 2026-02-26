import { type FC, useEffect, useMemo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import {
  ArcRotateCamera,
  Color4,
  CubeTexture,
  CubicEase,
  DirectionalLight,
  DynamicTexture,
  EasingFunction,
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
// Side-effect imports: ensure engine.createDynamicTexture is available after tree-shaking
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture'
import { GridMaterial } from '@babylonjs/materials'
import {
  SCENE_CONFIG,
  getShadowMapSize,
  getStudioPresetColors,
  type EnvironmentPreset,
} from '@/lib/constants/sceneConfig'
import { refreshFrameMaterialCache, setFrameMaterialEnvironmentProfile } from '@/lib/materials/frameMaterials'
import { refreshCoverMaterialCache } from '@/lib/materials/coverMaterials'

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

// ─── Shared Shadow Caster Helper ─────────────────────────────────────────────

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
  for (const m of scene.meshes) {
    if (m instanceof Mesh && shouldCastShadow(m, excludeMeshes)) {
      shadowGen.addShadowCaster(m)
    }
  }
  const addObs = scene.onNewMeshAddedObservable.add((m) => {
    if (m instanceof Mesh && shouldCastShadow(m, excludeMeshes)) {
      shadowGen.addShadowCaster(m)
    }
  })
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

// ─── Procedural Environment Fallback ─────────────────────────────────────────

function createProceduralEnvironment(scene: BScene): void {
  try {
    const envHelper = scene.createDefaultEnvironment({
      createGround: false,
      createSkybox: false,
      setupImageProcessing: false,
    })
    if (envHelper) {
      scene.environmentIntensity = 0.5
      console.log('SceneSetup: Procedural environment created as IBL fallback')
    }
  } catch (err) {
    console.warn('SceneSetup: Procedural environment fallback also failed:', err)
  }
}

/**
 * Try to load the IBL .env file. If it fails (404), fall back to
 * a procedural environment so PBR materials still get reflections.
 *
 * FIX: Refresh materials AFTER IBL is fully loaded, not during setup.
 * This prevents the ground material and other PBR mats from having
 * stale shader defines.
 */
interface EnvTextureResult {
  texture: CubeTexture | null
  /** Clears the failover timer + disposes the texture. Must be called on cleanup. */
  dispose(): void
}

function setupEnvironmentTexture(
  scene: BScene,
  url: string,
  intensity: number,
): EnvTextureResult {
  let envTex: CubeTexture | null = null
  let iblFailoverTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  try {
    envTex = CubeTexture.CreateFromPrefilteredData(url, scene)
    iblFailoverTimer = window.setTimeout(() => {
      if (disposed) return
      if (!envTex?.isReady()) {
        console.warn(`SceneSetup: IBL file ${url} did not become ready — using procedural fallback`)
        envTex?.dispose()
        scene.environmentTexture = null
        createProceduralEnvironment(scene)
      }
    }, 3000)

    envTex.onLoadObservable.addOnce(() => {
      if (iblFailoverTimer != null) window.clearTimeout(iblFailoverTimer)
      if (disposed) return
      console.log('SceneSetup: IBL loaded — refreshing PBR materials')

      refreshFrameMaterialCache()
      refreshCoverMaterialCache()

      // Unfreeze → mark dirty → refreeze any frozen PBR materials (e.g. ground)
      // so they pick up the newly loaded IBL reflections.
      for (const mat of scene.materials) {
        if (mat instanceof PBRMaterial) {
          const wasFrozen = mat.isFrozen
          if (wasFrozen) mat.unfreeze()
          mat.markAsDirty(1) // MATERIAL_TextureDirtyFlag
          if (wasFrozen) mat.freeze()
        }
      }
    })

    scene.environmentTexture = envTex
    scene.environmentIntensity = intensity
  } catch {
    console.warn(`SceneSetup: IBL ${url} failed — using procedural fallback`)
    scene.environmentTexture = null
    createProceduralEnvironment(scene)
  }

  return {
    texture: envTex,
    dispose() {
      disposed = true
      if (iblFailoverTimer != null) {
        window.clearTimeout(iblFailoverTimer)
        iblFailoverTimer = null
      }
      if (envTex) {
        envTex.dispose()
        envTex = null
        scene.environmentTexture = null
      }
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
  const tilesPerSide = 8
  const texSize = defaultGround.texSize
  const grout = defaultGround.groutWidthPx * 2
  const cellSize = texSize / tilesPerSide
  const groundTex = new DynamicTexture('ground-tile-tex', texSize, scene, false)
  const ctx = groundTex.getContext()

  ctx.fillStyle = defaultGround.colors.grout
  ctx.fillRect(0, 0, texSize, texSize)

  const { r, g, b } = defaultGround.colors.tileBase
  for (let row = 0; row < tilesPerSide; row++) {
    for (let col = 0; col < tilesPerSide; col++) {
      const vary = Math.floor(Math.random() * 20) - 10
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
  groundTex.anisotropicFilteringLevel = 16
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

  groundMat.forceIrradianceInFragment = false
  groundMesh.material = groundMat
  groundMesh.receiveShadows = true
  groundMesh.freezeWorldMatrix()

  // NOTE: No forceCompilation() here — the render loop is deferred until
  // IBL is loaded, so the ground shader will compile with REFLECTION defines
  // from the start.  This prevents the light→dark flash.

  // ── 4-Light rig with specular colors for PBR ──
  const dl = defaultLighting

  const hemiLight = new HemisphericLight('hemi-light', dl.hemispheric.direction.clone(), scene)
  hemiLight.intensity = dl.hemispheric.intensity
  hemiLight.diffuse = dl.hemispheric.skyColor.clone()
  hemiLight.groundColor = dl.hemispheric.groundColor.clone()
  hemiLight.specular = dl.hemispheric.specular.clone()

  const sunLight = new DirectionalLight('sun-light', dl.sun.direction.clone(), scene)
  sunLight.intensity = dl.sun.intensity
  sunLight.diffuse = dl.sun.color.clone()
  sunLight.specular = dl.sun.specular.clone()

  const fillLight = new DirectionalLight('fill-light', dl.fill.direction.clone(), scene)
  fillLight.intensity = dl.fill.intensity
  fillLight.diffuse = dl.fill.color.clone()
  fillLight.specular = dl.fill.specular.clone()

  const bottomLight = new DirectionalLight('bottom-light', dl.bottom.direction.clone(), scene)
  bottomLight.intensity = dl.bottom.intensity
  bottomLight.diffuse = dl.bottom.color.clone()

  // ── IBL environment texture with procedural fallback ──
  const envResult = setupEnvironmentTexture(scene, environment.iblUrl, 1.0)

  scene.clearColor = new Color4(gc.horizon.r, gc.horizon.g, gc.horizon.b, 1.0)

  // ── Shadow generator (sun) ──
  const ds = defaultShadow
  const shadowGen = new ShadowGenerator(mapSize, sunLight)
  shadowGen.useBlurExponentialShadowMap = true
  shadowGen.blurKernel = ds.blurKernel
  shadowGen.bias = ds.bias
  shadowGen.normalBias = ds.normalBias
  shadowGen.setDarkness(ds.darkness)

  const shadowObs = registerShadowCasters(scene, shadowGen, [groundMesh, skyDome])

  // ── Scene settings ──
  scene.autoClear = true
  scene.autoClearDepthAndStencil = true
  scene.fogMode = BScene.FOGMODE_NONE

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
      envResult.dispose()
      groundMesh.dispose()
      groundMat.dispose()
      groundTex.dispose()
      skyDome.dispose()
      skyMat.dispose()
    },
  }
}

// ─── Studio Environment: PBR ground + grid + IBL + 2-light rig ──────────────

function setupStudioEnvironment(scene: BScene, preset: 'white' | 'black'): Disposable {
  const { studioGround, grid, environment, studioLighting, studioShadow } = SCENE_CONFIG
  const colors = getStudioPresetColors(preset)
  const mapSize = getShadowMapSize()

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
  groundMat.forceIrradianceInFragment = false
  groundMesh.material = groundMat
  groundMesh.freezeWorldMatrix()

  // NOTE: No forceCompilation() — render loop deferred until IBL ready.

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

  const shadowObs = registerShadowCasters(scene, shadowGen, [groundMesh, gridMesh])

  // ── IBL environment with procedural fallback ──
  const envResult = setupEnvironmentTexture(scene, environment.iblUrl, colors.environmentIntensity)

  scene.fogMode = BScene.FOGMODE_NONE
  scene.autoClear = true
  scene.autoClearDepthAndStencil = true

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
      envResult.dispose()
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
  const frames = 20 // snappier than 30
  const scene = camera.getScene()

  // Stop any running camera animation immediately — prevents the camera
  // from sweeping back through the previous view when switching presets.
  scene.stopAnimation(camera)

  const views: Record<CameraView, { alpha: number; beta: number; radiusMul: number }> = {
    orbit: { alpha: Math.PI / 4, beta: Math.PI / 3, radiusMul: 1.0 },
    front: { alpha: Math.PI / 2, beta: Math.PI / 2.5, radiusMul: 1.0 },
    side: { alpha: 0, beta: Math.PI / 2.5, radiusMul: 1.0 },
    top: { alpha: 0, beta: 0.1, radiusMul: 1.2 },
    back: { alpha: -Math.PI / 2, beta: Math.PI / 2.5, radiusMul: 1.0 },
  }
  const v = views[view]

  // Use shortest-path rotation for alpha to avoid spinning the long way around.
  // e.g. front (π/2) → back (-π/2) should go through 0, not through ±π.
  let targetAlpha = v.alpha
  const diff = targetAlpha - camera.alpha
  if (diff > Math.PI) targetAlpha -= Math.PI * 2
  else if (diff < -Math.PI) targetAlpha += Math.PI * 2

  // Easing: cubic ease-out for snappy start, smooth stop
  const easing = new CubicEase()
  easing.setEasingMode(EasingFunction.EASINGMODE_EASEOUT)

  const makeAnim = (
    name: string,
    property: string,
    from: number,
    to: number
  ): Animation => {
    const anim = new Animation(name, property, fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT)
    anim.setKeys([
      { frame: 0, value: from },
      { frame: frames, value: to },
    ])
    anim.setEasingFunction(easing)
    return anim
  }

  const animations = [
    makeAnim('alphaAnim', 'alpha', camera.alpha, targetAlpha),
    makeAnim('betaAnim', 'beta', camera.beta, v.beta),
    makeAnim('radiusAnim', 'radius', camera.radius, radius * v.radiusMul),
    makeAnim('targetXAnim', 'target.x', camera.target.x, target.x),
    makeAnim('targetYAnim', 'target.y', camera.target.y, target.y),
    makeAnim('targetZAnim', 'target.z', camera.target.z, target.z),
  ]

  scene.beginDirectAnimation(camera, animations, 0, frames, false)
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Scene environment with 3 modes:
 *   - default -> sky dome + terracotta ground + 4-light rig + ACES tone mapping
 *   - white   -> white studio: PBR ground + grid + IBL
 *   - black   -> black studio: same structure, dark colours
 *
 * Camera target + radius are reactive to tent dimensions.
 * Entire environment rebuilds when preset changes.
 *
 * FIX: setFrameMaterialEnvironmentProfile() is called BEFORE
 * refreshFrameMaterialCache() so intensity profiles are applied
 * before materials get markAsDirty.
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
  const cameraRef = useRef<ArcRotateCamera | null>(null)

  const target = useMemo(
    () => (cameraTarget ? cameraTarget.clone() : new Vector3(0, 3, 0)),
    [cameraTarget]
  )
  const radius = cameraRadius ?? 25
  const upperLimit = cameraUpperRadiusLimit ?? 150

  const { camera: camConfig } = SCENE_CONFIG

  // ── Create camera (once) ──
  useEffect(() => {
    if (!scene) return

    const canvas = scene.getEngine().getRenderingCanvas()
    const camera = new ArcRotateCamera(
      'main-camera',
      Math.PI / 4,
      Math.PI / 3,
      radius,
      target.clone(),
      scene
    )

    camera.minZ = camConfig.minZ
    camera.wheelPrecision = camConfig.wheelPrecision
    camera.panningSensibility = camConfig.panningSensibility
    camera.lowerRadiusLimit = 5
    camera.upperRadiusLimit = upperLimit
    camera.lowerBetaLimit = camConfig.lowerBetaLimit
    camera.upperBetaLimit = camConfig.upperBetaLimit
    camera.inertia = camConfig.inertia
    camera.panningInertia = camConfig.panningInertia
    camera.pinchPrecision = camConfig.pinchPrecision
    camera.angularSensibilityX = camConfig.angularSensibilityX
    camera.angularSensibilityY = camConfig.angularSensibilityY

    if (canvas) camera.attachControl(canvas, true)
    scene.activeCamera = camera
    cameraRef.current = camera

    return () => {
      if (canvas) camera.detachControl()
      camera.dispose()
      cameraRef.current = null
    }
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Environment setup (rebuilds on preset change) ──
  useEffect(() => {
    if (!scene) return

    // FIX: Set intensity profile FIRST so materials created during
    // environment setup already have correct values for this preset.
    setFrameMaterialEnvironmentProfile(environmentPreset)

    let env: Disposable
    if (environmentPreset === 'default') {
      env = setupDefaultEnvironment(scene)
    } else {
      env = setupStudioEnvironment(scene, environmentPreset)
    }

    // Refresh all PBR material caches with new intensity profiles
    refreshFrameMaterialCache()
    refreshCoverMaterialCache()

    return () => {
      env.dispose()
    }
  }, [scene, environmentPreset])

  // Update camera target/radius reactively when tent dimensions change.
  // Only apply if values actually changed — don't snap back on re-renders
  // caused by environment preset switches while user has orbited away.
  const prevTarget = useRef<Vector3 | null>(null)
  const prevRadius = useRef<number>(radius)

  useEffect(() => {
    const camera = cameraRef.current
    if (!camera) return

    const targetChanged = !prevTarget.current || !target.equals(prevTarget.current)
    const radiusChanged = prevRadius.current !== radius

    if (targetChanged) {
      camera.setTarget(target)
      prevTarget.current = target.clone()
    }
    if (radiusChanged) {
      camera.radius = radius
      prevRadius.current = radius
    }
    camera.upperRadiusLimit = upperLimit
  }, [target, radius, upperLimit])

  // Animate camera on explicit view changes (front/side/top/back).
  // Skip 'orbit' — that's the manual state, user is already where they want.
  const prevView = useRef<CameraView>(cameraView)
  useEffect(() => {
    if (!scene) return
    const camera = cameraRef.current
    if (!camera) return
    // Only animate if the view actually changed and it's a named preset
    if (cameraView === prevView.current) return
    prevView.current = cameraView
    if (cameraView === 'orbit') return // user orbited manually, don't snap
    animateCameraToView(camera, cameraView, target, radius)
  }, [scene, cameraView, target, radius])

  // Reset cameraView to 'orbit' when user manually interacts with the camera
  useEffect(() => {
    if (!scene || !onCameraViewReset) return
    const camera = cameraRef.current
    if (!camera) return

    let isAnimating = false
    const obs = camera.onAfterCheckInputsObservable.add(() => {
      if (scene.getAllAnimatablesByTarget(camera).length > 0) {
        isAnimating = true
        return
      }
      if (isAnimating) {
        isAnimating = false
        return
      }
    })

    const canvas = scene.getEngine().getRenderingCanvas()
    if (canvas) {
      const handleUserInput = () => {
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

  return null
}