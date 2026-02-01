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

  const tentLength = numBays * 5 // 5m per bay

  return (
    <div id="canvas-container">
      <Engine antialias adaptToDeviceRatio canvasId="babylon-canvas">
        <Scene clearColor={new Color4(0.04, 0.04, 0.04, 1)}>
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

      {/* Control Panel */}
      <div id="controls">
        <h1>Bait Al Nokhada</h1>
        <div className="subtitle">3D Tent Design System</div>
        
        <div className="specs">
          <div><strong>Type:</strong> Premium Arch Tent</div>
          <div><strong>Width:</strong> 15m</div>
          <div><strong>Length:</strong> {tentLength}m</div>
        </div>

        <hr />

        <label>Number of Bays</label>
        <input
          type="range"
          min={1}
          max={20}
          value={numBays}
          onChange={(e) => setNumBays(parseInt(e.target.value))}
        />
        <div className="bay-display">{numBays} Bays</div>
        <div className="length-display">{tentLength}m total length</div>

        <hr />

        <div className="section-block" data-accent="green">
          <div className="section-header">
            <span className="section-title">Frame</span>
            <button 
              className={`toggle-btn ${showFrame ? 'active' : ''}`}
              onClick={() => setShowFrame(!showFrame)}
            >
              {showFrame ? 'Visible' : 'Hidden'}
            </button>
          </div>
        </div>

        <div className="section-block" data-accent="blue">
          <div className="section-header">
            <span className="section-title">Covers</span>
            <button 
              className={`toggle-btn ${showCovers ? 'active' : ''}`}
              onClick={() => setShowCovers(!showCovers)}
            >
              {showCovers ? 'Visible' : 'Hidden'}
            </button>
          </div>
        </div>

        <hr />

        <a 
          href="https://baitalnokhada.me" 
          target="_blank" 
          rel="noopener noreferrer"
          className="website-link"
        >
          Visit baitalnokhada.me →
        </a>
      </div>

      {/* View Buttons */}
      <div id="view-buttons">
        <button className="view-btn">Front</button>
        <button className="view-btn">Side</button>
        <button className="view-btn" id="viewTop">Top</button>
        <button className="view-btn" id="viewBack">Back</button>
        <button className="view-btn active">Orbit</button>
      </div>

      {/* Export Buttons */}
      <div id="export-buttons">
        <button className="export-btn">📷 Screenshot</button>
        <button className="export-btn primary">📤 Share</button>
      </div>
    </div>
  )
}

export default App
