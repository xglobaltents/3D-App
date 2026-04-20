import type { TentSpecs } from '@/types'

export interface ConnectorTriangleTransform {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

export const CONNECTOR_TRIANGLE_INSET_FROM_EDGE = 0.2581
export const CONNECTOR_TRIANGLE_BELOW_EAVE = 0.0973
export const CONNECTOR_TRIANGLE_FRAME_LINE_OFFSET = 0.0053
export const CONNECTOR_TRIANGLE_ROLL_RAD = (-75 * Math.PI) / 180

export function getConnectorTriangleBaseTransform(
  specs: Pick<TentSpecs, 'halfWidth' | 'eaveHeight'>,
  baseplateTop: number,
  firstLineZ: number,
): ConnectorTriangleTransform {
  return {
    x: -specs.halfWidth + CONNECTOR_TRIANGLE_INSET_FROM_EDGE,
    y: baseplateTop + specs.eaveHeight - CONNECTOR_TRIANGLE_BELOW_EAVE,
    z: firstLineZ + CONNECTOR_TRIANGLE_FRAME_LINE_OFFSET,
    rx: 0,
    ry: 0,
    rz: CONNECTOR_TRIANGLE_ROLL_RAD,
  }
}