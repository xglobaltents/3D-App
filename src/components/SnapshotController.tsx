/**
 * SnapshotController — WebGPU snapshot-rendering toggle
 *
 * NOTE (2026-04-27): Snapshot rendering (FAST or STANDARD) records render
 * bundles tied to a specific render-target attachment state. Our scene goes
 * through DefaultRenderingPipeline's HDR target (RGBA16Float, sampleCount=1)
 * and then back to the swapchain (BGRA8Unorm, sampleCount=4). Replaying a
 * bundle recorded for one in the other triggers WebGPU validation errors and
 * stalls rendering. Until the post-processing pipeline is re-architected to
 * keep a single attachment state, snapshot rendering is force-disabled and
 * this component is a no-op.
 *
 * Disabled in `BabylonProvider` (no `snapshotRenderingMode` set), and this
 * component additionally guards against any code path flipping it back on.
 */

import { type FC } from 'react'

interface SnapshotControllerProps {
  isLoading: boolean
  builderMode: boolean
  rebuildKey: string
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const SnapshotController: FC<SnapshotControllerProps> = (_props) => {
  return null
}
