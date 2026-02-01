import { FC, useMemo } from 'react'
import { Color3 } from '@babylonjs/core'
import type { FrameComponentProps } from '../../../../types'

const ALUMINUM_COLOR = new Color3(0.75, 0.75, 0.75)

/**
 * Step 4d: Eave Side Beams
 * Position: Z = eaveHeight - 90mm
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/eave-side-beam.glb
 */
export const EaveSideBeams: FC<FrameComponentProps> = ({ numBays, specs }) => {
  const beamLength = specs.bayDistance
  const zPosition = specs.eaveHeight - 0.090
  const xOffset = specs.halfWidth + specs.profiles.upright.width / 2

  const beams = useMemo(() => {
    const result: Array<{ x: number; y: number; key: string }> = []
    for (let bay = 0; bay < numBays; bay++) {
      const y = bay * specs.bayDistance + beamLength / 2
      result.push({ x: -xOffset, y, key: `l-${bay}` })
      result.push({ x: xOffset, y, key: `r-${bay}` })
    }
    return result
  }, [numBays, specs.bayDistance, xOffset, beamLength])

  return (
    <transformNode name="eave-side-beams">
      {beams.map(({ x, y, key }) => (
        <box
          key={key}
          name={`eave-beam-${key}`}
          width={specs.profiles.eaveBeam.width}
          height={specs.profiles.eaveBeam.height}
          depth={beamLength}
          position={[x, y, zPosition]}
        >
          <standardMaterial name={`eb-mat-${key}`} diffuseColor={ALUMINUM_COLOR} />
        </box>
      ))}
    </transformNode>
  )
}
