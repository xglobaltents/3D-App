import { type FC, memo } from 'react'
import type { TentComponentProps } from '@/types'
import { PremiumArchFrame } from '../PremiumArchFrame'

export const PremiumArchTent10m: FC<TentComponentProps> = memo((
	{ numBays, specs, showFrame = true, builderMode, onLoadStateChange }
) => (
	<>
		{showFrame && (
			<PremiumArchFrame
				numBays={numBays}
				specs={specs}
				builderMode={builderMode}
				onLoadStateChange={onLoadStateChange}
			/>
		)}
	</>
))

PremiumArchTent10m.displayName = 'PremiumArchTent10m'
