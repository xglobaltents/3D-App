import { type FC, useState } from 'react'
import type { AlignSpecs } from '../hooks/usePartTransform'
import type { TransformValues } from '../types'
import styles from '../PartBuilder.module.css'

interface SnapPanelProps {
  lineZs: number[]
  specs: AlignSpecs
  currentTransform: TransformValues
  gableSupportPositions: number[]
  mainPurlinX: number[]
  intermediatePurlinX: number[]
  snapEnabled: boolean
  gridSize: number
  onSetSnapEnabled: (on: boolean) => void
  onSetGridSize: (g: number) => void
  onSnapToLine: (lineZ: number, side: 'right' | 'left', specs: AlignSpecs) => void
  onQuickSnap: (x: number, y: number, z: number) => void
}

export const SnapPanel: FC<SnapPanelProps> = ({
  lineZs,
  specs,
  currentTransform,
  gableSupportPositions,
  mainPurlinX,
  intermediatePurlinX,
  snapEnabled,
  gridSize,
  onSetSnapEnabled,
  onSetGridSize,
  onSnapToLine,
  onQuickSnap,
}) => {
  const [selectedLine, setSelectedLine] = useState(0)
  const [selectedSide, setSelectedSide] = useState<'right' | 'left'>('right')
  const [snapY, setSnapY] = useState<'eave' | 'ground' | 'ridge'>('eave')

  const yPos = snapY === 'eave'
    ? specs.baseplateTop + specs.eaveHeight
    : snapY === 'ridge'
      ? specs.baseplateTop + specs.ridgeHeight
      : specs.baseplateTop

  const quickPoints = [
    { label: 'Front-Right', x: -specs.halfWidth, z: -specs.halfLength },
    { label: 'Front-Left', x: specs.halfWidth, z: -specs.halfLength },
    { label: 'Back-Right', x: -specs.halfWidth, z: specs.halfLength },
    { label: 'Back-Left', x: specs.halfWidth, z: specs.halfLength },
    { label: 'Center', x: 0, z: 0 },
  ]

  const formatAnchor = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}m`

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Snap to Frame Line</div>

      {/* Side selector */}
      <div className={styles.row}>
        <button
          className={`${styles.smallBtn} ${selectedSide === 'right' ? styles.smallBtnActive : ''}`}
          onClick={() => setSelectedSide('right')}
        >
          Right (-X)
        </button>
        <button
          className={`${styles.smallBtn} ${selectedSide === 'left' ? styles.smallBtnActive : ''}`}
          onClick={() => setSelectedSide('left')}
        >
          Left (+X)
        </button>
      </div>

      {/* Frame lines */}
      <div className={styles.frameLineList}>
        {lineZs.map((z, i) => (
          <button
            key={i}
            className={`${styles.frameLineBtn} ${selectedLine === i ? styles.frameLineBtnActive : ''}`}
            onClick={() => {
              setSelectedLine(i)
              onSnapToLine(z, selectedSide, specs)
            }}
          >
            Line {i} — Z: {z.toFixed(3)}m
          </button>
        ))}
      </div>

      {/* Quick snap points */}
      <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
        Quick Snap Points
      </div>
      <div className={styles.row}>
        <button
          className={`${styles.smallBtn} ${snapY === 'eave' ? styles.smallBtnActive : ''}`}
          onClick={() => setSnapY('eave')}
        >
          Eave Height
        </button>
        <button
          className={`${styles.smallBtn} ${snapY === 'ground' ? styles.smallBtnActive : ''}`}
          onClick={() => setSnapY('ground')}
        >
          Ground
        </button>
        <button
          className={`${styles.smallBtn} ${snapY === 'ridge' ? styles.smallBtnActive : ''}`}
          onClick={() => setSnapY('ridge')}
        >
          Ridge Height
        </button>
      </div>
      <div className={styles.alignGrid}>
        {quickPoints.map((p) => (
          <button
            key={p.label}
            className={styles.alignBtn}
            onClick={() => onQuickSnap(p.x, yPos, p.z)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
        Level Anchors
      </div>
      <div className={styles.alignGrid}>
        {[
          { label: 'Ground', y: specs.baseplateTop },
          { label: 'Eave', y: specs.baseplateTop + specs.eaveHeight },
          { label: 'Ridge', y: specs.baseplateTop + specs.ridgeHeight },
        ].map((anchor) => (
          <button
            key={anchor.label}
            className={styles.alignBtn}
            onClick={() => onQuickSnap(currentTransform.px, anchor.y, currentTransform.pz)}
          >
            {anchor.label}
          </button>
        ))}
      </div>

      <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
        X Anchors
      </div>
      <div className={styles.alignGrid}>
        {[
          { label: 'Right Edge', x: -specs.halfWidth },
          { label: 'Center', x: 0 },
          { label: 'Left Edge', x: specs.halfWidth },
        ].map((anchor) => (
          <button
            key={anchor.label}
            className={styles.alignBtn}
            onClick={() => onQuickSnap(anchor.x, currentTransform.py, currentTransform.pz)}
          >
            {anchor.label}
          </button>
        ))}
      </div>

      {gableSupportPositions.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
            Gable Support X
          </div>
          <div className={styles.alignGrid}>
            {gableSupportPositions.map((x) => (
              <button
                key={`gable-${x}`}
                className={styles.alignBtn}
                onClick={() => onQuickSnap(x, currentTransform.py, currentTransform.pz)}
              >
                {formatAnchor(x)}
              </button>
            ))}
          </div>
        </>
      )}

      {mainPurlinX.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
            Main Purlin X
          </div>
          <div className={styles.alignGrid}>
            {mainPurlinX.map((x) => (
              <button
                key={`main-${x}`}
                className={styles.alignBtn}
                onClick={() => onQuickSnap(x, currentTransform.py, currentTransform.pz)}
              >
                {formatAnchor(x)}
              </button>
            ))}
          </div>
        </>
      )}

      {intermediatePurlinX.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
            Intermediate Purlin X
          </div>
          <div className={styles.alignGrid}>
            {intermediatePurlinX.map((x) => (
              <button
                key={`intermediate-${x}`}
                className={styles.alignBtn}
                onClick={() => onQuickSnap(x, currentTransform.py, currentTransform.pz)}
              >
                {formatAnchor(x)}
              </button>
            ))}
          </div>
        </>
      )}

      <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
        Z Anchors
      </div>
      <div className={styles.frameLineList}>
        {lineZs.map((z, i) => (
          <button
            key={`z-anchor-${i}`}
            className={styles.frameLineBtn}
            onClick={() => onQuickSnap(currentTransform.px, currentTransform.py, z)}
          >
            Keep X/Y, set Z to line {i}
          </button>
        ))}
      </div>

      {/* Grid snap toggle */}
      <div className={styles.row} style={{ marginTop: 8 }}>
        <button
          className={`${styles.smallBtn} ${snapEnabled ? styles.smallBtnActive : ''}`}
          onClick={() => onSetSnapEnabled(!snapEnabled)}
        >
          Grid {snapEnabled ? 'ON' : 'OFF'}
        </button>
        {snapEnabled && (
          <input
            type="number"
            step={0.01}
            min={0.01}
            className={styles.numberInput}
            style={{ width: 52 }}
            value={gridSize}
            onChange={(e) => onSetGridSize(+e.target.value || 0.05)}
          />
        )}
      </div>
    </div>
  )
}
