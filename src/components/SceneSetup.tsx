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
  MeshBuilder,
  PBRMaterial,
  Scene as BScene,
  ScenePerformancePriority,
  ShaderMaterial,
  Texture,
  Vector3,
  Animation,
  AnimationGroup,
} from '@babylonjs/core'
// Side-effect imports: ensure engine.createDynamicTexture is available after tree-shaking
import '@babylonjs/core/Engines/Extensions/engine.dynamicTexture'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture'
import {
  SCENE_CONFIG,
  type EnvironmentPreset,
  type ScenePerformanceTier,
} from '@/lib/constants/sceneConfig'
import { refreshFrameMaterialCache, setFrameMaterialEnvironmentProfile } from '@/lib/materials/frameMaterials'
import { refreshCoverMaterialCache } from '@/lib/materials/coverMaterials'
import { setupPostProcessingPipeline } from '@/lib/utils/postProcessing'

// ─── Re-export types ─────────────────────────────────────────────────────────

export type { EnvironmentPreset }

/** Camera view preset for animating camera position */
export type CameraView = 'orbit' | 'front' | 'side' | 'top' | 'back'

interface SceneSetupProps {
  environmentPreset?: EnvironmentPreset
  performanceTier?: ScenePerformanceTier
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
  /** True while PartBuilder is active — relaxes perf optimisations that block per-pixel picking */
  builderMode?: boolean
  /** True while child GLB loaders are active — used to batch material recompiles during rebuilds */
  isLoading?: boolean
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

const IBL_FAILOVER_TIMEOUT_MS = 1000

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
    }, IBL_FAILOVER_TIMEOUT_MS)

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
    sky, defaultGround, defaultLighting,
    environment,
  } = SCENE_CONFIG

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
  // 4th arg `true` enables mipmaps so the texture filters down cleanly
  // when tiled 150× across a 600m ground viewed at grazing angles. Without
  // mipmaps the tile pattern aliases into dark/light moiré patches that
  // look like soft shadows on the ground.
  const groundTex = new DynamicTexture('ground-tile-tex', texSize, scene, true)
  const ctx = groundTex.getContext()

  ctx.fillStyle = defaultGround.colors.grout
  ctx.fillRect(0, 0, texSize, texSize)

  // Deterministic PRNG (mulberry32) — keeps the tile-color variation
  // identical across reloads so it never accidentally lines up with the
  // tent and looks like a stray shadow.
  let seed = 0x9e3779b9
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const { r, g, b } = defaultGround.colors.tileBase
  for (let row = 0; row < tilesPerSide; row++) {
    for (let col = 0; col < tilesPerSide; col++) {
      // ±4 RGB variance — subtle texture without producing patches that
      // read as soft shadows on the ground plane.
      const vary = Math.floor(rand() * 8) - 4
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
  // Max anisotropic filtering kills the remaining grazing-angle moiré
  // that even mipmaps don't fully resolve on a 600m tiled ground.
  groundTex.anisotropicFilteringLevel = 16
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
  groundMesh.receiveShadows = false
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

  // ── Optional: replace gradient sky with IBL-based skybox so the visible
  //    sky matches the reflections in metal/cover materials.
  let iblSkybox: ReturnType<typeof scene.createDefaultSkybox> | null = null
  if (sky.useIBLSkybox && envResult.texture) {
    skyDome.setEnabled(false)
    const buildSkybox = () => {
      iblSkybox = scene.createDefaultSkybox(
        envResult.texture!,
        true,
        sky.iblSkyboxSize,
        sky.iblSkyboxBlur,
      )
      if (iblSkybox) iblSkybox.isPickable = false
    }
    if (envResult.texture.isReady()) buildSkybox()
    else envResult.texture.onLoadObservable.addOnce(buildSkybox)
  }

  scene.clearColor = new Color4(gc.horizon.r, gc.horizon.g, gc.horizon.b, 1.0)

  // ── Scene settings ──
  scene.autoClear = true
  scene.autoClearDepthAndStencil = true
  scene.fogMode = BScene.FOGMODE_NONE

  // NOTE: tone mapping / exposure / contrast are owned by
  // setupPostProcessingPipeline (DefaultRenderingPipeline.imageProcessing).

  return {
    dispose() {
      bottomLight.dispose()
      fillLight.dispose()
      sunLight.dispose()
      hemiLight.dispose()
      envResult.dispose()
      groundMesh.dispose()
      groundMat.dispose()
      groundTex.dispose()
      iblSkybox?.dispose()
      skyDome.dispose()
      skyMat.dispose()
    },
  }
}

// ─── Camera View Animation ───────────────────────────────────────────────────

function animateCameraToView(
  camera: ArcRotateCamera,
  view: CameraView,
  target: Vector3,
  radius: number
): AnimationGroup {
  const fps = 60
  const frames = 20 // snappier than 30
  const scene = camera.getScene()

  // Stop & dispose any running camera animation group immediately — prevents
  // the camera from sweeping back through the previous view when the user
  // rapidly switches presets, and frees the prior group's keyframe buffers.
  const previous = scene.getAnimationGroupByName(CAMERA_ANIM_GROUP_NAME)
  if (previous) {
    previous.stop()
    previous.dispose()
  }

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

  const group = new AnimationGroup(CAMERA_ANIM_GROUP_NAME, scene)
  group.addTargetedAnimation(makeAnim('alphaAnim',   'alpha',    camera.alpha,    targetAlpha),                camera)
  group.addTargetedAnimation(makeAnim('betaAnim',    'beta',     camera.beta,     v.beta),                     camera)
  group.addTargetedAnimation(makeAnim('radiusAnim',  'radius',   camera.radius,   radius * v.radiusMul),       camera)
  group.addTargetedAnimation(makeAnim('targetXAnim', 'target.x', camera.target.x, target.x),                   camera)
  group.addTargetedAnimation(makeAnim('targetYAnim', 'target.y', camera.target.y, target.y),                   camera)
  group.addTargetedAnimation(makeAnim('targetZAnim', 'target.z', camera.target.z, target.z),                   camera)

  group.normalize(0, frames)
  group.onAnimationGroupEndObservable.addOnce(() => group.dispose())
  group.play(false)
  return group
}

const CAMERA_ANIM_GROUP_NAME = 'cameraViewAnim'
const GROUND_TARGET_Y_MIN = 0
const GROUND_CAMERA_CLEARANCE = 0.6

function getMaxBetaAboveGround(camera: ArcRotateCamera, minCameraY = GROUND_CAMERA_CLEARANCE): number {
  const safeRadius = Math.max(camera.radius, 1e-4)
  const normalized = (minCameraY - camera.target.y) / safeRadius
  const clamped = Math.max(-1, Math.min(1, normalized))
  return Math.acos(clamped)
}

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Scene environment (default preset only):
 *   - sky dome + terracotta ground + 4-light rig + ACES tone mapping
 *
 * Camera target + radius are reactive to tent dimensions.
 *
 * FIX: setFrameMaterialEnvironmentProfile() is called BEFORE
 * refreshFrameMaterialCache() so intensity profiles are applied
 * before materials get markAsDirty.
 */
export const SceneSetup: FC<SceneSetupProps> = ({
  environmentPreset = 'default',
  performanceTier = 'standard',
  cameraTarget,
  cameraRadius,
  cameraUpperRadiusLimit,
  cameraView = 'orbit',
  onCameraViewReset,
  builderMode = false,
  isLoading = false,
}) => {
  const scene = useScene()
  const cameraRef = useRef<ArcRotateCamera | null>(null)
  const touchPanStateRef = useRef({
    activeTouchIds: new Set<number>(),
    panningPointerId: null as number | null,
    lastX: 0,
    lastY: 0,
  })

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

    // Allow panning in world space, including vertical target moves.
    // Ground clamps below keep both target and camera from dropping underground.
    camera.panningAxis = new Vector3(1, 1, 1)

    if (canvas) camera.attachControl(canvas, true)
    scene.activeCamera = camera
    cameraRef.current = camera

    // Perf defaults — overridden by the builderMode effect below when the user
    // enters PartBuilder (which needs full picking + dirty-mechanism behaviour).
    //  - skipPointerMovePicking avoids per-mousemove ray casts against thin instances.
    //  - performancePriority Intermediate flips on a vetted bundle of safe
    //    optimisations (skipped picking, frozen active meshes, etc.) for
    //    largely-static scenes like a tent configurator.
    scene.skipPointerMovePicking = true
    scene.performancePriority = ScenePerformancePriority.Intermediate

    // NOTE: TAA (in DefaultRenderingPipeline) handles edge AA without blurring
    // brushed-aluminum specular highlights — replaces the prior "no AA"
    // trade-off documented here previously.

    // Clamp target/camera so users can pan down to ground level and look up
    // from inside the tent without letting the camera dip below ground.
    const onAfterInput = camera.onAfterCheckInputsObservable.add(() => {
      if (camera.target.y < GROUND_TARGET_Y_MIN) {
        camera.target.y = GROUND_TARGET_Y_MIN
      }

      const dynamicUpperBeta = Math.min(
        camConfig.upperBetaLimit,
        getMaxBetaAboveGround(camera),
      )

      if (camera.beta > dynamicUpperBeta) {
        camera.beta = dynamicUpperBeta
      }
    })

    return () => {
      camera.onAfterCheckInputsObservable.remove(onAfterInput)
      if (canvas) camera.detachControl()
      camera.dispose()
      cameraRef.current = null
    }
    // Camera is created ONCE per scene. Target, radius, and upperLimit are
    // intentionally excluded — they are updated reactively in separate effects
    // below. Including them here would destroy and recreate the camera on every
    // dimension change, losing the user's orbit position and causing flicker.
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Builder mode: relax perf optimisations that interfere with picking ──
  useEffect(() => {
    if (!scene) return
    if (builderMode) {
      scene.skipPointerMovePicking = false
      scene.performancePriority = ScenePerformancePriority.BackwardCompatible
    } else {
      scene.skipPointerMovePicking = true
      scene.performancePriority = ScenePerformancePriority.Intermediate
    }
  }, [scene, builderMode])

  // ── Bay/variant rebuild guard: batch material recompiles during reload ──
  // While GLB loaders are mid-flight, every component touching the shared
  // PBR materials would otherwise trigger a redundant shader recompile.
  // Blocking the dirty mechanism collapses these into a single recompile
  // when loading finishes.
  useEffect(() => {
    if (!scene) return
    scene.blockMaterialDirtyMechanism = isLoading
    return () => {
      scene.blockMaterialDirtyMechanism = false
    }
  }, [scene, isLoading])

  // ── Environment setup (rebuilds on preset change) ──
  useEffect(() => {
    if (!scene) return

    // FIX: Set intensity profile FIRST so materials created during
    // environment setup already have correct values for this preset.
    setFrameMaterialEnvironmentProfile(environmentPreset)

    const env = setupDefaultEnvironment(scene)

    // Refresh all PBR material caches with new intensity profiles
    refreshFrameMaterialCache()
    refreshCoverMaterialCache()

    return () => {
      env.dispose()
    }
  }, [scene, environmentPreset])

  // ── Post-processing pipeline (rebuilds on preset change) ──
  // DefaultRenderingPipeline owns tone mapping, sharpen, bloom; TAA + SSAO2
  // attached on top. Tunables live in SCENE_CONFIG.postProcessing.
  useEffect(() => {
    if (!scene) return
    const camera = cameraRef.current
    if (!camera) return

    const handle = setupPostProcessingPipeline(scene, camera, environmentPreset, performanceTier)
    return () => {
      handle.dispose()
    }
  }, [scene, environmentPreset, performanceTier])

  // Single-touch drags should pan the camera target across the ground plane.
  // Babylon's default one-finger touch path orbits instead, so we override it
  // on the canvas and keep built-in multi-touch pinch/pan behavior intact.
  useEffect(() => {
    if (!scene || builderMode) return

    const camera = cameraRef.current
    const canvas = scene.getEngine().getRenderingCanvas()
    if (!camera || !canvas) return

    const touchPanState = touchPanStateRef.current
    const resetSingleTouchPan = () => {
      touchPanState.panningPointerId = null
      touchPanState.lastX = 0
      touchPanState.lastY = 0
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return

      touchPanState.activeTouchIds.add(event.pointerId)
      if (touchPanState.activeTouchIds.size !== 1) {
        resetSingleTouchPan()
        return
      }

      touchPanState.panningPointerId = event.pointerId
      touchPanState.lastX = event.clientX
      touchPanState.lastY = event.clientY
      camera.inertialAlphaOffset = 0
      camera.inertialBetaOffset = 0
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      if (touchPanState.activeTouchIds.size !== 1) return
      if (touchPanState.panningPointerId !== event.pointerId) return

      const deltaX = event.clientX - touchPanState.lastX
      const deltaY = event.clientY - touchPanState.lastY
      touchPanState.lastX = event.clientX
      touchPanState.lastY = event.clientY

      if (deltaX === 0 && deltaY === 0) return

      camera.inertialAlphaOffset = 0
      camera.inertialBetaOffset = 0
      camera.inertialPanningX += -deltaX / camera.panningSensibility
      camera.inertialPanningY += deltaY / camera.panningSensibility
    }

    const handlePointerEnd = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return

      touchPanState.activeTouchIds.delete(event.pointerId)
      if (touchPanState.panningPointerId === event.pointerId || touchPanState.activeTouchIds.size !== 1) {
        resetSingleTouchPan()
      }
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    canvas.addEventListener('pointerup', handlePointerEnd)
    canvas.addEventListener('pointercancel', handlePointerEnd)

    return () => {
      touchPanState.activeTouchIds.clear()
      resetSingleTouchPan()
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerup', handlePointerEnd)
      canvas.removeEventListener('pointercancel', handlePointerEnd)
    }
  }, [scene, builderMode])

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