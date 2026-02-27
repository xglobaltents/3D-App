import { useCallback, useState } from 'react'
import type { SavedConfig, TransformValues, MirrorFlags } from '../types'
import { loadConfigs, saveConfigs } from '../utils'
import type { GLBOption } from '../catalogue'

export interface UsePartStorageReturn {
  configs: SavedConfig[]
  configName: string
  setConfigName: (name: string) => void
  save: (
    partIndex: number,
    transform: TransformValues,
    uniformScale: number,
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
      uniformScale: number,
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
          uniformScale,
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
