import type { FC } from 'react'
import type { TransformValues } from '../types'
import type { AlignSpecs } from '../hooks/usePartTransform'
import { radToDeg } from '../utils'
import styles from '../PartBuilder.module.css'

interface MovePanelProps {
  transform: TransformValues
  step: number
  nudge: (axis: 'x' | 'y' | 'z', dir: 1 | -1) => void
  setField: (field: keyof TransformValues, val: number) => void
  align: (preset: string, specs: AlignSpecs) => void
  alignSpecs: AlignSpecs
}

export const MovePanel: FC<MovePanelProps> = ({
  transform,
  step,
  nudge,
  setField,
  align,
  alignSpecs,
}) => {
  // Suppress unused warning — radToDeg imported for potential use
  void radToDeg

  return (
    <div className={styles.section}>
      {/* X axis */}
      <div className={styles.axisGroup}>
        <div className={`${styles.axisLabel} ${styles.axisLabelRed}`}>
          X — Left / Right
        </div>
        <div className={styles.buttonRow}>
          <button className={`${styles.bigBtn} ${styles.bigBtnRed}`} onClick={() => nudge('x', -1)}>
            &larr; -X
          </button>
          <input
            type="number"
            step={step}
            className={styles.axisInput}
            value={transform.px}
            onChange={(e) => setField('px', +e.target.value || 0)}
          />
          <button className={`${styles.bigBtn} ${styles.bigBtnRed}`} onClick={() => nudge('x', 1)}>
            +X &rarr;
          </button>
        </div>
      </div>

      {/* Y axis */}
      <div className={styles.axisGroup}>
        <div className={`${styles.axisLabel} ${styles.axisLabelGreen}`}>
          Y — Up / Down
        </div>
        <div className={styles.buttonRow}>
          <button className={`${styles.bigBtn} ${styles.bigBtnGreen}`} onClick={() => nudge('y', -1)}>
            &darr; Down
          </button>
          <input
            type="number"
            step={step}
            className={styles.axisInput}
            value={transform.py}
            onChange={(e) => setField('py', +e.target.value || 0)}
          />
          <button className={`${styles.bigBtn} ${styles.bigBtnGreen}`} onClick={() => nudge('y', 1)}>
            &uarr; Up
          </button>
        </div>
      </div>

      {/* Z axis */}
      <div className={styles.axisGroup}>
        <div className={`${styles.axisLabel} ${styles.axisLabelBlue}`}>
          Z — Front / Back
        </div>
        <div className={styles.buttonRow}>
          <button className={`${styles.bigBtn} ${styles.bigBtnBlue}`} onClick={() => nudge('z', -1)}>
            &#9668; Front
          </button>
          <input
            type="number"
            step={step}
            className={styles.axisInput}
            value={transform.pz}
            onChange={(e) => setField('pz', +e.target.value || 0)}
          />
          <button className={`${styles.bigBtn} ${styles.bigBtnBlue}`} onClick={() => nudge('z', 1)}>
            Back &#9658;
          </button>
        </div>
      </div>

      {/* Alignment shortcuts */}
      <div className={styles.alignGrid}>
        {[
          { label: 'Right Side', key: 'right' },
          { label: 'Left Side', key: 'left' },
          { label: 'Eave Height', key: 'eave' },
          { label: 'Ground', key: 'ground' },
          { label: 'Front End', key: 'front' },
          { label: 'Back End', key: 'back' },
          { label: 'Center X', key: 'cx' },
          { label: 'Center Z', key: 'cz' },
        ].map((a) => (
          <button
            key={a.key}
            className={styles.alignBtn}
            onClick={() => align(a.key, alignSpecs)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
