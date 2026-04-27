/**
 * InspectorController
 *
 * Lazy-loads @babylonjs/inspector on Cmd/Ctrl + Shift + I (dev only).
 *
 * Why a controller:
 *   - The Inspector bundle is ~3 MB and is only useful for ad-hoc debugging.
 *   - Dynamic import keeps it out of the production chunk graph entirely
 *     (Vite tree-shakes the side-effect import on builds where the hotkey
 *     handler is never reached, but the lazy boundary is guaranteed).
 *   - Component is rendered inside <BabylonProvider> so it can call useScene().
 *
 * Discipline:
 *   - Only registers the hotkey when import.meta.env.DEV is true; production
 *     builds are completely free of this code path.
 *   - Toggles show/hide so the same hotkey closes the inspector again.
 */

import { useEffect } from 'react'
import { useScene } from '@/engine/BabylonProvider'

export function InspectorController() {
  const scene = useScene()

  useEffect(() => {
    if (!import.meta.env.DEV || !scene) return

    const onKeyDown = async (e: KeyboardEvent) => {
      const isToggle = e.shiftKey && (e.metaKey || e.ctrlKey) && (e.key === 'I' || e.key === 'i')
      if (!isToggle) return
      e.preventDefault()
      try {
        await import('@babylonjs/inspector')
        if (scene.debugLayer.isVisible()) {
          scene.debugLayer.hide()
        } else {
          await scene.debugLayer.show({ embedMode: true, overlay: true })
        }
      } catch (err) {
        console.warn('[Inspector] failed to load:', err)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (scene.debugLayer.isVisible()) scene.debugLayer.hide()
    }
  }, [scene])

  return null
}
