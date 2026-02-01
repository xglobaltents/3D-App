import { FC } from 'react'
import { Vector3, Color3 } from '@babylonjs/core'

/**
 * Scene setup: camera, lights, ground
 */
export const SceneSetup: FC = () => {
  return (
    <>
      {/* Arc Rotate Camera */}
      <arcRotateCamera
        name="main-camera"
        alpha={Math.PI / 4}
        beta={Math.PI / 3}
        radius={40}
        target={new Vector3(0, 2, 7.5)}
        minZ={0.1}
        wheelPrecision={15}
        panningSensibility={100}
        lowerRadiusLimit={5}
        upperRadiusLimit={100}
        lowerBetaLimit={0.1}
        upperBetaLimit={Math.PI / 2 - 0.1}
      />

      {/* Hemispheric Light (ambient) */}
      <hemisphericLight
        name="hemi-light"
        intensity={0.6}
        direction={Vector3.Up()}
        groundColor={new Color3(0.4, 0.4, 0.4)}
      />

      {/* Directional Light (sun) */}
      <directionalLight
        name="dir-light"
        intensity={0.8}
        direction={new Vector3(-1, -2, -1)}
      />

      {/* Ground Plane */}
      <ground name="ground" width={100} height={100}>
        <standardMaterial
          name="ground-mat"
          diffuseColor={new Color3(0.35, 0.55, 0.35)}
          specularColor={new Color3(0, 0, 0)}
        />
      </ground>
    </>
  )
}
