/**
 * PartBuilder — Refactored orchestrator component
 *
 * This is a thin composition layer that wires together extracted hooks
 * and panel components. Each concern lives in its own file:
 *
 * hooks/useUndoRedo.ts      — Undo/redo stacks
 * hooks/useCameraLock.ts    — Canvas ref management
 * hooks/usePartTransform.ts — Position/rotation/scale state
 * hooks/useMirrorSystem.ts  — Mirror clones (X, Z, XZ)
 * hooks/useGizmoManager.ts  — 3D gizmo lifecycle
 * hooks/usePartLoader.ts    — GLB loading + auto-scale + bounding box
 * hooks/usePartStorage.ts   — localStorage save/load
 *
 * panels/MovePanel.tsx      — XYZ position controls
 * panels/RotatePanel.tsx    — XYZ rotation controls
 * panels/MirrorPanel.tsx    — Mirror axis toggles + presets
 * panels/SnapPanel.tsx      — Frame line + grid snap
 * panels/SavedPanel.tsx     — Save/load configurations
 */

import { type FC, useCallback, useEffect, useMemo, useRef, useState, memo } from 'react'
import {
  TransformNode,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
} from '@babylonjs/core'
import { useScene } from '@/engine/BabylonProvider'
import type { TentSpecs } from '@/types'
import type { MirrorFlags, PanelTab, TransformValues, SavedConfig } from './types'
import { EMPTY_MIRRORS } from './types'
import { roundTo4, radToDeg, safeDispose, safeDisposeArray } from './utils'
import { GLB_PARTS, MIRROR_CONFIGS } from './catalogue'
import type { AlignSpecs } from './hooks/usePartTransform'

import { useUndoRedo } from './hooks/useUndoRedo'
import { useCameraLock } from './hooks/useCameraLock'
import { usePartTransform } from './hooks/usePartTransform'
import { useMirrorSystem, countMirrors } from './hooks/useMirrorSystem'
import { useGizmoManager } from './hooks/useGizmoManager'
import { usePartLoader } from './hooks/usePartLoader'
import { usePartStorage } from './hooks/usePartStorage'

import { MovePanel } from './panels/MovePanel'
import { RotatePanel } from './panels/RotatePanel'
import { MirrorPanel } from './panels/MirrorPanel'
import { SnapPanel } from './panels/SnapPanel'
import { SavedPanel } from './panels/SavedPanel'

import styles from './PartBuilder.module.css'

