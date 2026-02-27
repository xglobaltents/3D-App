import type { FC } from 'react'
import type { SavedConfig } from '../types'
import { GLB_PARTS } from '../catalogue'
import styles from '../PartBuilder.module.css'

interface SavedPanelProps {
  configs: SavedConfig[]
  configName: string
  onSetConfigName: (name: string) => void
  onSave: () => void
  onLoad: (config: SavedConfig) => void
  onRemove: (index: number) => void
}

export const SavedPanel: FC<SavedPanelProps> = ({
  configs,
  configName,
  onSetConfigName,
  onSave,
  onLoad,
  onRemove,
}) => {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Save Current</div>
      <div className={styles.row}>
        <input
          type="text"
          className={styles.numberInput}
          style={{ flex: 1 }}
          placeholder="Name..."
          value={configName}
          onChange={(e) => onSetConfigName(e.target.value)}
        />
        <button className={styles.saveBtn} onClick={onSave}>
          Save
        </button>
      </div>

      {configs.length > 0 && (
        <>
          <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
            Saved
          </div>
          <div className={styles.configList}>
            {configs.map((c, i) => {
              const mirrorLabels = [
                c.mirrors.x && 'X',
                c.mirrors.z && 'Z',
                c.mirrors.xz && 'XZ',
              ].filter(Boolean)

              return (
                <div key={i} className={styles.configItem}>
                  <div className={styles.configName}>{c.name}</div>
                  <div className={styles.configMeta}>
                    {GLB_PARTS[c.partIndex]?.label ?? 'Unknown'} |{' '}
                    {mirrorLabels.length > 0 ? mirrorLabels.join(' ') : 'Single'}
                  </div>
                  <div className={styles.configActions}>
                    <button
                      className={styles.tinyBtn}
                      onClick={() => onLoad(c)}
                    >
                      Load
                    </button>
                    <button
                      className={`${styles.tinyBtn} ${styles.tinyBtnDanger}`}
                      onClick={() => onRemove(i)}
                      aria-label={`Delete ${c.name}`}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
