import { FC, useMemo } from 'react'
import { Color3 } from '@babylonjs/core'
import type { FrameComponentProps } from '../../../../types'
import { getArchHeightAtX } from '../specs'

const ALUMINUM_COLOR = new Color3(0.7, 0.7, 0.7)

/**
 * Step 8: Main Purlins
 * Profile: 76×125mm
 * Position: X=±2.5m
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/main-purlin.glb
 */
export const MainPurlins: FC<FrameComponentProps> = ({ numBays, specs }) => {
  const purlinLength = numBays * specs.bayDistance

  const purlins = useMemo(() => {
    return specs.mainPurlinX.map((xPos) => {
      const zHeight = getArchHeightAtX(xPos, specs) + 0.015
      return { xPos, zHeight }
    })
  }, [specs])

  return (
    <transformNode name="main-purlins">
      {purlins.map(({ xPos, zHeight }, idx) => (
        <box
          key={idx}
          name={`main-purlin-${idx}`}
          width={specs.profiles.mainPurlin.width}
          height={specs.profiles.mainPurlin.height}
          depth={purlinLength}
          position={[xPos, purlinLength / 2, zHeight]}
        >
          <standardMaterial name={`mp-mat-${idx}`} diffuseColor={ALUMINUM_COLOR} />
        </box>
      ))}
    </transformNode>
  )
}
