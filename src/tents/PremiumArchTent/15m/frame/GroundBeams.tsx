import { FC, useMemo } from 'react'
import { Color3 } from '@babylonjs/core'
import type { FrameComponentProps } from '../../../../types'

const ALUMINUM_COLOR = new Color3(0.7, 0.7, 0.7)

/**
 * Step 2b: Ground Side Beams
 * Step 6: Gable Ground Beams
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/ground-beam.glb
 */
export const GroundBeams: FC<FrameComponentProps> = ({ numBays, specs }) => {
  const beamLength = specs.bayDistance
  const xOffset = specs.halfWidth + 0.085
  const tentLength = numBays * specs.bayDistance
  const beamHeight = specs.profiles.eaveBeam.height

  const sideBeams = useMemo(() => {
    const beams: Array<{ x: number; y: number; key: string }> = []
    for (let bay = 0; bay < numBays; bay++) {
      const y = bay * specs.bayDistance + beamLength / 2
      beams.push({ x: -xOffset, y, key: `side-l-${bay}` })
      beams.push({ x: xOffset, y, key: `side-r-${bay}` })
    }
    return beams
  }, [numBays, specs.bayDistance, xOffset, beamLength])

  return (
    <transformNode name="ground-beams">
      {/* Side ground beams */}
      {sideBeams.map(({ x, y, key }) => (
        <box
          key={key}
          name={`ground-beam-${key}`}
          width={specs.profiles.eaveBeam.width}
          height={beamHeight}
          depth={beamLength}
          position={[x, y, beamHeight / 2]}
        >
          <standardMaterial name={`gb-mat-${key}`} diffuseColor={ALUMINUM_COLOR} />
        </box>
      ))}

      {/* Front gable ground beam */}
      <box
        name="gable-ground-beam-front"
        width={specs.halfWidth * 2}
        height={specs.profiles.gableBeam.height}
        depth={specs.profiles.gableBeam.width}
        position={[0, 0, specs.profiles.gableBeam.height / 2]}
      >
        <standardMaterial name="ggb-mat-front" diffuseColor={ALUMINUM_COLOR} />
      </box>

      {/* Back gable ground beam */}
      <box
        name="gable-ground-beam-back"
        width={specs.halfWidth * 2}
        height={specs.profiles.gableBeam.height}
        depth={specs.profiles.gableBeam.width}
        position={[0, tentLength, specs.profiles.gableBeam.height / 2]}
      >
        <standardMaterial name="ggb-mat-back" diffuseColor={ALUMINUM_COLOR} />
      </box>
    </transformNode>
  )
}
