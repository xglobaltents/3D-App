import { Suspense, useState } from 'react'
import { Engine, Scene } from 'react-babylonjs'
import { Vector3, Color4 } from '@babylonjs/core'
import '@babylonjs/loaders/glTF'

import { SceneSetup } from './components/SceneSetup'
import { PremiumArchTent15m } from './tents/PremiumArchTent/15m'
import './App.css'

function App() {
  const [numBays, setNumBays] = useState(3)
  const [showFrame, setShowFrame] = useState(true)
  const [showCovers, setShowCovers] = useState(true)

  return (
    <div style={{ width: '100%', height: '100vh', position: 'relative' }}>
      <Engine antialias adaptToDeviceRatio canvasId="babylon-canvas">
        <Scene clearColor={new Color4(0.9, 0.9, 0.9, 1)}>
          <SceneSetup />

          {/* Tent with Z-up → Y-up rotation */}
          <transformNode
            name="tent-container"
            rotation={new Vector3(-Math.PI / 2, 0, 0)}
          >
            <Suspense fallback={null}>
              <PremiumArchTent15m
                numBays={numBays}
                showFrame={showFrame}
                showCovers={showCovers}
              />
            </Suspense>
          </transformNode>
        </Scene>
      </Engine>

      {/* UI Panel */}
      <div className="ui-panel">
        <h2>Tent Configurator</h2>

        <label htmlFor="num-bays">Number of Bays</label>
        <input
          id="num-bays"
          type="number"
          min={1}
          max={20}
          value={numBays}
          onChange={(e) => setNumBays(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
        />

        <div className="checkbox-group">
          <input
            id="show-frame"
            type="checkbox"
            checked={showFrame}
            onChange={(e) => setShowFrame(e.target.checked)}
          />
          <label htmlFor="show-frame">Show Frame</label>
        </div>

        <div className="checkbox-group">
          <input
            id="show-covers"
            type="checkbox"
            checked={showCovers}
            onChange={(e) => setShowCovers(e.target.checked)}
          />
          <label htmlFor="show-covers">Show Covers</label>
        </div>
      </div>
    </div>
  )
}

export default App
