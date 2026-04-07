/**
 * PremiumArchFrame — Shared frame composition for all Premium Arch Tent variants.
 *
 * All PremiumArchTent widths (15m, 15m-high, 20m) share the same structural
 * frame components with different specs driving dimensions. This component
 * composes all frame parts and forwards the specs/numBays/callbacks.
 */

import { type FC, memo } from 'react'
import type { TentSpecs } from '@/types'
import { Baseplates } from '@/tents/SharedFrames/Baseplates'
import { Uprights } from '@/tents/PremiumArchTent/15m/frame/Uprights'
import { UprightConnectors } from '@/tents/SharedFrames/UprightConnectors'
import { EaveSideBeams } from '@/tents/PremiumArchTent/15m/frame/EaveSideBeams'
import { GableEaveBeams } from '@/tents/PremiumArchTent/15m/frame/GableEaveBeams'
import { GableBeams } from '@/tents/PremiumArchTent/15m/frame/GableBeams'
import { GableSupports } from '@/tents/PremiumArchTent/15m/frame/GableSupports'

interface PremiumArchFrameProps {
	numBays: number
	specs: TentSpecs
	builderMode?: boolean
	onLoadStateChange?: (loading: boolean) => void
}

export const PremiumArchFrame: FC<PremiumArchFrameProps> = memo(({
	numBays,
	specs,
	builderMode = false,
	onLoadStateChange,
}) => (
	<>
		<Baseplates
			numBays={numBays}
			specs={specs}
			enabled={true}
			onLoadStateChange={onLoadStateChange}
		/>
		<Uprights
			numBays={numBays}
			specs={specs}
			enabled={true}
			onLoadStateChange={onLoadStateChange}
		/>
		<UprightConnectors
			numBays={numBays}
			specs={specs}
			enabled={!builderMode}
			onLoadStateChange={onLoadStateChange}
		/>
		<EaveSideBeams
			numBays={numBays}
			specs={specs}
			enabled={!builderMode}
			onLoadStateChange={onLoadStateChange}
		/>
		<GableEaveBeams
			numBays={numBays}
			specs={specs}
			enabled={!builderMode}
			onLoadStateChange={onLoadStateChange}
		/>
		<GableBeams
			numBays={numBays}
			specs={specs}
			enabled={!builderMode}
			onLoadStateChange={onLoadStateChange}
		/>
		<GableSupports
			numBays={numBays}
			specs={specs}
			enabled={!builderMode}
			onLoadStateChange={onLoadStateChange}
		/>
	</>
))

PremiumArchFrame.displayName = 'PremiumArchFrame'
