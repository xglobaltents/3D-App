import { FC, useMemo } from 'react'
import { Vector3, Color3 } from '@babylonjs/core'
import type { CoverComponentProps } from '../../../../types'

const PVC_WHITE = new Color3(0.95, 0.95, 0.95)

/**
 * Step 11: Covers (Roof + Gables)
 * 
 * GLB: /tents/PremiumArchTent/15m/covers/roof-panel.glb
 * GLB: /tents/PremiumArchTent/15m/covers/gable-front.glb
 * GLB: /tents/PremiumArchTent/15m/covers/gable-back.glb
 */
export const Covers: FC<CoverComponentProps> = ({ numBays, tentLength, specs }) => {
  const roofPath = useMemo(() => {
    const points: Vector3[] = []
    const segments = 32
    const offset = 0.02

    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      const angle = Math.PI * t

      const x = -(specs.archOuterSpan + offset) * Math.cos(angle)
      const z = specs.eaveHeight + (specs.ridgeHeight - specs.eaveHeight + offset) * Math.sin(angle)

      points.push(new Vector3(x, 0, z))
    }

    return points
  }, [specs])

  return (
    <transformNode name="covers">
      {/* Roof sections */}
      {Array.from({ length: numBays }).map((_, bay) => (
        <transformNode
          key={bay}
          name={`roof-bay-${bay}`}
          position={[0, bay * specs.bayDistance + specs.bayDistance / 2, 0]}
        >
          <tube
            name={`roof-tube-${bay}`}
            path={roofPath}
            radius={specs.bayDistance / 2}
            tessellation={4}
            cap={0}
          >
            <standardMaterial
              name={`roof-mat-${bay}`}
              diffuseColor={PVC_WHITE}
              backFaceCulling={false}
              alpha={0.9}
            />
          </tube>
        </transformNode>
      ))}

      {/* Front gable */}
      <transformNode name="gable-front" position={[0, 0.01, specs.eaveHeight + 0.5]}>
        <disc
          name="gable-disc-front"
          radius={specs.archOuterSpan}
          tessellation={32}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <standardMaterial
            name="gable-mat-front"
            diffuseColor={PVC_WHITE}
            backFaceCulling={false}
          />
        </disc>
      </transformNode>

      {/* Back gable */}
      <transformNode name="gable-back" position={[0, tentLength - 0.01, specs.eaveHeight + 0.5]}>
        <disc
          name="gable-disc-back"
          radius={specs.archOuterSpan}
          tessellation={32}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <standardMaterial
            name="gable-mat-back"
            diffuseColor={PVC_WHITE}
            backFaceCulling={false}
          />
        </disc>
      </transformNode>
    </transformNode>
  )
}
