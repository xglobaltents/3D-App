import { type FC, useState } from 'react'
import type { SavedConfig, TransformValues, AxisScale, MirrorFlags } from '../types'
import type { GLBOption } from '../catalogue'
import styles from '../PartBuilder.module.css'

interface SavedPanelProps {
  configs: SavedConfig[]
  tentKey: string
  configName: string
  onSetConfigName: (name: string) => void
  onSave: () => void
  onLoad: (config: SavedConfig) => void
  onRemove: (index: number) => void
  onDuplicate: (index: number, overrides: Partial<Pick<SavedConfig, 'name' | 'transform'>>) => void
  onSaveBatch: (configs: SavedConfig[]) => void
  lineZs: number[]
  currentTransform: TransformValues
  currentPartId: string
  currentPartLabel: string
  currentAxisScale: AxisScale
  currentMirrors: MirrorFlags
  parts: GLBOption[]
}

export const SavedPanel: FC<SavedPanelProps> = ({
  configs,
  tentKey,
  configName,
  onSetConfigName,
  onSave,
  onLoad,
  onRemove,
  onDuplicate,
  onSaveBatch,
  lineZs,
  currentTransform,
  currentPartId,
  currentPartLabel,
  currentAxisScale,
  currentMirrors,
  parts,
}) => {
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const resolvePartLabel = (config: SavedConfig): string => {
    const byId = parts.find((part) => part.id === config.partId)
    if (byId) return byId.label
    if (config.partLabel) return config.partLabel
    if (config.partIndex != null && config.partIndex >= 0 && config.partIndex < parts.length) {
      return parts[config.partIndex].label
    }
    return 'Unknown'
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionTitle}>Save Current</div>
      <div className={styles.profileHint} style={{ marginBottom: 8 }}>
        Saved configs are scoped to {tentKey}
      </div>
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

      {/* Batch placement — save current part at every frame line */}
      <div className={styles.sectionTitle} style={{ marginTop: 10 }}>
        Batch Place ({lineZs.length} lines)
      </div>
      <div className={styles.row}>
        <button
          className={styles.alignBtn}
          style={{ flex: 1 }}
          onClick={() => {
            const label = currentPartLabel || 'Part'
            const batch: SavedConfig[] = lineZs.map((z, i) => ({
              name: `${configName.trim() || label} L${i}`,
              tentKey,
              partId: currentPartId,
              partLabel: currentPartLabel,
              transform: { ...currentTransform, pz: z },
              axisScale: { ...currentAxisScale },
              mirrors: { ...currentMirrors },
              timestamp: Date.now() + i,
            }))
            onSaveBatch(batch)
          }}
        >
          Save at All Lines (keep X/Y)
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
                    {resolvePartLabel(c)} |{' '}
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
                      className={styles.tinyBtn}
                      onClick={() => onDuplicate(i, {
                        name: `${c.name} +Z`,
                        transform: { ...c.transform, pz: c.transform.pz + (lineZs[1] - lineZs[0]) },
                      })}
                      title="Duplicate this config offset by one bay along Z"
                    >
                      Dup +Z
                    </button>
                    {confirmDelete === i ? (
                      <>
                        <button
                          className={`${styles.tinyBtn} ${styles.tinyBtnDanger}`}
                          onClick={() => { onRemove(i); setConfirmDelete(null) }}
                          aria-label={`Confirm delete ${c.name}`}
                        >
                          Confirm
                        </button>
                        <button
                          className={styles.tinyBtn}
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className={`${styles.tinyBtn} ${styles.tinyBtnDanger}`}
                        onClick={() => setConfirmDelete(i)}
                        aria-label={`Delete ${c.name}`}
                      >
                        Delete
                      </button>
                    )}
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
