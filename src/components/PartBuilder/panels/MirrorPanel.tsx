import type { FC } from 'react'
import { Vector3 } from '@babylonjs/core'
import type { TransformValues, MirrorFlags, MirrorAxis } from '../types'
import { MIRROR_CONFIGS } from '../catalogue'
import { roundTo4, radToDeg } from '../utils'
import { countMirrors, getMirrorPreset, toggleMirrorAxis } from '../hooks/useMirrorSystem'
import styles from '../PartBuilder.module.css'

interface MirrorPanelProps {
  transform: TransformValues
  mirrors: MirrorFlags
  onMirrorsChange: (flags: MirrorFlags) => void
}

const PRESETS = [
  { label: 'None (x1)', key: 'none' },
  { label: 'Both Sides (x2)', key: 'sides' },
  { label: 'Both Ends (x2)', key: 'ends' },
  { label: 'All 4 Corners (x4)', key: 'all4' },
]

export const MirrorPanel: FC<MirrorPanelProps> = ({
  transform,
  mirrors,
  onMirrorsChange,
}) => {
  const mirrorCount = countMirrors(mirrors)

  const handleToggle = (axis: MirrorAxis) => {
    onMirrorsChange(toggleMirrorAxis(mirrors, axis))
  }

  const handlePreset = (preset: string) => {
    onMirrorsChange(getMirrorPreset(preset))
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>
        Mirror — {mirrorCount + 1} total copies
      </div>

      {/* Mirror axis toggles */}
      {MIRROR_CONFIGS.map((cfg) => {
        const isOn = mirrors[cfg.axis]
        const rgb = `rgb(${cfg.color.r * 255},${cfg.color.g * 255},${cfg.color.b * 255})`
        return (
          <button
            key={cfg.axis}
            className={`${styles.mirrorBtn} ${isOn ? styles.mirrorBtnActive : ''}`}
            style={isOn ? { borderColor: rgb } : undefined}
            onClick={() => handleToggle(cfg.axis)}
            aria-pressed={isOn}
          >
            <span
              className={styles.mirrorDot}
              style={{ background: rgb, opacity: isOn ? 1 : 0.3 }}
            />
            <span className={styles.mirrorLabel}>
              <strong>{cfg.short}</strong> — {cfg.desc}
            </span>
            <span className={styles.mirrorState}>{isOn ? 'ON' : 'OFF'}</span>
          </button>
        )
      })}

      {/* Presets */}
      <div className={styles.sectionTitle} style={{ marginTop: 14, marginBottom: 6 }}>
        Quick Presets
      </div>
      <div className={styles.alignGrid}>
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={styles.presetBtn}
            onClick={() => handlePreset(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Computed positions */}
      {mirrorCount > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className={styles.sectionTitle}>Computed Positions</div>
          {MIRROR_CONFIGS.map((cfg) => {
            if (!mirrors[cfg.axis]) return null
            const pos = new Vector3(transform.px, transform.py, transform.pz)
            const rot = new Vector3(transform.rx, transform.ry, transform.rz)
            const mp = cfg.posFn(pos)
            const mr = cfg.rotFn(rot)
            const rgb = `rgb(${cfg.color.r * 255},${cfg.color.g * 255},${cfg.color.b * 255})`
            return (
              <div key={cfg.axis} className={styles.mirrorPos}>
                <span style={{ color: rgb, fontWeight: 700 }}>{cfg.short}:</span>
                <span className={styles.monoSmall}>
                  P({roundTo4(mp.x)}, {roundTo4(mp.y)}, {roundTo4(mp.z)}) R(
                  {radToDeg(mr.x)}deg, {radToDeg(mr.y)}deg, {radToDeg(mr.z)}deg)
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
