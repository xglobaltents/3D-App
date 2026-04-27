/**
 * WebXRController
 *
 * Lazy-initialised WebXR entry point. Renders a small "Enter VR" button
 * only when:
 *   - The browser has `navigator.xr`
 *   - `navigator.xr.isSessionSupported('immersive-vr')` returns true
 *   - The page is on HTTPS (or localhost) — required by WebXR
 *
 * Why lazy:
 *   - `scene.createDefaultXRExperienceAsync` adds default UI, controller
 *     models, teleport meshes, and a render-loop hook even if VR is never
 *     entered. We avoid all that cost on desktop sessions.
 *   - The XR helper is built only on first button click, then reused.
 *
 * Discipline:
 *   - The XR helper is disposed in cleanup so unmounting the controller
 *     ends any active session and frees GPU/sensor resources.
 *   - Errors are surfaced via console.warn — VR is opt-in, so failures
 *     should not block the main app.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import type { WebXRDefaultExperience } from '@babylonjs/core'
import { getActiveBabylonContext } from '@/engine/BabylonProvider'

export function WebXRController() {
  const helperRef = useRef<WebXRDefaultExperience | null>(null)
  const [supported, setSupported] = useState(false)
  const [busy, setBusy] = useState(false)

  // Capability probe — runs once on mount
  useEffect(() => {
    let cancelled = false
    if (typeof navigator === 'undefined' || !navigator.xr) return
    navigator.xr.isSessionSupported('immersive-vr')
      .then(ok => { if (!cancelled) setSupported(ok) })
      .catch(() => { /* silent — VR not available */ })
    return () => { cancelled = true }
  }, [])

  // Cleanup on unmount: end any active session, dispose the helper
  useEffect(() => {
    return () => {
      const h = helperRef.current
      helperRef.current = null
      if (!h) return
      try { h.baseExperience.exitXRAsync().catch(() => {}) } catch { /* ignore */ }
      try { h.dispose() } catch { /* ignore */ }
    }
  }, [])

  const handleEnter = useCallback(async () => {
    if (busy) return
    const ctx = getActiveBabylonContext()
    if (!ctx?.scene) return
    setBusy(true)
    try {
      if (!helperRef.current) {
        helperRef.current = await ctx.scene.createDefaultXRExperienceAsync({
          uiOptions: { sessionMode: 'immersive-vr' },
          disableDefaultUI: true, // we provide our own button
        })
      }
      await helperRef.current.baseExperience.enterXRAsync(
        'immersive-vr',
        'local-floor',
      )
    } catch (err) {
      console.warn('[WebXR] entry failed:', err)
    } finally {
      setBusy(false)
    }
  }, [busy])

  if (!supported) return null

  return (
    <button
      className="export-btn"
      onClick={handleEnter}
      disabled={busy}
      aria-label="Enter VR mode"
      style={{ marginRight: 8 }}
    >
      {busy ? 'Loading VR…' : 'Enter VR'}
    </button>
  )
}
