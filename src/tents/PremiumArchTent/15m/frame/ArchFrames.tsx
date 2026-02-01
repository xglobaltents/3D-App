import { FC, useMemo } from 'react'
import { Vector3, Color3 } from '@babylonjs/core'
import type { FrameComponentProps } from '../../../../types'

const ALUMINUM_COLOR = new Color3(0.8, 0.8, 0.8)

/**
 * Step 3: Arch Frames
 * Profile: 212×112mm
 * Path: Curve from X=-7.606m → +7.606m
 * 
 * GLB: /tents/PremiumArchTent/15m/frame/arch-frame.glb
 */
export const ArchFrames: FC<FrameComponentProps> = ({ numBays, specs }) => {
  const archPath = useMemo(() => {
    const points: Vector3[] = []
    const segments = 32

    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = Math.PI * t

      const x = -specs.archOuterSpan * Math.cos(angle)
      const z = specs.eaveHeight + (specs.ridgeHeight - specs.eaveHeight) * Math.sin(angle)

      points.push(new Vector3(x, 0, z))
    }

    return points
  }, [specs])

  const bayPositions = useMemo(() => {
    return Array.from({ length: numBays + 1 }, (_, i) => i * specs.bayDistance)
  }, [numBays, specs.bayDistance])

  return (
    <transformNode name="arch-frames">
      {bayPositions.map((y, idx) => (
        <transformNode key={idx} name={`arch-frame-${idx}`} position={[0, y, 0]}>
          <tube
            name={`arch-tube-${idx}`}
            path={archPath}
            radius={0.1}
            tessellation={8}
            cap={0}
          >
            <standardMaterial name={`arch-mat-${idx}`} diffuseColor={ALUMINUM_COLOR} />
          </tube>
        </transformNode>
      ))}
    </transformNode>
  )
}
