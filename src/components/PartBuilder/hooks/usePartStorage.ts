import { useCallback, useState } from 'react'
import type { SavedConfig, TransformValues, MirrorFlags, AxisScale } from '../types'
import { DEFAULT_SCALE } from '../types'
import { loadConfigs, saveConfigs } from '../utils'
import type { GLBOption } from '../catalogue'

export interface UsePartStorageReturn {
  configs: SavedConfig[]
  configName: string
  setConfigName: (name: string) => void
  save: (
    partIndex: number,
    transform: TransformValues,
    axisScale: AxisScale,
    mirrors: MirrorFlags,
    parts: GLBOption[]
  ) => void
  load: (config: SavedConfig) => void
  remove: (index: number) => void
}

interface UsePartStorageOptions {
  onLoad: (config: SavedConfig) => void
}

/**
 * Manages saving / loading / deleting named configurations from localStorage.
 */
export function usePartStorage(
  options: UsePartStorageOptions
): UsePartStorageReturn {
  const { onLoad } = options
  const [configs, setConfigs] = useState<SavedConfig[]>(() => loadConfigs())
  const [configName, setConfigName] = useState('')

  const save = useCallback(
    (
      partIndex: number,
      transform: TransformValues,
      axisScale: AxisScale,
      mirrors: MirrorFlags,
      parts: GLBOption[]
    ) => {
      const name =
        configName.trim() ||
        `${parts[partIndex]?.label ?? 'Part'} ${new Date().toLocaleTimeString()}`

      const updated = [
        ...configs,
        {
          name,
          partIndex,
          transform,
          axisScale,
          mirrors,
          timestamp: Date.now(),
        },
      ]
      setConfigs(updated)
      saveConfigs(updated)
      setConfigName('')
    },
    [configName, configs]
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
      saveConfigs(updated)
    },
    [configs]
  )

  return { configs, configName, setConfigName, save, load, remove }
}
