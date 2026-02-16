/**
 * BabylonProvider — Pure Babylon.js engine + scene bootstrap
 *
 * Replaces react-babylonjs <FallbackEngine>/<Scene> with a direct WebGPU-first
 * engine initialisation.  Provides `useScene()` and `useEngine()` hooks via
 * React context so every child component (SceneSetup, frame parts, covers, …)
 * can access the scene imperatively — exactly as before, but without the
 * react-babylonjs reconciler dependency.
 */

import {
  type FC,
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Engine } from '@babylonjs/core/Engines/engine'
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine'
import { Scene } from '@babylonjs/core/scene'
import '@babylonjs/loaders/glTF'

// ─── Module-level engine type cache ──────────────────────────────────────────
// Survives React StrictMode double-mount.  Once we know WebGPU fails for this
// browser session we never attempt it again (avoids the "fatal error" log on
// the second mount when the canvas GPU context is already consumed/lost).

let engineTypeDecision: 'webgpu' | 'webgl' | null = null

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
  children: ReactNode
}

export const BabylonProvider: FC<BabylonProviderProps> = ({
  canvasId = 'babylon-canvas',
  children,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [ctx, setCtx] = useState<BabylonContextValue | null>(null)

  // Keep refs for cleanup — avoids stale-closure issues
  const engineRef = useRef<Engine | WebGPUEngine | null>(null)
  const sceneRef = useRef<Scene | null>(null)

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

      // ── Create engine ──
      if (engineTypeDecision === 'webgpu') {
        try {
          const gpuEngine = new WebGPUEngine(canvas, {
            adaptToDeviceRatio: true,
            antialias: true,
          })
          await gpuEngine.initAsync()
          engine = gpuEngine
          console.log('[Babylon] WebGPU engine initialised')
        } catch (err) {
          // WebGPU structurally supported but init failed (e.g. canvas context
          // issue, GPU adapter lost).  Lock to WebGL for this session.
          engineTypeDecision = 'webgl'
          console.warn('[Babylon] WebGPU init failed, falling back to WebGL:', err)
          engine = new Engine(canvas, true, { adaptToDeviceRatio: true })
          console.log('[Babylon] WebGL fallback engine initialised')
        }
      } else {
        engine = new Engine(canvas, true, { adaptToDeviceRatio: true })
        console.log('[Babylon] WebGL engine initialised')
      }

      if (disposed) {
        engine.dispose()
        return
      }

      const scene = new Scene(engine)

      engineRef.current = engine
      sceneRef.current = scene

      // Render loop — guard against missing camera (SceneSetup creates it
      // after this effect runs; without the guard Babylon throws "No camera").
      engine.runRenderLoop(() => {
        if (scene.activeCamera) {
          scene.render()
        }
      })

      // Resize handling
      const onResize = () => engine.resize()
      window.addEventListener('resize', onResize)

      // Expose via context
      setCtx({ engine, scene, canvas })

      // Store the resize handler for cleanup
      ;(engine as unknown as Record<string, unknown>).__resizeHandler = onResize
    }

    init()

    return () => {
      disposed = true
      const engine = engineRef.current
      const scene = sceneRef.current

      if (engine) {
        const onResize = (engine as unknown as Record<string, unknown>).__resizeHandler as (() => void) | undefined
        if (onResize) window.removeEventListener('resize', onResize)
        engine.stopRenderLoop()
      }
      scene?.dispose()
      engine?.dispose()

      engineRef.current = null
      sceneRef.current = null
      setCtx(null)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <canvas
        ref={canvasRef}
        id={canvasId}
        style={{ width: '100%', height: '100%', display: 'block', outline: 'none' }}
        touch-action="none"
      />
      {ctx && (
        <BabylonContext.Provider value={ctx}>
          {children}
        </BabylonContext.Provider>
      )}
    </>
  )
}
