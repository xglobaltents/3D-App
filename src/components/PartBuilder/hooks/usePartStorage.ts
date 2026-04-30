import { useCallback, useEffect, useState } from 'react'
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
 */
export function usePartStorage(
  options: UsePartStorageOptions
): UsePartStorageReturn {
  const { onLoad, tentKey } = options
  const [configs, setConfigs] = useState<SavedConfig[]>(() => loadConfigs(tentKey))
  const [configName, setConfigName] = useState('')

  useEffect(() => {
    setConfigs(loadConfigs(tentKey))
    setConfigName('')
  }, [tentKey])

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
      setConfigs(updated)
      saveConfigs(tentKey, updated)
      setConfigName('')
    },
    [configName, configs, tentKey]
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
      setConfigs(updated)
      saveConfigs(tentKey, updated)
    },
    [configs, tentKey]
  )

  const saveBatch = useCallback(
    (newConfigs: SavedConfig[]) => {
      const scopedConfigs = newConfigs.map((config) => ({ ...config, tentKey }))
      const updated = [...configs, ...scopedConfigs]
      setConfigs(updated)
      saveConfigs(tentKey, updated)
      setConfigName('')
    },
    [configs, tentKey]
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
      setConfigs(updated)
      saveConfigs(tentKey, updated)
    },
    [configs, tentKey]
  )

  return { configs, configName, setConfigName, save, saveBatch, duplicate, load, remove }
}
