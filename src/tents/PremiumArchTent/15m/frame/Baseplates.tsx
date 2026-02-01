import { FC } from 'react'
import { Color3 } from '@babylonjs/core'
import type { FrameComponentProps } from '../../../../types'

const STEEL_COLOR = new Color3(0.29, 0.29, 0.29)

/**
 * Step 1: Baseplates
 * Position: X=±7.5m at each bay line, Z=0
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/baseplate.glb
 * TODO: Replace boxes with GLB + thin instances when file is provided
 */
export const Baseplates: FC<FrameComponentProps> = ({ numBays, specs }) => {
  const positions: Array<{ x: number; y: number; key: string }> = []

  for (let bay = 0; bay <= numBays; bay++) {
    const y = bay * specs.bayDistance
    positions.push({ x: -specs.halfWidth, y, key: `l-${bay}` })
    positions.push({ x: specs.halfWidth, y, key: `r-${bay}` })
  }

  return (
    <transformNode name="baseplates">
      {positions.map(({ x, y, key }) => (
        <box
          key={key}
          name={`baseplate-${key}`}
          width={specs.baseplate.width}
          height={specs.baseplate.thickness}
          depth={specs.baseplate.depth}
          position={[x, y, specs.baseplate.thickness / 2]}
        >
          <standardMaterial name={`baseplate-mat-${key}`} diffuseColor={STEEL_COLOR} />
        </box>
      ))}
    </transformNode>
  )
}
