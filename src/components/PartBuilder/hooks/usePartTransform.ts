import { useCallback, useRef, useState } from 'react'
import { TransformNode } from '@babylonjs/core'
import type { TransformValues } from '../types'
import { ZERO_TRANSFORM } from '../types'
import { roundTo4, snapToGrid, degToRad } from '../utils'

interface UsePartTransformOptions {
  onAfterChange: () => void
  pushUndo: () => void
}

export interface UsePartTransformReturn {
  partNodeRef: React.RefObject<TransformNode | null>
  transform: TransformValues
  step: number
  rotStep: number
  snapEnabled: boolean
  gridSize: number

  setStep: (s: number) => void
  setRotStep: (s: number) => void
  setSnapEnabled: (on: boolean) => void
  setGridSize: (g: number) => void

  readTransform: () => TransformValues
  writeTransform: (v: TransformValues) => void
  syncFromNode: () => void
  setTransformDirect: (v: TransformValues) => void

  nudge: (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void
  nudgeRotation: (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void
  setField: (field: keyof TransformValues, val: number) => void
  align: (preset: string, specs: AlignSpecs) => void
  reset: (specs: AlignSpecs, firstLineZ: number) => void
  quickSnap: (x: number, y: number, z: number) => void
  snapToLine: (lineZ: number, side: 'right' | 'left', specs: AlignSpecs) => void
}

export interface AlignSpecs {
  halfWidth: number
  eaveHeight: number
  baseplateTop: number
  halfLength: number
}

/**
 * Manages position / rotation / scale state for the active part node.
 */
export function usePartTransform(
  options: UsePartTransformOptions
): UsePartTransformReturn {
  const { onAfterChange, pushUndo } = options
  const partNodeRef = useRef<TransformNode | null>(null)

  const [transform, setTransform] = useState<TransformValues>(ZERO_TRANSFORM)
  // Ref mirror of transform so setField doesn't depend on transform state,
  // preventing identity churn that would re-render all panels on every keystroke.
  const transformRef = useRef<TransformValues>(ZERO_TRANSFORM)
  const [step, setStep] = useState(0.01)
  const [rotStep, setRotStep] = useState(5)
  const [snapEnabled, setSnapEnabled] = useState(false)
  const [gridSize, setGridSize] = useState(0.05)

  const readTransform = useCallback((): TransformValues => {
    const n = partNodeRef.current
    if (!n) return ZERO_TRANSFORM
    n.computeWorldMatrix(true)
    return {
      px: roundTo4(n.position.x),
      py: roundTo4(n.position.y),
      pz: roundTo4(n.position.z),
      rx: roundTo4(n.rotation.x),
      ry: roundTo4(n.rotation.y),
      rz: roundTo4(n.rotation.z),
      sx: roundTo4(n.scaling.x),
      sy: roundTo4(n.scaling.y),
      sz: roundTo4(n.scaling.z),
    }
  }, [])

  const writeTransform = useCallback((v: TransformValues) => {
    const n = partNodeRef.current
    if (!n) return
    n.position.set(v.px, v.py, v.pz)
    n.rotation.set(v.rx, v.ry, v.rz)
    n.scaling.set(v.sx, v.sy, v.sz)
  }, [])

  const syncFromNode = useCallback(() => {
    let v = readTransform()
    if (snapEnabled) {
      v = {
        ...v,
        px: roundTo4(snapToGrid(v.px, gridSize)),
        py: roundTo4(snapToGrid(v.py, gridSize)),
        pz: roundTo4(snapToGrid(v.pz, gridSize)),
      }
      writeTransform(v)
    }
    transformRef.current = v
    setTransform(v)
    onAfterChange()
  }, [readTransform, writeTransform, snapEnabled, gridSize, onAfterChange])

  const setTransformDirect = useCallback((v: TransformValues) => {
    writeTransform(v)
    transformRef.current = v
    setTransform(v)
  }, [writeTransform])

  const nudge = useCallback(
    (axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
      pushUndo()
      const n = partNodeRef.current
      if (!n) return
      const delta = step * dir
      if (axis === 'x') n.position.x += delta
      else if (axis === 'y') n.position.y += delta
      else n.position.z += delta
      syncFromNode()
    },
    [step, pushUndo, syncFromNode]
  )

  const nudgeRotation = useCallback(
    (axis: 'x' | 'y' | 'z', dir: 1 | -1) => {
      pushUndo()
      const n = partNodeRef.current
      if (!n) return
      const r = degToRad(rotStep) * dir
      if (axis === 'x') n.rotation.x += r
      else if (axis === 'y') n.rotation.y += r
      else n.rotation.z += r
      syncFromNode()
    },
    [rotStep, pushUndo, syncFromNode]
  )

  const setField = useCallback(
    (field: keyof TransformValues, val: number) => {
      pushUndo()
      const v = { ...transformRef.current, [field]: val }
      writeTransform(v)
      transformRef.current = v
      setTransform(v)
      onAfterChange()
    },
    [writeTransform, pushUndo, onAfterChange]
  )

  const align = useCallback(
    (preset: string, specs: AlignSpecs) => {
      pushUndo()
      const n = partNodeRef.current
      if (!n) return
      switch (preset) {
        case 'ground':
          n.position.y = specs.baseplateTop
          break
        case 'eave':
          n.position.y = specs.baseplateTop + specs.eaveHeight
          break
        case 'right':
          n.position.x = -specs.halfWidth
          break
        case 'left':
          n.position.x = specs.halfWidth
          break
        case 'front':
          n.position.z = -specs.halfLength
          break
        case 'back':
          n.position.z = specs.halfLength
          break
        case 'cx':
          n.position.x = 0
          break
        case 'cz':
          n.position.z = 0
          break
        case 'r0':
          n.rotation.set(0, 0, 0)
          break
      }
      syncFromNode()
    },
    [pushUndo, syncFromNode]
  )

  const reset = useCallback(
    (specs: AlignSpecs, firstLineZ: number) => {
      pushUndo()
      const n = partNodeRef.current
      if (!n) return
      n.position.set(-specs.halfWidth, specs.baseplateTop + specs.eaveHeight, firstLineZ)
      n.rotation.set(0, 0, 0)
      n.scaling.set(1, 1, 1)
      syncFromNode()
    },
    [pushUndo, syncFromNode]
  )

  const quickSnap = useCallback(
    (x: number, y: number, z: number) => {
      pushUndo()
      const n = partNodeRef.current
      if (!n) return
      n.position.set(x, y, z)
      syncFromNode()
    },
    [pushUndo, syncFromNode]
  )

  const snapToLine = useCallback(
    (lineZ: number, side: 'right' | 'left', specs: AlignSpecs) => {
      pushUndo()
      const n = partNodeRef.current
      if (!n) return
      n.position.set(
        side === 'right' ? -specs.halfWidth : specs.halfWidth,
        specs.baseplateTop + specs.eaveHeight,
        lineZ
      )
      syncFromNode()
    },
    [pushUndo, syncFromNode]
  )

  return {
    partNodeRef,
    transform,
    step,
    rotStep,
    snapEnabled,
    gridSize,
    setStep,
    setRotStep,
    setSnapEnabled,
    setGridSize,
    readTransform,
    writeTransform,
    syncFromNode,
    setTransformDirect,
    nudge,
    nudgeRotation,
    setField,
    align,
    reset,
    quickSnap,
    snapToLine,
  }
}
