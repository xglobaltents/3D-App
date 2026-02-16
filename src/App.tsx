import { useState, useCallback, useRef, type ErrorInfo, Component, type ReactNode } from 'react'
import '@babylonjs/loaders/glTF'

import { BabylonProvider } from '@/engine/BabylonProvider'

import { SceneSetup, type EnvironmentPreset, type CameraView } from '@/components/SceneSetup'
import { PerformanceStats } from '@/components/PerformanceStats'
import { Baseplates } from '@/tents/SharedFrames/Baseplates'
import { Uprights } from '@/tents/PremiumArchTent/15m/frame/Uprights'
import { TENT_SPECS as PREMIUM_ARCH_SPECS } from '@/tents/PremiumArchTent/15m/specs'
import { getReactiveCameraConfig } from '@/lib/constants/sceneConfig'
import { useBottomSheetDrag } from '@/hooks/useBottomSheetDrag'
import '@/App.css'

// ─── Error Boundary (#31) ────────────────────────────────────────────────────

interface ErrorBoundaryProps { children: ReactNode }
interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class SceneErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Scene error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', background: '#1a1a1a', color: '#fff', flexDirection: 'column', gap: 12,
        }}>
          <h2>Something went wrong</h2>
          <p style={{ color: '#999', maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message ?? 'The 3D scene encountered an error.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '10px 20px', background: '#4caf50', border: 'none',
              borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 14,
            }}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ─── Available tent types ────────────────────────────────────────────────────

