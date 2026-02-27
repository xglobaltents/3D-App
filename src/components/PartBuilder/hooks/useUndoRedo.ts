import { useCallback, useRef, useState } from 'react'
import type { TransformValues, UndoEntry, AxisScale } from '../types'

interface UseUndoRedoReturn {
  pushUndo: (transform: TransformValues, axisScale: AxisScale) => void
  undo: (
    currentTransform: TransformValues,
    currentScale: AxisScale,
    restore: (entry: UndoEntry) => void
  ) => void
  redo: (
    currentTransform: TransformValues,
    currentScale: AxisScale,
    restore: (entry: UndoEntry) => void
  ) => void
  undoCount: number
  redoCount: number
  resetStacks: () => void
}

const MAX_UNDO = 50

/**
 * Manages undo/redo stacks for part transform changes.
 */
export function useUndoRedo(): UseUndoRedoReturn {
  const undoStack = useRef<UndoEntry[]>([])
  const redoStack = useRef<UndoEntry[]>([])
  const [undoCount, setUndoCount] = useState(0)
  const [redoCount, setRedoCount] = useState(0)

  const pushUndo = useCallback((transform: TransformValues, axisScale: AxisScale) => {
    undoStack.current.push({ transform: { ...transform }, axisScale: { ...axisScale } })
    if (undoStack.current.length > MAX_UNDO) {
      undoStack.current.shift()
    }
    redoStack.current = []
    setUndoCount(undoStack.current.length)
    setRedoCount(0)
  }, [])

  const undo = useCallback(
    (
      currentTransform: TransformValues,
      currentScale: AxisScale,
      restore: (entry: UndoEntry) => void
    ) => {
      if (!undoStack.current.length) return
      redoStack.current.push({
        transform: { ...currentTransform },
        axisScale: { ...currentScale },
      })
      const entry = undoStack.current.pop()!
      restore(entry)
      setUndoCount(undoStack.current.length)
      setRedoCount(redoStack.current.length)
    },
    []
  )

  const redo = useCallback(
    (
      currentTransform: TransformValues,
      currentScale: AxisScale,
      restore: (entry: UndoEntry) => void
    ) => {
      if (!redoStack.current.length) return
      undoStack.current.push({
        transform: { ...currentTransform },
        axisScale: { ...currentScale },
      })
      const entry = redoStack.current.pop()!
      restore(entry)
      setUndoCount(undoStack.current.length)
      setRedoCount(redoStack.current.length)
    },
    []
  )

  const resetStacks = useCallback(() => {
    undoStack.current = []
    redoStack.current = []
    setUndoCount(0)
    setRedoCount(0)
  }, [])

  return { pushUndo, undo, redo, undoCount, redoCount, resetStacks }
}
