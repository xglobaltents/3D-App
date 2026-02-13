import { Suspense, useState } from 'react'
import { FallbackEngine, Scene } from 'react-babylonjs'
import '@babylonjs/loaders/glTF'

import { SceneSetup, type EnvironmentPreset } from './components/SceneSetup'
import { PerformanceStats } from './components/PerformanceStats'
import { Baseplates } from './tents/SharedFrames/Baseplates'
import { Uprights } from './tents/PremiumArchTent/15m/frame/Uprights'
import { TENT_SPECS as PREMIUM_ARCH_SPECS } from './tents/PremiumArchTent/15m/specs'
import './App.css'

function App() {
  const [numBays, setNumBays] = useState(3)
  const [showFrame, setShowFrame] = useState(true)
  const [showCovers, setShowCovers] = useState(true)
  const [tentType, setTentType] = useState('PremiumArchTent')
  const [showStats, setShowStats] = useState(false)
  const [environmentPreset, setEnvironmentPreset] = useState<EnvironmentPreset>('default')

  const tentLength = numBays * 5 // 5m per bay


  return (
    <div id="canvas-container">
      <FallbackEngine 
        canvasId="babylon-canvas"
        engineProps={{ antialias: true, adaptToDeviceRatio: true }}
        webGPUEngineProps={{ webGPUEngineOptions: { antialias: true } }}
      >
        <Scene>
          <SceneSetup environmentPreset={environmentPreset} />

          <Suspense fallback={null}>
            <Baseplates enabled={tentType === 'PremiumArchTent' && showFrame} />
            <Uprights
              numBays={numBays}
              specs={PREMIUM_ARCH_SPECS}
              enabled={tentType === 'PremiumArchTent' && showFrame}
            />
          </Suspense>
        </Scene>
      </FallbackEngine>

      {showStats && <PerformanceStats onClose={() => setShowStats(false)} />}

      {/* Control Panel */}
      <div id="controls">
        <h1>Bait Al Nokhada</h1>
        <div className="subtitle">3D Tent Design System</div>
        
        <div className="specs">
          <div><strong>Type:</strong> {
            tentType === 'PremiumArchTent' ? 'Premium Arch Tent' :
            tentType === 'RevolutionTent' ? 'Revolution Tent' :
            tentType === 'PolygonTent' ? 'Polygon Tent' :
            tentType === 'PyramidTent' ? 'Pyramid Tent' : tentType
          }</div>
          <div><strong>Width:</strong> 15m</div>
          <div><strong>Length:</strong> {tentLength}m</div>
        </div>

        <hr />

        <label>Tent Type</label>
        <select value={tentType} onChange={(e) => setTentType(e.target.value)}>
          <option value="PremiumArchTent">Premium Arch Tent</option>
          <option value="RevolutionTent">Revolution Tent</option>
          <option value="PolygonTent">Polygon Tent</option>
          <option value="PyramidTent">Pyramid Tent</option>
        </select>


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

        <hr />

        <label>Environment</label>
        <select value={environmentPreset} onChange={(e) => setEnvironmentPreset(e.target.value as EnvironmentPreset)}>
          <option value="default">Default</option>
          <option value="white">White Studio</option>
          <option value="black">Black Studio</option>
        </select>

        <hr />

        <button 
          className={`stats-toggle-btn ${showStats ? 'active' : ''}`}
          onClick={() => setShowStats(!showStats)}
        >
          {showStats ? 'Hide Stats' : 'Show Stats'}
        </button>
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
        <button className="export-btn">Screenshot</button>
        <button className="export-btn primary">Share</button>
      </div>
    </div>
  )
}

export default App
