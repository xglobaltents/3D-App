import { type FC, memo } from 'react'
import type { TentComponentProps } from '@/types'
import { PremiumArchFrame } from '../PremiumArchFrame'

export const PremiumArchTent50m: FC<TentComponentProps> = memo((
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

PremiumArchTent50m.displayName = 'PremiumArchTent50m'