/* ═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  specs: TentSpecs
  numBays: number
}

export const PartBuilder: FC<Props> = memo(({ specs, numBays }) => {
  const scene = useScene()

  // ── Derived measurements (memoized) ────────────────────────────────────
  const { baseplateTop, halfLength, lineZs } = useMemo(() => {
    const bpTop = specs.baseplate?.height ?? 0
    const halfLen = (numBays * specs.bayDistance) / 2
    const nLines = numBays + 1
    const zs = Array.from({ length: nLines }, (_, i) => i * specs.bayDistance - halfLen)
    return { baseplateTop: bpTop, halfLength: halfLen, lineZs: zs }
  }, [specs, numBays])

  const alignSpecs = useMemo<AlignSpecs>(
    () => ({
      halfWidth: specs.halfWidth,
      eaveHeight: specs.eaveHeight,
      baseplateTop,
      halfLength,
    }),
    [specs.halfWidth, specs.eaveHeight, baseplateTop, halfLength]
  )

  // ── Refs ───────────────────────────────────────────────────────────────
  const rootRef = useRef<TransformNode | null>(null)
  const refGeoRef = useRef<Mesh[]>([])

  // ── UI state ───────────────────────────────────────────────────────────
  const [selectedPart, setSelectedPart] = useState(0)
  const [mirrors, setMirrors] = useState<MirrorFlags>(EMPTY_MIRRORS)
  const [tab, setTab] = useState<PanelTab>('move')
  const [copied, setCopied] = useState(false)
  const [showGizmo, setShowGizmo] = useState(false)
  const [gizmoSize, setGizmoSize] = useState(3)

  // ── Undo / Redo ────────────────────────────────────────────────────────
  const { pushUndo, undo, redo, undoCount, redoCount, resetStacks } = useUndoRedo()

  // ── Camera ─────────────────────────────────────────────────────────────
  useCameraLock(scene)

  // ── Mirror system ──────────────────────────────────────────────────────
  // (forward-declare partTransform's ref for mirror system)
  const partNodeRef = useRef<TransformNode | null>(null)
  const modelNodeRef = useRef<TransformNode | null>(null)
  const meshesRef = useRef<Mesh[]>([])

  const mirrorSystem = useMirrorSystem({
    rootRef,
    partNodeRef,
    modelNodeRef,
    meshesRef,
  })

  // ── Part transform ─────────────────────────────────────────────────────
  const onAfterTransformChange = useCallback(() => {
    mirrorSystem.updateMirrorPositions()
    if (scene) partLoader.updateBoundingBox(scene)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  const pushUndoFromTransform = useCallback(() => {
    pushUndo(partTransformHook.readTransform(), partLoader.uniformScale)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushUndo])

  const partTransformHook = usePartTransform({
    onAfterChange: onAfterTransformChange,
    pushUndo: pushUndoFromTransform,
  })

  // Sync the shared ref
  partNodeRef.current = partTransformHook.partNodeRef.current

  // ── Part loader ────────────────────────────────────────────────────────
  const onPartLoaded = useCallback(
    (partNode: TransformNode, modelNode: TransformNode, loadedMeshes: Mesh[]) => {
      partTransformHook.partNodeRef.current = partNode
      partNodeRef.current = partNode
      modelNodeRef.current = modelNode
      meshesRef.current = loadedMeshes

      // Position at default location
      partNode.position.set(
        -specs.halfWidth,
        baseplateTop + specs.eaveHeight,
        lineZs[0]
      )

      // Create mirrors
      if (scene) {
        mirrorSystem.createMirrors(scene)
        mirrorSystem.syncMirrorVisibility(mirrors)
      }

      // Sync transform state
      partTransformHook.syncFromNode()
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [specs, baseplateTop, lineZs, scene, mirrors]
  )

  const onBeforeLoad = useCallback(() => {
    mirrorSystem.disposeMirrors()
    resetStacks()
  }, [mirrorSystem, resetStacks])

  const partLoader = usePartLoader({
    rootRef,
    onLoaded: onPartLoaded,
    onBeforeLoad,
  })

  // ── Gizmo manager ─────────────────────────────────────────────────────
  const onGizmoDrag = useCallback(() => {
    partTransformHook.syncFromNode()
  }, [partTransformHook])

  const onGizmoDragEnd = useCallback(() => {
    pushUndo(partTransformHook.readTransform(), partLoader.uniformScale)
    partTransformHook.syncFromNode()
  }, [pushUndo, partTransformHook, partLoader.uniformScale])

  useGizmoManager({
    scene,
    showGizmo,
    gizmoSize,
    partNodeRef: partTransformHook.partNodeRef,
    onDrag: onGizmoDrag,
    onDragEnd: onGizmoDragEnd,
  })

  // ── Undo/redo restore callback ─────────────────────────────────────────
  const restoreEntry = useCallback(
    (entry: { transform: TransformValues; uniformScale: number }) => {
      partTransformHook.writeTransform(entry.transform)
      partTransformHook.setTransformDirect(entry.transform)
      partLoader.applyScale(entry.uniformScale)
      for (const m of mirrorSystem.mirrorInstancesRef.current) {
        m.modelNode.scaling.setAll(entry.uniformScale)
      }
      mirrorSystem.updateMirrorPositions()
      if (scene) partLoader.updateBoundingBox(scene)
    },
    [partTransformHook, partLoader, mirrorSystem, scene]
  )

  const handleUndo = useCallback(() => {
    undo(partTransformHook.readTransform(), partLoader.uniformScale, restoreEntry)
  }, [undo, partTransformHook, partLoader.uniformScale, restoreEntry])

  const handleRedo = useCallback(() => {
    redo(partTransformHook.readTransform(), partLoader.uniformScale, restoreEntry)
  }, [redo, partTransformHook, partLoader.uniformScale, restoreEntry])

  // ── Storage ────────────────────────────────────────────────────────────
  const handleStorageLoad = useCallback(
    (config: SavedConfig) => {
      pushUndo(partTransformHook.readTransform(), partLoader.uniformScale)
      setSelectedPart(config.partIndex)
      // Wait for part to load then apply saved state
      setTimeout(() => {
        partTransformHook.writeTransform(config.transform)
        partTransformHook.setTransformDirect(config.transform)
        partLoader.applyScale(config.uniformScale)
        setMirrors(config.mirrors)
        for (const m of mirrorSystem.mirrorInstancesRef.current) {
          m.modelNode.scaling.setAll(config.uniformScale)
        }
        mirrorSystem.updateMirrorPositions()
        if (scene) partLoader.updateBoundingBox(scene)
      }, 500)
    },
    [pushUndo, partTransformHook, partLoader, mirrorSystem, scene]
  )

  const storage = usePartStorage({ onLoad: handleStorageLoad })

  // ── Reference geometry ─────────────────────────────────────────────────
  const createReferenceGeometry = useCallback(
    (sc: NonNullable<typeof scene>) => {
      safeDisposeArray(refGeoRef.current as unknown as (Mesh | null)[])
      refGeoRef.current = []

      const refMat = new StandardMaterial('ref-mat', sc)
      refMat.wireframe = true
      refMat.diffuseColor = new Color3(0.3, 0.5, 0.8)
      refMat.alpha = 0.6

      const hotspotMat = new StandardMaterial('hotspot-mat', sc)
      hotspotMat.diffuseColor = new Color3(0.9, 0.6, 0.1)
      hotspotMat.alpha = 0.4

      const uprightHeight = specs.eaveHeight

      for (let i = 0; i < lineZs.length; i++) {
        const z = lineZs[i]
        for (const side of [-1, 1]) {
          const x = side * specs.halfWidth

          // Wireframe upright
          const upright = MeshBuilder.CreateBox(
            `ref-upright-${i}-${side}`,
            {
              width: specs.profiles.upright.width,
              height: uprightHeight,
              depth: specs.profiles.upright.height,
            },
            sc
          )
          upright.material = refMat
          upright.position.set(x, baseplateTop + uprightHeight / 2, z)
          upright.isPickable = false
          refGeoRef.current.push(upright)

          // Hotspot disc at upright top
          const disc = MeshBuilder.CreateDisc(`ref-disc-${i}-${side}`, { radius: 0.15 }, sc)
          disc.material = hotspotMat
          disc.rotation.x = Math.PI / 2
          disc.position.set(x, baseplateTop + uprightHeight, z)
          disc.isPickable = false
          refGeoRef.current.push(disc)
        }

        // Eave line
        const eaveLine = MeshBuilder.CreateLines(
          `eave-line-${i}`,
          {
            points: [
              new Vector3(-specs.halfWidth, baseplateTop + uprightHeight, z),
              new Vector3(specs.halfWidth, baseplateTop + uprightHeight, z),
            ],
          },
          sc
        )
        eaveLine.color = new Color3(0.4, 0.6, 0.3)
        eaveLine.alpha = 0.3
        eaveLine.isPickable = false
        refGeoRef.current.push(eaveLine as unknown as Mesh)
      }

      // Side beams
      for (const side of [-1, 1]) {
        const pts = lineZs.map((z) => new Vector3(side * specs.halfWidth, baseplateTop + uprightHeight, z))
        if (pts.length >= 2) {
          const beam = MeshBuilder.CreateLines(`ref-beam-${side}`, { points: pts }, sc)
          beam.color = new Color3(0.3, 0.5, 0.8)
          beam.alpha = 0.3
          beam.isPickable = false
          refGeoRef.current.push(beam as unknown as Mesh)
        }
      }

      // Center cross
      const centerZ = MeshBuilder.CreateLines('center-z', {
        points: [
          new Vector3(0, baseplateTop + 0.01, -halfLength),
          new Vector3(0, baseplateTop + 0.01, halfLength),
        ],
      }, sc)
      centerZ.color = new Color3(0.7, 0.3, 0.3)
      centerZ.alpha = 0.25
      centerZ.isPickable = false
      refGeoRef.current.push(centerZ as unknown as Mesh)

      const centerX = MeshBuilder.CreateLines('center-x', {
        points: [
          new Vector3(-specs.halfWidth, baseplateTop + 0.01, 0),
          new Vector3(specs.halfWidth, baseplateTop + 0.01, 0),
        ],
      }, sc)
      centerX.color = new Color3(0.3, 0.7, 0.3)
      centerX.alpha = 0.25
      centerX.isPickable = false
      refGeoRef.current.push(centerX as unknown as Mesh)
    },
    [specs, baseplateTop, lineZs, halfLength]
  )

  // ── Scene setup effect ─────────────────────────────────────────────────
  useEffect(() => {
    if (!scene) return

    const root = new TransformNode('builder-root', scene)
    rootRef.current = root

    createReferenceGeometry(scene)

    return () => {
      safeDisposeArray(refGeoRef.current as unknown as (Mesh | null)[])
      refGeoRef.current = []
      mirrorSystem.disposeMirrors()
      partLoader.disposePart()
      safeDispose(root)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  // Load part on mount and when selection changes (single source of truth)
  useEffect(() => {
    if (scene) partLoader.loadPart(scene, GLB_PARTS[selectedPart])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, selectedPart])

  // Sync mirror visibility when flags change
  useEffect(() => {
    mirrorSystem.syncMirrorVisibility(mirrors)
  }, [mirrors, mirrorSystem])

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const node = partTransformHook.partNodeRef.current
      if (!node) return

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault()
        e.shiftKey ? handleRedo() : handleUndo()
        return
      }

      let nudged = false
      switch (e.key) {
        case 'ArrowRight':
          pushUndoFromTransform()
          node.position.x += partTransformHook.step
          nudged = true
          break
        case 'ArrowLeft':
          pushUndoFromTransform()
          node.position.x -= partTransformHook.step
          nudged = true
          break
        case 'ArrowUp':
          pushUndoFromTransform()
          node.position.z += partTransformHook.step
          nudged = true
          break
        case 'ArrowDown':
          pushUndoFromTransform()
          node.position.z -= partTransformHook.step
          nudged = true
          break
        case 'q':
        case 'Q':
          pushUndoFromTransform()
          node.position.y += partTransformHook.step
          nudged = true
          break
        case 'e':
        case 'E':
          pushUndoFromTransform()
          node.position.y -= partTransformHook.step
          nudged = true
          break
      }
      if (nudged) {
        e.preventDefault()
        partTransformHook.syncFromNode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [partTransformHook, pushUndoFromTransform, handleUndo, handleRedo])

  // ── Scale change handler ───────────────────────────────────────────────
  const handleScaleChange = useCallback(
    (s: number) => {
      pushUndo(partTransformHook.readTransform(), partLoader.uniformScale)
      partLoader.applyScale(s)
      for (const m of mirrorSystem.mirrorInstancesRef.current) {
        m.modelNode.scaling.setAll(s)
      }
      mirrorSystem.updateMirrorPositions()
      if (scene) partLoader.updateBoundingBox(scene)
    },
    [pushUndo, partTransformHook, partLoader, mirrorSystem, scene]
  )

  // ── Copy / Export ──────────────────────────────────────────────────────
  const handleCopy = useCallback(
    async (asCode: boolean) => {
      const v = partTransformHook.readTransform()
      const modelScale = partLoader.uniformScale
      const glb = GLB_PARTS[selectedPart]
      const pos = new Vector3(v.px, v.py, v.pz)
      const rot = new Vector3(v.rx, v.ry, v.rz)

      let text: string
      if (asCode) {
        let code = `// -- ${glb.label} --\n`
        code += `const meshes = await loadGLB(scene, '${glb.folder}', '${glb.file}')\n`
        code += `modelNode.scaling.setAll(${modelScale})\n\n`
        code += `// Original\n`
        code += `node.position.set(${v.px}, ${v.py}, ${v.pz})\n`
        code += `node.rotation.set(${v.rx}, ${v.ry}, ${v.rz}) // (${radToDeg(v.rx)}deg, ${radToDeg(v.ry)}deg, ${radToDeg(v.rz)}deg)\n`

        for (const cfg of MIRROR_CONFIGS) {
          if (!mirrors[cfg.axis]) continue
          const mp = cfg.posFn(pos)
          const mr = cfg.rotFn(rot)
          code += `\n// Mirror ${cfg.axis.toUpperCase()} -- ${cfg.desc}\n`
          code += `mirror${cfg.axis.toUpperCase()}.position.set(${roundTo4(mp.x)}, ${roundTo4(mp.y)}, ${roundTo4(mp.z)})\n`
          code += `mirror${cfg.axis.toUpperCase()}.rotation.set(${roundTo4(mr.x)}, ${roundTo4(mr.y)}, ${roundTo4(mr.z)}) // (${radToDeg(mr.x)}deg, ${radToDeg(mr.y)}deg, ${radToDeg(mr.z)}deg)\n`
        }
        text = code
      } else {
        const placements: Record<string, unknown> = {
          original: {
            position: { x: v.px, y: v.py, z: v.pz },
            rotation_deg: { x: radToDeg(v.rx), y: radToDeg(v.ry), z: radToDeg(v.rz) },
          },
        }
        for (const cfg of MIRROR_CONFIGS) {
          if (!mirrors[cfg.axis]) continue
          const mp = cfg.posFn(pos)
          const mr = cfg.rotFn(rot)
          placements[`mirror_${cfg.axis}`] = {
            position: { x: roundTo4(mp.x), y: roundTo4(mp.y), z: roundTo4(mp.z) },
            rotation_deg: { x: radToDeg(mr.x), y: radToDeg(mr.y), z: radToDeg(mr.z) },
          }
        }
        text = JSON.stringify(
          {
            part: glb.label,
            glb: `${glb.folder}${glb.file}`,
            modelScale,
            mirrors,
            dims: partLoader.dimensions,
            placements,
          },
          null,
          2
        )
      }

      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        console.warn('Clipboard write failed:', err)
      }
    },
    [partTransformHook, partLoader, selectedPart, mirrors]
  )

  // ── Storage save handler ───────────────────────────────────────────────
  const handleSave = useCallback(() => {
    storage.save(
      selectedPart,
      partTransformHook.readTransform(),
      partLoader.uniformScale,
      mirrors,
      GLB_PARTS
    )
  }, [storage, selectedPart, partTransformHook, partLoader.uniformScale, mirrors])

  // ── Mirror count ───────────────────────────────────────────────────────
  const mirrorCount = countMirrors(mirrors)

  // ── Tab labels (no emojis per project rules) ──────────────────────────
  const TAB_CONFIG: { key: PanelTab; label: string }[] = [
    { key: 'move', label: 'Move' },
    { key: 'rotate', label: 'Rotate' },
    { key: 'mirror', label: `Mirror x${mirrorCount + 1}` },
    { key: 'snap', label: 'Snap' },
    { key: 'saved', label: 'Saved' },
  ]

  /* ═══════════════════════════════════════════════════════════════════════
     RENDER
     ═══════════════════════════════════════════════════════════════════════ */

  return (
    <div className={styles.panel} onMouseDown={(e) => e.stopPropagation()}>
      {/* Header */}
      <div className={styles.header}>
        <span className={styles.title}>Part Builder</span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button
            className={styles.tinyBtn}
            onClick={handleUndo}
            disabled={!undoCount}
            aria-label={`Undo (${undoCount})`}
          >
            Undo {undoCount > 0 && undoCount}
          </button>
          <button
            className={styles.tinyBtn}
            onClick={handleRedo}
            disabled={!redoCount}
            aria-label={`Redo (${redoCount})`}
          >
            Redo {redoCount > 0 && redoCount}
          </button>
        </div>
      </div>

      {/* Part select */}
      <select
        className={styles.select}
        value={selectedPart}
        onChange={(e) => setSelectedPart(+e.target.value)}
        aria-label="Select part"
      >
        {GLB_PARTS.map((p, i) => (
          <option key={i} value={i}>
            {p.label}
          </option>
        ))}
      </select>

      {/* Loading indicator */}
      {partLoader.loading && (
        <div className={styles.loadingOverlay}>
          <div className={styles.loadingSpinner} />
          <span>Loading part...</span>
        </div>
      )}

      {/* Dimensions + scale */}
      {partLoader.dimensions.w > 0 && (
        <div className={styles.dimensions}>
          {partLoader.dimensions.w.toFixed(3)} x {partLoader.dimensions.h.toFixed(3)} x{' '}
          {partLoader.dimensions.d.toFixed(3)} m
        </div>
      )}
      <div className={styles.row}>
        <span className={styles.miniLabel}>Scale</span>
        <input
          type="range"
          min={0.001}
          max={5}
          step={0.001}
          className={styles.slider}
          value={partLoader.uniformScale}
          onChange={(e) => handleScaleChange(+e.target.value)}
        />
        <input
          type="number"
          step={0.01}
          className={styles.numberInput}
          style={{ width: 52 }}
          value={partLoader.uniformScale}
          onChange={(e) => handleScaleChange(+e.target.value || 1)}
        />
      </div>

      {/* Step size */}
      <div className={styles.row}>
        <span className={styles.miniLabel}>Step</span>
        {[0.001, 0.005, 0.01, 0.05, 0.1].map((s) => (
          <button
            key={s}
            className={`${styles.stepBtn} ${partTransformHook.step === s ? styles.stepBtnActive : ''}`}
            onClick={() => partTransformHook.setStep(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Gizmo + BBox toggles */}
      <div className={styles.row}>
        <button
          className={`${styles.smallBtn} ${showGizmo ? styles.smallBtnActive : ''}`}
          onClick={() => setShowGizmo(!showGizmo)}
        >
          3D Gizmo {showGizmo ? 'ON' : 'OFF'}
        </button>
        {showGizmo && (
          <>
            <span className={styles.miniLabel}>Size</span>
            <input
              type="range"
              min={1}
              max={6}
              step={0.5}
              className={styles.slider}
              value={gizmoSize}
              onChange={(e) => setGizmoSize(+e.target.value)}
            />
          </>
        )}
        <button
          className={`${styles.smallBtn} ${partLoader.showBoundingBox ? styles.smallBtnActive : ''}`}
          onClick={() => {
            partLoader.setShowBoundingBox(!partLoader.showBoundingBox)
            setTimeout(() => {
              if (scene) partLoader.updateBoundingBox(scene)
            }, 50)
          }}
        >
          BBox
        </button>
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist">
        {TAB_CONFIG.map((tb) => (
          <button
            key={tb.key}
            className={`${styles.tab} ${tab === tb.key ? styles.tabActive : ''}`}
            onClick={() => setTab(tb.key)}
            role="tab"
            aria-selected={tab === tb.key}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {/* Tab panels */}
      <div role="tabpanel">
        {tab === 'move' && (
          <MovePanel
            transform={partTransformHook.transform}
            step={partTransformHook.step}
            nudge={partTransformHook.nudge}
            setField={partTransformHook.setField}
            align={partTransformHook.align}
            alignSpecs={alignSpecs}
          />
        )}

        {tab === 'rotate' && (
          <RotatePanel
            transform={partTransformHook.transform}
            rotStep={partTransformHook.rotStep}
            setRotStep={partTransformHook.setRotStep}
            nudgeRotation={partTransformHook.nudgeRotation}
            align={partTransformHook.align}
            alignSpecs={alignSpecs}
          />
        )}

        {tab === 'mirror' && (
          <MirrorPanel
            transform={partTransformHook.transform}
            mirrors={mirrors}
            onMirrorsChange={setMirrors}
          />
        )}

        {tab === 'snap' && (
          <SnapPanel
            lineZs={lineZs}
            specs={alignSpecs}
            snapEnabled={partTransformHook.snapEnabled}
            gridSize={partTransformHook.gridSize}
            onSetSnapEnabled={partTransformHook.setSnapEnabled}
            onSetGridSize={partTransformHook.setGridSize}
            onSnapToLine={(z, side) =>
              partTransformHook.snapToLine(z, side, alignSpecs)
            }
            onQuickSnap={partTransformHook.quickSnap}
          />
        )}

        {tab === 'saved' && (
          <SavedPanel
            configs={storage.configs}
            configName={storage.configName}
            onSetConfigName={storage.setConfigName}
            onSave={handleSave}
            onLoad={storage.load}
            onRemove={storage.remove}
          />
        )}
      </div>

      {/* Bottom actions */}
      <div className={styles.row} style={{ marginTop: 4 }}>
        <button
          className={styles.resetBtn}
          onClick={() => partTransformHook.reset(alignSpecs, lineZs[0])}
        >
          Reset Position
        </button>
      </div>
      <div className={styles.row}>
        <button
          className={styles.copyBtn}
          style={{ flex: 1 }}
          onClick={() => handleCopy(false)}
        >
          {copied ? 'Copied!' : 'Copy JSON'}
        </button>
        <button
          className={styles.copyBtn}
          style={{ flex: 1 }}
          onClick={() => handleCopy(true)}
        >
          {copied ? 'Copied!' : 'Copy Code'}
        </button>
      </div>
      <div className={styles.info}>Arrows=XZ | Q/E=Y | Ctrl+Z=Undo</div>
    </div>
  )
})
