import { FC, useMemo } from 'react'
import { Color3 } from '@babylonjs/core'
import type { TentSpecs } from '../../../../types'
import { getArchHeightAtX } from '../specs'

interface GableSupportsProps {
  tentLength: number
  specs: TentSpecs
}

const ALUMINUM_COLOR = new Color3(0.8, 0.8, 0.8)

/**
 * Step 7: Gable Supports
 * Profile: 77×127mm
 * Position: X=±2.5m
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/gable-support.glb
 */
export const GableSupports: FC<GableSupportsProps> = ({ tentLength, specs }) => {
  const supports = useMemo(() => {
    const result: Array<{ x: number; y: number; height: number; key: string }> = []

    for (const xPos of specs.gableSupportPositions) {
      const height = getArchHeightAtX(xPos, specs) - 0.005

      result.push({ x: xPos, y: 0.050, height, key: `front-${xPos}` })
      result.push({ x: xPos, y: tentLength - 0.050, height, key: `back-${xPos}` })
    }

    return result
  }, [tentLength, specs])

  return (
    <transformNode name="gable-supports">
      {supports.map(({ x, y, height, key }) => (
        <box
          key={key}
          name={`gable-support-${key}`}
          width={specs.profiles.gableColumn.width}
          height={height}
          depth={specs.profiles.gableColumn.height}
          position={[x, y, height / 2]}
        >
          <standardMaterial name={`gs-mat-${key}`} diffuseColor={ALUMINUM_COLOR} />
        </box>
      ))}
    </transformNode>
  )
}
