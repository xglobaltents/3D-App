import { useState, useCallback, useRef, useEffect, type ErrorInfo, Component, type ReactNode } from 'react'
import '@babylonjs/loaders/glTF'
import { Tools } from '@babylonjs/core/Misc/tools'

import { BabylonProvider, getActiveBabylonContext } from '@/engine/BabylonProvider'

import { SceneSetup, type EnvironmentPreset, type CameraView } from '@/components/SceneSetup'
import { PerformanceStats } from '@/components/PerformanceStats'
import { PartBuilder } from '@/components/PartBuilder'
import { SnapshotController } from '@/components/SnapshotController'
import { InspectorController } from '@/components/InspectorController'
import { WebXRController } from '@/components/WebXRController'
import { TENT_REGISTRY, getTentType, getWidths, getEaveVariants, getDefaultVariant, type TentVariantInfo } from '@/lib/tentRegistry'
import { getReactiveCameraConfig, getScenePerformanceTier } from '@/lib/constants/sceneConfig'
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

// Derived from registry — no manual TENT_OPTIONS needed

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const [numBays, setNumBays] = useState(3)
  const [showFrame, setShowFrame] = useState(true)
  const [tentTypeId, setTentTypeId] = useState('PremiumArchTent')
  const [variantKey, setVariantKey] = useState(() => getDefaultVariant('PremiumArchTent')!.key)
  const [showStats, setShowStats] = useState(false)
  const [environmentPreset, setEnvironmentPreset] = useState<EnvironmentPreset>('default')
  const [cameraView, setCameraView] = useState<CameraView>('orbit')
  const [loadingCount, setLoadingCount] = useState(0)
  const [builderMode, setBuilderMode] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear toast timer on unmount to prevent state updates after unmount
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    }
  }, [])

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2500)
  }, [])

  // (#19) Mobile bottom sheet drag gesture
  const controlsRef = useRef<HTMLDivElement>(null)
  useBottomSheetDrag(controlsRef, { peekHeight: 80, maxHeight: 280 })

  // Resolve current tent type and active variant from registry
  const tentTypeInfo = getTentType(tentTypeId)
  const activeVariant: TentVariantInfo = tentTypeInfo?.variants.find(v => v.key === variantKey)
    ?? getDefaultVariant(tentTypeId)
    ?? TENT_REGISTRY[0].variants[0]
  const specs = activeVariant.specs

  // Derived UI selectors
  const widths = getWidths(tentTypeId)
  const currentWidth = activeVariant.widthLabel
  const eaveVariants = getEaveVariants(tentTypeId, currentWidth)
  const hasMultipleEaveOptions = eaveVariants.length > 1

  const tentLength = numBays * specs.bayDistance
  const performanceTier = getScenePerformanceTier(specs.width, tentLength)

  // (#1) Reactive camera config based on tent dimensions
  // React Compiler auto-memoizes this — no manual useMemo needed
  const cameraConfig = getReactiveCameraConfig(numBays, specs.eaveHeight, specs.bayDistance)

  // Loading state tracking for child components (#22)
  const handleLoadStateChange = useCallback((loading: boolean) => {
    setLoadingCount(c => loading ? c + 1 : Math.max(0, c - 1))
  }, [])

  const isLoading = loadingCount > 0

  // Resolve the composition component from the registry
  const TentComponent = activeVariant.component

  // Handler: tent type changed
  const handleTentTypeChange = useCallback((newTypeId: string) => {
    setTentTypeId(newTypeId)
    const dv = getDefaultVariant(newTypeId)
    if (dv) setVariantKey(dv.key)
  }, [])

  // Handler: width changed
  const handleWidthChange = useCallback((newWidth: string) => {
    const variants = getEaveVariants(tentTypeId, newWidth)
    if (variants.length > 0) setVariantKey(variants[0].key)
  }, [tentTypeId])

  // Reset camera view to orbit when user manually interacts
  const handleCameraViewReset = useCallback(() => {
    setCameraView('orbit')
  }, [])

  // (#18) Screenshot handler — uses Babylon's render-target capture so the
  // output resolution is decoupled from the on-screen canvas (lets us export
  // high-DPI marketing-grade PNGs even on small viewports).
  const handleScreenshot = useCallback(async () => {
    const ctx = getActiveBabylonContext()
    if (!ctx?.scene.activeCamera) {
      // Fallback to canvas snapshot if engine isn't ready yet
      const canvas = document.getElementById('babylon-canvas') as HTMLCanvasElement | null
      if (!canvas) { showToast('Could not capture screenshot'); return }
      canvas.toBlob((blob) => {
        if (!blob) { showToast('Screenshot failed'); return }
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `tent-${tentTypeId}-${numBays}bays.png`
        a.click()
        URL.revokeObjectURL(url)
        showToast('Screenshot saved')
      }, 'image/png')
      return
    }
    try {
      // Render at 2× the displayed canvas size, capped at 4K on the long edge
      const canvas = ctx.canvas
      const displayW = canvas.clientWidth || canvas.width
      const displayH = canvas.clientHeight || canvas.height
      const scale = Math.min(2, 3840 / Math.max(displayW, displayH))
      const width = Math.round(displayW * scale)
      const height = Math.round(displayH * scale)
      const dataUrl = await Tools.CreateScreenshotUsingRenderTargetAsync(
        ctx.engine,
        ctx.scene.activeCamera,
        { width, height },
        'image/png',
        4,
        true,
      )
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `tent-${tentTypeId}-${numBays}bays.png`
      a.click()
      showToast(`Screenshot saved (${width}×${height})`)
    } catch (err) {
      console.warn('Render-target screenshot failed:', err)
      showToast('Screenshot failed')
    }
  }, [tentTypeId, numBays, showToast])

  // (#18) Share handler
  const handleShare = useCallback(async () => {
    const ctx = getActiveBabylonContext()
    let blob: Blob | null = null
    if (ctx?.scene.activeCamera) {
      try {
        const canvas = ctx.canvas
        const displayW = canvas.clientWidth || canvas.width
        const displayH = canvas.clientHeight || canvas.height
        const scale = Math.min(2, 3840 / Math.max(displayW, displayH))
        const width = Math.round(displayW * scale)
        const height = Math.round(displayH * scale)
        const dataUrl = await Tools.CreateScreenshotUsingRenderTargetAsync(
          ctx.engine,
          ctx.scene.activeCamera,
          { width, height },
          'image/png',
          4,
          true,
        )
        // Convert dataURL → Blob (Tools has no ToBlob variant in this version)
        const res = await fetch(dataUrl)
        blob = await res.blob()
      } catch (err) {
        console.warn('Render-target share capture failed:', err)
      }
    }
    if (!blob) {
      const canvas = document.getElementById('babylon-canvas') as HTMLCanvasElement | null
      if (!canvas) { showToast('Could not capture image'); return }
      blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    }
    try {
      if (!blob) { showToast('Image capture failed'); return }
      if (navigator.share) {
        const file = new File([blob], `tent-${tentTypeId}-${numBays}bays.png`, { type: 'image/png' })
        await navigator.share({ title: 'Bait Al Nokhada - 3D Tent', files: [file] })
      } else if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        // Fallback: copy image directly to clipboard
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ])
        showToast('Image copied to clipboard')
      } else {
        showToast('Sharing is not supported in this browser')
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        showToast('Share failed')
      }
      console.warn('Share failed:', err)
    }
  }, [tentTypeId, numBays, showToast])

  return (
    <SceneErrorBoundary>
      <div id="canvas-container">
        <BabylonProvider canvasId="babylon-canvas">
            <SceneSetup
              environmentPreset={environmentPreset}
              performanceTier={performanceTier}
              cameraTarget={cameraConfig.target}
              cameraRadius={cameraConfig.radius}
              cameraUpperRadiusLimit={cameraConfig.upperRadiusLimit}
              cameraView={cameraView}
              onCameraViewReset={handleCameraViewReset}
              builderMode={builderMode}
              isLoading={isLoading}
            />

            <SnapshotController
              isLoading={isLoading}
              builderMode={builderMode}
              rebuildKey={`${tentTypeId}|${variantKey}|${numBays}|${environmentPreset}|${cameraView}`}
            />
            <InspectorController />

            {TentComponent && (
              <>
                <TentComponent
                  numBays={numBays}
                  specs={specs}
                  showFrame={showFrame}
                  builderMode={builderMode}
                  onLoadStateChange={handleLoadStateChange}
                />
                {showFrame && builderMode && (
                  <PartBuilder
                    specs={specs}
                    numBays={numBays}
                    tentType={activeVariant.tentType}
                    variant={activeVariant.variant}
                  />
                )}
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
          <label htmlFor="env-select">Environment</label>
          <select id="env-select" value={environmentPreset} onChange={(e) => setEnvironmentPreset(e.target.value as EnvironmentPreset)}>
            <option value="default">Default</option>
            <option value="white">White Studio</option>
            <option value="black">Black Studio</option>
          </select>
          
          <hr />

          <div className="specs">
            <div><strong>Type:</strong> {tentTypeInfo?.label ?? tentTypeId}</div>
            <div><strong>Width:</strong> {specs.width}m</div>
            <div><strong>Eave:</strong> {specs.eaveHeight}m</div>
            <div><strong>Length:</strong> {tentLength}m</div>
          </div>

          <hr />

          <label htmlFor="tent-type-select">Tent Type</label>
          <select id="tent-type-select" value={tentTypeId} onChange={(e) => handleTentTypeChange(e.target.value)}>
            {TENT_REGISTRY.filter(t => t.available).map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          {TENT_REGISTRY.some(t => !t.available) && (
            <div className="coming-soon-notice">
              More tent types coming soon: {TENT_REGISTRY.filter(t => !t.available).map(t => t.label).join(', ')}
            </div>
          )}

          {widths.length > 1 && (
            <>
              <label htmlFor="width-select">Width</label>
              <select id="width-select" value={currentWidth} onChange={(e) => handleWidthChange(e.target.value)}>
                {widths.map(w => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </>
          )}

          {hasMultipleEaveOptions && (
            <>
              <label htmlFor="eave-select">Eave Height</label>
              <select id="eave-select" value={variantKey} onChange={(e) => setVariantKey(e.target.value)}>
                {eaveVariants.map(v => (
                  <option key={v.key} value={v.key}>{v.eaveLabel ?? `${v.specs.eaveHeight}m`}</option>
                ))}
              </select>
            </>
          )}

          <label htmlFor="bay-slider">Number of Bays</label>
          <input
            id="bay-slider"
            type="range"
            min={1}
            max={20}
            value={numBays}
            aria-label={`Number of bays: ${numBays} (${numBays * 5}m)`}
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

          <button 
            className={`stats-toggle-btn ${builderMode ? 'active' : ''}`}
            onClick={() => setBuilderMode(!builderMode)}
            style={{ marginTop: 6 }}
            title="Open the Part Builder to place and position individual frame parts with precision controls"
          >
            {builderMode ? 'Exit Builder' : 'Part Builder'}
          </button>
          {builderMode && (
            <div className="builder-mode-notice">
              Part Builder active -- connectors temporarily hidden to allow part placement.
            </div>
          )}
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
          <WebXRController />
          <button className="export-btn" onClick={handleScreenshot} aria-label="Save screenshot">Screenshot</button>
          <button className="export-btn primary" onClick={handleShare} aria-label="Share tent design">Share</button>
        </div>

        {/* Toast notification */}
        {toast && (
          <div className="toast" role="status" aria-live="polite">{toast}</div>
        )}
      </div>
    </SceneErrorBoundary>
  )
}

export default App
