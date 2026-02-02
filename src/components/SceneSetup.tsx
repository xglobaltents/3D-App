import { type FC, useEffect, useRef } from 'react'
import { useScene } from 'react-babylonjs'
import { Color3, MeshBuilder, ShaderMaterial, Effect, Mesh, DynamicTexture, StandardMaterial } from '@babylonjs/core'
import { SCENE_CONFIG, getCameraConfig, getSkyColors, type SkyPreset } from '../lib/constants/sceneConfig'

// ─── Re-export types ─────────────────────────────────────────────────────────

export type { SkyPreset }

interface SceneSetupProps {
  skyPreset?: SkyPreset
}

// ─── Sky Gradient Shader ─────────────────────────────────────────────────────

const SKY_VERTEX_SHADER = `
  precision highp float;
  attribute vec3 position;
  uniform mat4 worldViewProjection;
  varying float vY;
  void main() {
    gl_Position = worldViewProjection * vec4(position, 1.0);
    vY = normalize(position).y;
  }
`

const SKY_FRAGMENT_SHADER = `
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

/**
 * Scene setup: camera, lights, ground, sky
 * @see docs/environment-settings.md
 */
export const SceneSetup: FC<SceneSetupProps> = ({ skyPreset = 'default' }) => {
  const scene = useScene()
  const cameraConfig = getCameraConfig()
  const skyMaterialRef = useRef<ShaderMaterial | null>(null)
  const skyDomeRef = useRef<Mesh | null>(null)

  // Initial setup (camera, sky dome, ground)
  useEffect(() => {
    if (!scene) return

    // Attach camera controls
    const camera = scene.activeCamera
    const canvas = scene.getEngine().getRenderingCanvas()
    if (camera && canvas) {
      camera.attachControl(canvas, true)
    }

    // Register sky shader
    Effect.ShadersStore['skyGradientVertexShader'] = SKY_VERTEX_SHADER
    Effect.ShadersStore['skyGradientFragmentShader'] = SKY_FRAGMENT_SHADER

    // Create sky dome
    const skyDome = MeshBuilder.CreateSphere('sky-dome', { 
      diameter: SCENE_CONFIG.sky.diameter, 
      segments: SCENE_CONFIG.sky.segments,
      sideOrientation: 2 // backside
    }, scene)
    skyDome.position.y = 0
    skyDome.isPickable = false
    skyDome.infiniteDistance = true
    skyDome.renderingGroupId = 0 // Render first (behind everything)
    skyDomeRef.current = skyDome

    // Sky gradient material
    const skyMaterial = new ShaderMaterial('sky-mat', scene, {
      vertex: 'skyGradient',
      fragment: 'skyGradient',
    }, {
      attributes: ['position'],
      uniforms: ['worldViewProjection', 'horizonColor', 'lowColor', 'midColor', 'zenithColor'],
    })
    skyMaterial.backFaceCulling = false
    skyDome.material = skyMaterial
    skyMaterialRef.current = skyMaterial

    // Create brick pattern ground texture
    const { ground } = SCENE_CONFIG
    const brickWidth = 64   // pixels
    const brickHeight = 32  // pixels (2:1 ratio for bricks)
    const grout = ground.groutWidthPx
    const textureSize = 256 // 4 bricks wide, 8 rows (covers running bond repeat)
    const groundTexture = new DynamicTexture('ground-tile-texture', textureSize, scene, true)
    const ctx = groundTexture.getContext()
    
    // Fill with grout/mortar color
    ctx.fillStyle = ground.colors.grout
    ctx.fillRect(0, 0, textureSize, textureSize)
    
    // Draw running bond brick pattern (offset every other row)
    ctx.fillStyle = ground.colors.tileBase
    const rows = Math.ceil(textureSize / brickHeight)
    const cols = Math.ceil(textureSize / brickWidth) + 1
    
    for (let row = 0; row < rows; row++) {
      const offset = (row % 2) * (brickWidth / 2) // Offset every other row
      for (let col = -1; col < cols; col++) {
        const x = col * brickWidth + offset + grout
        const y = row * brickHeight + grout
        ctx.fillRect(x, y, brickWidth - grout * 2, brickHeight - grout * 2)
      }
    }
    groundTexture.update()
    
    // Set texture to repeat across the ground
    groundTexture.wrapU = 1 // WRAP
    groundTexture.wrapV = 1 // WRAP
    groundTexture.uScale = ground.tileRepeat
    groundTexture.vScale = ground.tileRepeat

    // Create ground mesh
    const groundMesh = MeshBuilder.CreateGround('ground', { 
      width: ground.size, 
      height: ground.size 
    }, scene)
    
    // Ground material with tiled texture
    const groundMat = new StandardMaterial('ground-mat', scene)
    groundMat.diffuseTexture = groundTexture
    groundMat.specularColor = new Color3(0, 0, 0)
    groundMat.roughness = ground.roughness
    groundMesh.material = groundMat

    return () => {
      if (camera && canvas) {
        camera.detachControl()
      }
      skyDome.dispose()
      skyMaterial.dispose()
      groundMesh.dispose()
      groundMat.dispose()
      groundTexture.dispose()
    }
  }, [scene])

  // Update sky colors when preset changes
  useEffect(() => {
    if (!skyMaterialRef.current) return
    const colors = getSkyColors(skyPreset)
    skyMaterialRef.current.setColor3('horizonColor', colors.horizon)
    skyMaterialRef.current.setColor3('lowColor', colors.low)
    skyMaterialRef.current.setColor3('midColor', colors.mid)
    skyMaterialRef.current.setColor3('zenithColor', colors.zenith)
  }, [skyPreset])

  const { lighting, camera: camConfig } = SCENE_CONFIG

  return (
    <>
      {/* Arc Rotate Camera */}
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

      {/* Hemispheric Light (ambient fill) */}
      <hemisphericLight
        name="hemi-light"
        intensity={lighting.hemispheric.intensity}
        direction={lighting.hemispheric.direction}
        diffuse={lighting.hemispheric.diffuse}
        groundColor={lighting.hemispheric.groundColor}
      />

      {/* Directional Light (sun) */}
      <directionalLight
        name="sun-light"
        intensity={lighting.sun.intensity}
        direction={lighting.sun.direction}
        diffuse={lighting.sun.diffuse}
      />

      {/* Fill Light (secondary) */}
      <directionalLight
        name="fill-light"
        intensity={lighting.fill.intensity}
        direction={lighting.fill.direction}
        diffuse={lighting.fill.diffuse}
      />

      {/* Bottom Fill Light */}
      <directionalLight
        name="bottom-light"
        intensity={lighting.bottom.intensity}
        direction={lighting.bottom.direction}
        diffuse={lighting.bottom.diffuse}
      />
    </>
  )
}
