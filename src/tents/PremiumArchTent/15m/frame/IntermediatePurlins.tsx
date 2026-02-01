import { FC, useMemo } from 'react'
import { Color3 } from '@babylonjs/core'
import type { FrameComponentProps } from '../../../../types'
import { getArchHeightAtX } from '../specs'

const ALUMINUM_COLOR = new Color3(0.65, 0.65, 0.65)

/**
 * Step 9: Intermediate Purlins
 * Profile: 60×60mm
 * Positions: X=±5.0m, ±1.25m, 0m
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/intermediate-purlin.glb
 */
export const IntermediatePurlins: FC<FrameComponentProps> = ({ numBays, specs }) => {
  const purlinLength = numBays * specs.bayDistance

  const purlins = useMemo(() => {
    return specs.intermediatePurlinX.map((xPos) => {
      const zHeight = getArchHeightAtX(xPos, specs) + 0.015
      return { xPos, zHeight }
    })
  }, [specs])

  return (
    <transformNode name="intermediate-purlins">
      {purlins.map(({ xPos, zHeight }, idx) => (
        <box
          key={idx}
          name={`intermediate-purlin-${idx}`}
          width={specs.profiles.intermediatePurlin.width}
          height={specs.profiles.intermediatePurlin.height}
          depth={purlinLength}
          position={[xPos, purlinLength / 2, zHeight]}
        >
          <standardMaterial name={`ip-mat-${idx}`} diffuseColor={ALUMINUM_COLOR} />
        </box>
      ))}
    </transformNode>
  )
}
