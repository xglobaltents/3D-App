import { useEffect, useRef } from 'react'
import type { Scene } from '@babylonjs/core'

/**
 * Keeps the canvas ref available for the scene.
 * Camera is NOT locked — users can freely orbit at all times.
 */
export function useCameraLock(scene: Scene | null) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!scene) return
    const canvas = scene.getEngine().getRenderingCanvas()
    canvasRef.current = canvas
  }, [scene])
}
