import { type FC, memo } from 'react'
import type { TentComponentProps } from '@/types'
import { PremiumArchFrame } from '../PremiumArchFrame'

export const PremiumArchTent30m: FC<TentComponentProps> = memo((
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

PremiumArchTent30m.displayName = 'PremiumArchTent30m'
