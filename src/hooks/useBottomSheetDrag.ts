import { useEffect, useRef, useCallback } from 'react'

/**
 * Hook that adds touch-drag gesture handling to a mobile bottom sheet.
 * 
 * The sheet can be dragged between collapsed (peekHeight) and expanded
 * (maxHeight) states. A quick flick or drag past the midpoint snaps
 * to the opposite state.
 *
 * @param elementRef - React ref to the bottom-sheet DOM element
 * @param options - Configuration for peek/max heights and breakpoint
 */
interface BottomSheetOptions {
  /** Height when collapsed (px). Default 80 */
  peekHeight?: number
  /** Max expanded height (px). Default 280 */
  maxHeight?: number
  /** Viewport width below which the sheet behavior activates. Default 768 */
  mobileBreakpoint?: number
}

export function useBottomSheetDrag(
  elementRef: React.RefObject<HTMLElement | null>,
  options: BottomSheetOptions = {}
) {
  const {
    peekHeight = 80,
    maxHeight = 280,
    mobileBreakpoint = 768,
  } = options

  const dragStateRef = useRef({
    isDragging: false,
    startY: 0,
    startHeight: 0,
    currentHeight: maxHeight,
    collapsed: false,
  })

  const isMobile = useCallback(() => {
    return typeof window !== 'undefined' && window.innerWidth < mobileBreakpoint
  }, [mobileBreakpoint])

  useEffect(() => {
    const el = elementRef.current
    if (!el) return

    const state = dragStateRef.current

    function setHeight(h: number) {
      const clamped = Math.max(peekHeight, Math.min(maxHeight, h))
      state.currentHeight = clamped
      el!.style.maxHeight = `${clamped}px`
      el!.style.transition = 'none'
    }

    function snapTo(collapsed: boolean) {
      state.collapsed = collapsed
      const target = collapsed ? peekHeight : maxHeight
      state.currentHeight = target
      el!.style.transition = 'max-height 0.3s ease'
      el!.style.maxHeight = `${target}px`
    }

    function onTouchStart(e: TouchEvent) {
      if (!isMobile()) return

      // Only start drag from the top ~40px (drag handle area)
      const rect = el!.getBoundingClientRect()
      const touchY = e.touches[0].clientY
      const relativeY = touchY - rect.top
      if (relativeY > 40) return

      state.isDragging = true
      state.startY = touchY
      state.startHeight = state.currentHeight
    }

    function onTouchMove(e: TouchEvent) {
      if (!state.isDragging) return
      e.preventDefault()

      const deltaY = state.startY - e.touches[0].clientY
      setHeight(state.startHeight + deltaY)
    }

    function onTouchEnd(e: TouchEvent) {
      if (!state.isDragging) return
      state.isDragging = false

      const endY = e.changedTouches[0].clientY
      const velocity = state.startY - endY // positive = swipe up

      const midpoint = (peekHeight + maxHeight) / 2

      // Quick flick detection (>50px movement)
      if (Math.abs(velocity) > 50) {
        snapTo(velocity < 0) // swipe down = collapse
      } else {
        // Snap to nearest state
        snapTo(state.currentHeight < midpoint)
      }
    }

    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
    }
  }, [elementRef, peekHeight, maxHeight, isMobile])
}
