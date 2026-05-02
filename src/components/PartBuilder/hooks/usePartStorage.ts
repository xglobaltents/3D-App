import { useCallback, useMemo, useState } from 'react'
import type { SavedConfig, TransformValues, MirrorFlags, AxisScale } from '../types'
import { DEFAULT_SCALE } from '../types'
import { loadConfigs, saveConfigs } from '../utils'
import type { GLBOption } from '../catalogue'

export interface UsePartStorageReturn {
  configs: SavedConfig[]
  configName: string
  setConfigName: (name: string) => void
  save: (
    part: GLBOption,
    transform: TransformValues,
    axisScale: AxisScale,
    mirrors: MirrorFlags
  ) => void
  saveBatch: (newConfigs: SavedConfig[]) => void
  duplicate: (index: number, overrides: Partial<Pick<SavedConfig, 'name' | 'transform'>>) => void
  load: (config: SavedConfig) => void
  remove: (index: number) => void
}

interface UsePartStorageOptions {
  onLoad: (config: SavedConfig) => void
  tentKey: string
}

/**
 * Manages saving / loading / deleting named configurations from localStorage.
 *
 * Configs are derived synchronously during render from `tentKey` + an internal
 * version counter. Writes bump the version so dependent renders see the new
 * list without a setState-in-effect cascade (which React 19 flags as a perf
 * anti-pattern, see react-hooks/set-state-in-effect).
 */
export function usePartStorage(
  options: UsePartStorageOptions
): UsePartStorageReturn {
  const { onLoad, tentKey } = options
  const [version, setVersion] = useState(0)
  const [configName, setConfigName] = useState('')

  // Derived from (tentKey, version): no effect, no render cascade.
  // `version` is intentionally a dependency so writes invalidate the memo
  // even though `loadConfigs` does not read it directly.
  const configs = useMemo(
    () => loadConfigs(tentKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tentKey, version]
  )

  const persist = useCallback(
    (next: SavedConfig[]) => {
      saveConfigs(tentKey, next)
      setVersion((v) => v + 1)
    },
    [tentKey]
  )

  const save = useCallback(
    (
      part: GLBOption,
      transform: TransformValues,
      axisScale: AxisScale,
      mirrors: MirrorFlags
    ) => {
      const name =
        configName.trim() ||
        `${part.label} ${new Date().toLocaleTimeString()}`

      const updated = [
        ...configs,
        {
          name,
          tentKey,
          partId: part.id,
          partLabel: part.label,
          transform,
          axisScale,
          mirrors,
          timestamp: Date.now(),
        },
      ]
      persist(updated)
      setConfigName('')
    },
    [configName, configs, tentKey, persist]
  )

  const load = useCallback(
    (config: SavedConfig) => {
      // Backward compat: old saves had uniformScale, no axisScale
      if (!config.axisScale && config.uniformScale != null) {
        const s = config.uniformScale
        config = { ...config, axisScale: { x: s, y: s, z: s } }
      } else if (!config.axisScale) {
        config = { ...config, axisScale: { ...DEFAULT_SCALE } }
      }
      onLoad(config)
    },
    [onLoad]
  )

  const remove = useCallback(
    (index: number) => {
      const updated = configs.filter((_, i) => i !== index)
      persist(updated)
    },
    [configs, persist]
  )

  const saveBatch = useCallback(
    (newConfigs: SavedConfig[]) => {
      const scopedConfigs = newConfigs.map((config) => ({ ...config, tentKey }))
      const updated = [...configs, ...scopedConfigs]
      persist(updated)
      setConfigName('')
    },
    [configs, tentKey, persist]
  )

  const duplicate = useCallback(
    (index: number, overrides: Partial<Pick<SavedConfig, 'name' | 'transform'>>) => {
      const src = configs[index]
      if (!src) return
      const dup: SavedConfig = {
        ...src,
        ...overrides,
        name: overrides.name ?? `${src.name} (copy)`,
        transform: overrides.transform
          ? { ...src.transform, ...overrides.transform }
          : { ...src.transform },
        timestamp: Date.now(),
      }
      const updated = [...configs, dup]
      persist(updated)
    },
    [configs, persist]
  )

  return { configs, configName, setConfigName, save, saveBatch, duplicate, load, remove }
}
