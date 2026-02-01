import { Vector3, Color3 } from '@babylonjs/core'
import { Engine, Scene } from 'react-babylonjs'
import './App.css'

function App() {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <Engine antialias adaptToDeviceRatio canvasId="babylon-canvas">
        <Scene>
          <arcRotateCamera
            name="camera1"
            target={Vector3.Zero()}
            alpha={Math.PI / 2}
            beta={Math.PI / 4}
            radius={8}
          />
          <hemisphericLight
            name="light1"
            intensity={0.7}
            direction={Vector3.Up()}
          />
          <sphere
            name="sphere1"
            diameter={2}
            segments={32}
            position={new Vector3(-2, 1, 0)}
          >
            <standardMaterial
              name="sphere-mat"
              diffuseColor={Color3.Red()}
              specularColor={Color3.Black()}
            />
          </sphere>
          <box
            name="box1"
            size={2}
            position={new Vector3(2, 1, 0)}
          >
            <standardMaterial
              name="box-mat"
              diffuseColor={Color3.Blue()}
              specularColor={Color3.Black()}
            />
          </box>
          <ground
            name="ground1"
            width={10}
            height={10}
            subdivisions={2}
          >
            <standardMaterial
              name="ground-mat"
              diffuseColor={Color3.Green()}
              specularColor={Color3.Black()}
            />
          </ground>
        </Scene>
      </Engine>
    </div>
  )
}

export default App
