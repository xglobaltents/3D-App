import type { FC } from 'react'
import type { TransformValues } from '../types'
import type { AlignSpecs } from '../hooks/usePartTransform'
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
      <div className={styles.sectionTitle}>Align Position</div>
      <div className={styles.alignGrid}>
        {[
          { label: 'Right Side', key: 'right' },
          { label: 'Left Side', key: 'left' },
          { label: 'Center X', key: 'cx' },
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
      <div className={styles.alignGrid}>
        {[
          { label: 'Front End', key: 'front' },
          { label: 'Back End', key: 'back' },
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
      <div className={styles.alignGrid}>
        {[
          { label: 'Eave Height', key: 'eave' },
          { label: 'Ground', key: 'ground' },
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

      {/* Compound alignment — common corner positions in one tap */}
      <div className={styles.sectionTitle} style={{ marginTop: 6 }}>Quick Corners</div>
      <div className={styles.alignGrid}>
        {[
          { label: 'Front-Right Eave', presets: ['right', 'front', 'eave'] },
          { label: 'Front-Left Eave', presets: ['left', 'front', 'eave'] },
          { label: 'Back-Right Eave', presets: ['right', 'back', 'eave'] },
          { label: 'Back-Left Eave', presets: ['left', 'back', 'eave'] },
          { label: 'Front-Right Ground', presets: ['right', 'front', 'ground'] },
          { label: 'Front-Left Ground', presets: ['left', 'front', 'ground'] },
        ].map((combo) => (
          <button
            key={combo.label}
            className={styles.alignBtn}
            onClick={() => combo.presets.forEach(p => align(p, alignSpecs))}
          >
            {combo.label}
          </button>
        ))}
      </div>
    </div>
  )
}
