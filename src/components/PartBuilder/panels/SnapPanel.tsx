import { type FC, useState } from 'react'
import type { AlignSpecs } from '../hooks/usePartTransform'
import styles from '../PartBuilder.module.css'

interface SnapPanelProps {
  lineZs: number[]
  specs: AlignSpecs
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
  snapEnabled,
  gridSize,
  onSetSnapEnabled,
  onSetGridSize,
  onSnapToLine,
  onQuickSnap,
}) => {
  const [selectedLine, setSelectedLine] = useState(0)
  const [selectedSide, setSelectedSide] = useState<'right' | 'left'>('right')

  const quickPoints = [
    { label: 'Front-Right', x: -specs.halfWidth, z: -specs.halfLength },
    { label: 'Front-Left', x: specs.halfWidth, z: -specs.halfLength },
    { label: 'Back-Right', x: -specs.halfWidth, z: specs.halfLength },
    { label: 'Back-Left', x: specs.halfWidth, z: specs.halfLength },
    { label: 'Center', x: 0, z: 0 },
  ]

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
      <div className={styles.alignGrid}>
        {quickPoints.map((p) => (
          <button
            key={p.label}
            className={styles.alignBtn}
            onClick={() =>
              onQuickSnap(p.x, specs.baseplateTop + specs.eaveHeight, p.z)
            }
          >
            {p.label}
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
