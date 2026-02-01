import { FC } from 'react'
import { Vector3 } from '@babylonjs/core'
import type { TentComponentProps } from '../../../types'
import { TENT_SPECS, getTentLength } from './specs'

// Frame components
import { Baseplates } from './frame/Baseplates'
import { Uprights } from './frame/Uprights'
import { ArchFrames } from './frame/ArchFrames'
import { GroundBeams } from './frame/GroundBeams'
import { EaveSideBeams } from './frame/EaveSideBeams'
import { GableEaveBeams } from './frame/GableEaveBeams'
import { GableSupports } from './frame/GableSupports'
import { MainPurlins } from './frame/MainPurlins'
import { IntermediatePurlins } from './frame/IntermediatePurlins'

// Covers
import { Covers } from './covers/Covers'

/**
 * Premium Arch Tent 15m
 * 
 * Coordinate system: Z-up (X=width, Y=length, Z=height)
 */
export const PremiumArchTent15m: FC<TentComponentProps> = ({
  numBays,
  showFrame = true,
  showCovers = true,
  position = Vector3.Zero(),
}) => {
  const tentLength = getTentLength(numBays, TENT_SPECS)

  return (
    <transformNode name="premium-arch-tent-15m" position={position}>
      {showFrame && (
        <transformNode name="frame">
          <Baseplates numBays={numBays} specs={TENT_SPECS} />
          <Uprights numBays={numBays} specs={TENT_SPECS} />
          <GroundBeams numBays={numBays} specs={TENT_SPECS} />
          <ArchFrames numBays={numBays} specs={TENT_SPECS} />
          <EaveSideBeams numBays={numBays} specs={TENT_SPECS} />
          <GableEaveBeams tentLength={tentLength} specs={TENT_SPECS} />
          <GableSupports tentLength={tentLength} specs={TENT_SPECS} />
          <MainPurlins numBays={numBays} specs={TENT_SPECS} />
          <IntermediatePurlins numBays={numBays} specs={TENT_SPECS} />
        </transformNode>
      )}

      {showCovers && (
        <transformNode name="covers">
          <Covers numBays={numBays} tentLength={tentLength} specs={TENT_SPECS} />
        </transformNode>
      )}
    </transformNode>
  )
}

export { TENT_SPECS }