const TENT_OPTIONS = [
  { value: 'PremiumArchTent', label: 'Premium Arch Tent', available: true },
  { value: 'RevolutionTent', label: 'Revolution Tent', available: false },
  { value: 'PolygonTent', label: 'Polygon Tent', available: false },
  { value: 'PyramidTent', label: 'Pyramid Tent', available: false },
] as const

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [numBays, setNumBays] = useState(3)
  const [showFrame, setShowFrame] = useState(true)
  const [tentType, setTentType] = useState('PremiumArchTent')
  const [showStats, setShowStats] = useState(false)
  const [environmentPreset, setEnvironmentPreset] = useState<EnvironmentPreset>('default')
  const [cameraView, setCameraView] = useState<CameraView>('orbit')
  const [loadingCount, setLoadingCount] = useState(0)

  // (#19) Mobile bottom sheet drag gesture
  const controlsRef = useRef<HTMLDivElement>(null)
  useBottomSheetDrag(controlsRef, { peekHeight: 80, maxHeight: 280 })

  const tentLength = numBays * 5 // 5m per bay

  // (#1) Reactive camera config based on tent dimensions
  const cameraConfig = getReactiveCameraConfig(numBays, PREMIUM_ARCH_SPECS.eaveHeight, PREMIUM_ARCH_SPECS.bayDistance)

  // Loading state tracking for child components (#22)
  const handleLoadStateChange = useCallback((loading: boolean) => {
    setLoadingCount(c => loading ? c + 1 : Math.max(0, c - 1))
  }, [])

  const isLoading = loadingCount > 0
  const isPremiumArch = tentType === 'PremiumArchTent'

  // Reset camera view to orbit when user manually interacts
  const handleCameraViewReset = useCallback(() => {
    setCameraView('orbit')
  }, [])

  // (#18) Screenshot handler
  const handleScreenshot = useCallback(() => {
    const canvas = document.getElementById('babylon-canvas') as HTMLCanvasElement | null
    if (!canvas) return
    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tent-${tentType}-${numBays}bays.png`
      a.click()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }, [tentType, numBays])

  // (#18) Share handler
  const handleShare = useCallback(async () => {
    const canvas = document.getElementById('babylon-canvas') as HTMLCanvasElement | null
    if (!canvas) return
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) return
      if (navigator.share) {
        const file = new File([blob], `tent-${tentType}-${numBays}bays.png`, { type: 'image/png' })
        await navigator.share({ title: 'Bait Al Nokhada - 3D Tent', files: [file] })
      } else {
        // Fallback: copy image URL
        const url = URL.createObjectURL(blob)
        await navigator.clipboard.writeText(url)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      console.warn('Share failed:', err)
    }
  }, [tentType, numBays])

  return (
    <SceneErrorBoundary>
      <div id="canvas-container">
        <BabylonProvider canvasId="babylon-canvas">
            <SceneSetup
              environmentPreset={environmentPreset}
              cameraTarget={cameraConfig.target}
              cameraRadius={cameraConfig.radius}
              cameraUpperRadiusLimit={cameraConfig.upperRadiusLimit}
              cameraView={cameraView}
              onCameraViewReset={handleCameraViewReset}
            />

            {isPremiumArch && showFrame && (
              <>
                <Baseplates
                  numBays={numBays}
                  specs={PREMIUM_ARCH_SPECS}
                  enabled={true}
                  onLoadStateChange={handleLoadStateChange}
                />
                <Uprights
                  numBays={numBays}
                  specs={PREMIUM_ARCH_SPECS}
                  enabled={true}
                  onLoadStateChange={handleLoadStateChange}
                />
              </>
            )}
        </BabylonProvider>

        {/* (#22) Loading indicator */}
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner" />
            <span>Loading 3D models...</span>
          </div>
        )}

        {showStats && <PerformanceStats onClose={() => setShowStats(false)} />}

        {/* Control Panel */}
        <div id="controls" ref={controlsRef}>
          <h1>Bait Al Nokhada</h1>
          <div className="subtitle">3D Tent Design System</div>

          {/* (#21) Environment moved near top */}
          <label>Environment</label>
          <select value={environmentPreset} onChange={(e) => setEnvironmentPreset(e.target.value as EnvironmentPreset)}>
            <option value="default">Default</option>
            <option value="white">White Studio</option>
            <option value="black">Black Studio</option>
          </select>
          
          <hr />

          <div className="specs">
            <div><strong>Type:</strong> {
              TENT_OPTIONS.find(t => t.value === tentType)?.label ?? tentType
            }</div>
            <div><strong>Width:</strong> 15m</div>
            <div><strong>Length:</strong> {tentLength}m</div>
          </div>

          <hr />

          <label>Tent Type</label>
          <select value={tentType} onChange={(e) => setTentType(e.target.value)}>
            {TENT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value} disabled={!opt.available}>
                {opt.label}{!opt.available ? ' (Coming Soon)' : ''}
              </option>
            ))}
          </select>

          {/* (#16) Show notice for unavailable types */}
          {!TENT_OPTIONS.find(t => t.value === tentType)?.available && (
            <div className="coming-soon-notice">
              This tent type is not yet available. Select Premium Arch Tent.
            </div>
          )}

          <label>Number of Bays</label>
          <input
            type="range"
            min={1}
            max={20}
            value={numBays}
            onChange={(e) => setNumBays(parseInt(e.target.value))}
          />
          {/* (#20) Bay value always visible */}
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
                className="toggle-btn"
                disabled
              >
                {/* (#23) Covers are a stub -- show disabled state */}
                Coming Soon
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

          <button 
            className={`stats-toggle-btn ${showStats ? 'active' : ''}`}
            onClick={() => setShowStats(!showStats)}
          >
            {showStats ? 'Hide Stats' : 'Show Stats'}
          </button>
        </div>

        {/* (#17) View Buttons — wired to camera animation */}
        <div id="view-buttons">
          {(['front', 'side', 'top', 'back', 'orbit'] as CameraView[]).map(view => (
            <button
              key={view}
              className={`view-btn ${cameraView === view ? 'active' : ''}`}
              id={view === 'top' ? 'viewTop' : view === 'back' ? 'viewBack' : undefined}
              onClick={() => setCameraView(view)}
            >
              {view.charAt(0).toUpperCase() + view.slice(1)}
            </button>
          ))}
        </div>

        {/* (#18) Export Buttons — wired up */}
        <div id="export-buttons">
          <button className="export-btn" onClick={handleScreenshot}>Screenshot</button>
          <button className="export-btn primary" onClick={handleShare}>Share</button>
        </div>
      </div>
    </SceneErrorBoundary>
  )
}

export default App
