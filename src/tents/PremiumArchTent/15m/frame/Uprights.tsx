import { FC } from 'react'
import { Color3 } from '@babylonjs/core'
import type { FrameComponentProps } from '../../../../types'

const ALUMINUM_COLOR = new Color3(0.8, 0.8, 0.8)

/**
 * Step 2: Uprights
 * Profile: 212×112mm
 * Position: X=±7.5m at each bay line
 * Height: baseplate top → eaveHeight - 150mm gap
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/upright.glb
 */
export const Uprights: FC<FrameComponentProps> = ({ numBays, specs }) => {
  const baseplateTop = specs.baseplate.thickness
  const uprightHeight = specs.eaveHeight - 0.150 - baseplateTop

  const positions: Array<{ x: number; y: number; key: string }> = []

  for (let bay = 0; bay <= numBays; bay++) {
    const y = bay * specs.bayDistance
    positions.push({ x: -specs.halfWidth, y, key: `l-${bay}` })
    positions.push({ x: specs.halfWidth, y, key: `r-${bay}` })
  }

  return (
    <transformNode name="uprights">
      {positions.map(({ x, y, key }) => (
        <box
          key={key}
          name={`upright-${key}`}
          width={specs.profiles.upright.width}
          depth={specs.profiles.upright.height}
          height={uprightHeight}
          position={[x, y, baseplateTop + uprightHeight / 2]}
        >
          <standardMaterial name={`upright-mat-${key}`} diffuseColor={ALUMINUM_COLOR} />
        </box>
      ))}
    </transformNode>
  )
}
