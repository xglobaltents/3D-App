import { FC, useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { Vector3, Color3, Scene } from '@babylonjs/core'

/**
 * Scene setup: camera, lights, ground
 */
export const SceneSetup: FC = () => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    scene.fogMode = Scene.FOGMODE_EXP2
    scene.fogDensity = 0.003
    scene.fogColor = new Color3(0.05, 0.05, 0.06)
    scene.ambientColor = new Color3(0.3, 0.3, 0.3)
  }, [scene])

  return (
    <>
      {/* Arc Rotate Camera */}
      <arcRotateCamera
        name="main-camera"
        alpha={Math.PI / 4}
        beta={Math.PI / 3.1}
        radius={28}
        target={new Vector3(0, 3, 5)}
        minZ={0.1}
        wheelPrecision={15}
        panningSensibility={100}
        lowerRadiusLimit={8}
        upperRadiusLimit={80}
        lowerBetaLimit={0.1}
        upperBetaLimit={Math.PI / 2 - 0.1}
      />

      {/* Hemispheric Light (ambient) */}
      <hemisphericLight
        name="hemi-light"
        intensity={0.6}
        direction={Vector3.Up()}
        groundColor={new Color3(0.2, 0.2, 0.2)}
      />

      {/* Directional Light (sun) */}
      <directionalLight
        name="dir-light"
        intensity={1.2}
        direction={new Vector3(-0.7, -1.1, -0.4)}
        position={new Vector3(25, 35, 15)}
      />

      {/* Subtle skybox */}
      <box name="skybox" size={600} isPickable={false} infiniteDistance>
        <standardMaterial
          name="skybox-mat"
          backFaceCulling={false}
          disableLighting
          emissiveColor={new Color3(0.05, 0.06, 0.08)}
        />
      </box>

      {/* Ground Plane */}
      <ground name="ground" width={200} height={200}>
        <standardMaterial
          name="ground-mat"
          diffuseColor={new Color3(0.15, 0.2, 0.15)}
          ambientColor={new Color3(0.08, 0.1, 0.08)}
          specularColor={new Color3(0, 0, 0)}
        />
      </ground>
    </>
  )
}
