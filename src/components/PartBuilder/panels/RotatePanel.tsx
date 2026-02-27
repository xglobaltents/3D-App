import type { FC } from 'react'
import type { TransformValues } from '../types'
import type { AlignSpecs } from '../hooks/usePartTransform'
import { radToDeg } from '../utils'
import styles from '../PartBuilder.module.css'

interface RotatePanelProps {
  transform: TransformValues
  rotStep: number
  setRotStep: (s: number) => void
  nudgeRotation: (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void
  align: (preset: string, specs: AlignSpecs) => void
  alignSpecs: AlignSpecs
}

const AXES = [
  { axis: 'x' as const, label: 'Pitch (X)', className: 'bigBtnRed', labelClass: 'axisLabelRed' },
  { axis: 'y' as const, label: 'Yaw (Y)', className: 'bigBtnGreen', labelClass: 'axisLabelGreen' },
  { axis: 'z' as const, label: 'Roll (Z)', className: 'bigBtnBlue', labelClass: 'axisLabelBlue' },
] as const

const STEP_OPTIONS = [1, 5, 15, 45, 90]

export const RotatePanel: FC<RotatePanelProps> = ({
  transform,
  rotStep,
  setRotStep,
  nudgeRotation,
  align,
  alignSpecs,
}) => {
  const rotKey = (axis: 'x' | 'y' | 'z') => `r${axis}` as keyof TransformValues

  return (
    <div className={styles.section}>
      {/* Step selector */}
      <div className={styles.row}>
        <span className={styles.miniLabel}>Step deg</span>
        {STEP_OPTIONS.map((d) => (
          <button
            key={d}
            className={`${styles.stepBtn} ${rotStep === d ? styles.stepBtnActive : ''}`}
            onClick={() => setRotStep(d)}
          >
            {d}deg
          </button>
        ))}
      </div>

      {/* Rotation axes */}
      {AXES.map((a) => (
        <div key={a.axis} className={styles.axisGroup}>
          <div className={`${styles.axisLabel} ${styles[a.labelClass]}`}>
            {a.label}
          </div>
          <div className={styles.buttonRow}>
            <button
              className={`${styles.bigBtn} ${styles[a.className]}`}
              onClick={() => nudgeRotation(a.axis, -1)}
            >
              -{rotStep}deg
            </button>
            <span className={styles.rotDisplay}>
              {radToDeg(transform[rotKey(a.axis)] as number)}deg
            </span>
            <button
              className={`${styles.bigBtn} ${styles[a.className]}`}
              onClick={() => nudgeRotation(a.axis, 1)}
            >
              +{rotStep}deg
            </button>
          </div>
        </div>
      ))}

      <button className={styles.alignBtn} onClick={() => align('r0', alignSpecs)}>
        Reset All Rotation
      </button>
    </div>
  )
}
