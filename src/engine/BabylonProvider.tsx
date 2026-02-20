/**
 * BabylonProvider — Pure Babylon.js engine + scene bootstrap
 *
 * Replaces react-babylonjs <FallbackEngine>/<Scene> with a direct WebGPU-first
 * engine initialisation.  Provides `useScene()` and `useEngine()` hooks via
 * React context so every child component (SceneSetup, frame parts, covers, …)
 * can access the scene imperatively.
 *
 * Performance features:
 *   - Debounced resize via ResizeObserver (catches container + window resizes)
 *   - Hardware scaling capped at 2× by default (configurable via maxDpr prop)
 *   - Render loop pauses when tab is hidden (Page Visibility API)
 *   - Stencil buffer enabled for shadows + post-processing
 */

import {
  type FC,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { Scene } from '@babylonjs/core/scene'
import '@babylonjs/loaders/glTF'

// ─── Module-level engine type cache ──────────────────────────────────────────
// Survives React StrictMode double-mount.  Once we know WebGPU fails for this
// browser session we never attempt it again.

let engineTypeDecision: 'webgpu' | 'webgl' | null = null

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default max hardware scaling ratio — caps render resolution on high-DPI screens */
const DEFAULT_MAX_DPR = 2

/** Resize debounce delay in ms */
const RESIZE_DEBOUNCE_MS = 150

// ─── Context ─────────────────────────────────────────────────────────────────

interface BabylonContextValue {
  engine: Engine | WebGPUEngine
  scene: Scene
  canvas: HTMLCanvasElement
}

const BabylonContext = createContext<BabylonContextValue | null>(null)

/** Drop-in replacement for the react-babylonjs `useScene()` hook. */
export function useScene(): Scene | null {
  const ctx = useContext(BabylonContext)
  return ctx?.scene ?? null
}

/** Access the underlying engine (useful for resize, screenshots, etc.) */
export function useEngine(): Engine | WebGPUEngine | null {
  const ctx = useContext(BabylonContext)
  return ctx?.engine ?? null
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface BabylonProviderProps {
  /** DOM id applied to the <canvas> element (default: "babylon-canvas") */
  canvasId?: string
  /**
   * Maximum device pixel ratio for rendering.
   *   - Default: 2 (Retina quality, good performance)
   *   - Set to Infinity for uncapped ultra quality on powerful GPUs
   *   - Set to 1 for performance mode (no high-DPI scaling)
   */
  maxDpr?: number
  children: ReactNode
}

export const BabylonProvider: FC<BabylonProviderProps> = ({
  canvasId = 'babylon-canvas',
  maxDpr = DEFAULT_MAX_DPR,
  children,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ctx, setCtx] = useState<BabylonContextValue | null>(null)

  // Refs for cleanup — avoids stale-closure issues
  const engineRef = useRef<Engine | WebGPUEngine | null>(null)
  const sceneRef = useRef<Scene | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const visibilityHandlerRef = useRef<(() => void) | null>(null)

  // Debounced resize — shared between ResizeObserver and window fallback
  const handleResize = useCallback(() => {
    if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
    resizeTimerRef.current = setTimeout(() => {
      const engine = engineRef.current
      if (engine) engine.resize()
    }, RESIZE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let disposed = false

    const init = async () => {
      let engine: Engine | WebGPUEngine

      // ── Determine engine type (cached across StrictMode remounts) ──
      if (engineTypeDecision === null) {
        try {
          const supported = await WebGPUEngine.IsSupportedAsync
          engineTypeDecision = supported ? 'webgpu' : 'webgl'
        } catch {
          engineTypeDecision = 'webgl'
        }
      }

      if (disposed) return

      // ── Shared engine options ──
      const sharedOpts = {
        adaptToDeviceRatio: true,
        antialias: true,
        stencil: true,
        powerPreference: 'high-performance' as const,
      }

      // ── Create engine ──
      if (engineTypeDecision === 'webgpu') {
        try {
          const gpuEngine = new WebGPUEngine(canvas, sharedOpts)
          await gpuEngine.initAsync()
          engine = gpuEngine
          console.log('[Babylon] WebGPU engine initialised')
        } catch (err) {
          engineTypeDecision = 'webgl'
          console.warn('[Babylon] WebGPU init failed, falling back to WebGL:', err)
          engine = new Engine(canvas, true, sharedOpts)
          console.log('[Babylon] WebGL fallback engine initialised')
        }
      } else {
        engine = new Engine(canvas, true, sharedOpts)
        console.log('[Babylon] WebGL engine initialised')
      }

      if (disposed) {
        engine.dispose()
        return
      }

      // ── Cap hardware scaling on high-DPI screens ──
      // adaptToDeviceRatio sets hardwareScalingLevel to 1/devicePixelRatio.
      // On a 3× screen that means rendering 9× pixels for no visible gain.
      // Cap it so we never exceed maxDpr × CSS resolution.
      //
      // hardwareScalingLevel is inverse: higher value = lower resolution
      //   dpr=3, maxDpr=2 → scaling = 3/2 = 1.5 (renders at 2× not 3×)
      //   dpr=2, maxDpr=2 → no change needed (already at 2×)
      //   dpr=2, maxDpr=Infinity → no change (uncapped)
      const dpr = window.devicePixelRatio || 1
      if (Number.isFinite(maxDpr) && dpr > maxDpr) {
        engine.setHardwareScalingLevel(dpr / maxDpr)
        console.log(
          `[Babylon] DPR capped: device=${dpr}, max=${maxDpr}, ` +
          `scaling=${(dpr / maxDpr).toFixed(2)}`
        )
      }

      const scene = new Scene(engine)

      engineRef.current = engine
      sceneRef.current = scene

      // ── Render loop with camera guard ──
      // Without the guard Babylon throws "No camera" before SceneSetup mounts.
      engine.runRenderLoop(() => {
        if (scene.activeCamera) {
          scene.render()
        }
      })

      // ── Resize: prefer ResizeObserver (catches container + window resizes) ──
      // ResizeObserver detects sidebar toggles, panel drags, and container
      // layout shifts that window.resize misses entirely.
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(handleResize)
        ro.observe(canvas)
        resizeObserverRef.current = ro
      } else {
        // Fallback for older browsers
        window.addEventListener('resize', handleResize)
      }

      // ── Page Visibility: pause render loop when tab is hidden ──
      // Saves GPU + battery when user switches tabs.
      const onVisibilityChange = () => {
        if (document.hidden) {
          engine.stopRenderLoop()
        } else {
          engine.runRenderLoop(() => {
            if (scene.activeCamera) {
              scene.render()
            }
          })
        }
      }
      document.addEventListener('visibilitychange', onVisibilityChange)
      visibilityHandlerRef.current = onVisibilityChange

      // Expose via context
      setCtx({ engine, scene, canvas })
    }

    init()

    return () => {
      disposed = true
      const engine = engineRef.current
      const scene = sceneRef.current

      // Resize cleanup
      if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current)
      if (resizeObserverRef.current) {
        resizeObserverRef.current.disconnect()
        resizeObserverRef.current = null
      } else {
        window.removeEventListener('resize', handleResize)
      }

      // Visibility cleanup
      if (visibilityHandlerRef.current) {
        document.removeEventListener('visibilitychange', visibilityHandlerRef.current)
        visibilityHandlerRef.current = null
      }

      // Engine + scene cleanup
      if (engine) engine.stopRenderLoop()
      scene?.dispose()
      engine?.dispose()

      engineRef.current = null
      sceneRef.current = null
      setCtx(null)
    }
  }, [handleResize, maxDpr])

  return (
    <>
      <canvas
        ref={canvasRef}
        id={canvasId}
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          outline: 'none',
          touchAction: 'none',
        }}
      />
      {ctx && (
        <BabylonContext.Provider value={ctx}>
          {children}
        </BabylonContext.Provider>
      )}
    </>
  )
}