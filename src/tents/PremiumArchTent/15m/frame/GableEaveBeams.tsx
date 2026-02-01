import { FC } from 'react'
import { Color3 } from '@babylonjs/core'
import type { TentSpecs } from '../../../../types'

interface GableEaveBeamsProps {
  tentLength: number
  specs: TentSpecs
}

const ALUMINUM_COLOR = new Color3(0.75, 0.75, 0.75)

/**
 * Step 5: Gable Eave Beams
 * Position: Z=eaveHeight, Y=0 (front) and Y=tentLength (back)
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/gable-eave-beam.glb
 */
export const GableEaveBeams: FC<GableEaveBeamsProps> = ({ tentLength, specs }) => {
  const beamSpan = 7.126 * 2

  return (
    <transformNode name="gable-eave-beams">
      <box
        name="gable-eave-beam-front"
        width={beamSpan}
        height={specs.profiles.gableBeam.height}
        depth={specs.profiles.gableBeam.width}
        position={[0, 0, specs.eaveHeight]}
      >
        <standardMaterial name="geb-mat-front" diffuseColor={ALUMINUM_COLOR} />
      </box>

      <box
        name="gable-eave-beam-back"
        width={beamSpan}
        height={specs.profiles.gableBeam.height}
        depth={specs.profiles.gableBeam.width}
        position={[0, tentLength, specs.eaveHeight]}
      >
        <standardMaterial name="geb-mat-back" diffuseColor={ALUMINUM_COLOR} />
      </box>
    </transformNode>
  )
}
