import type { TentSpecs, ProfileSpecs } from '@/types'

export type PartAxis = 'x' | 'y' | 'z'
export type CalibrationLengthSource = 'bayDistance' | 'eaveHeight' | 'tentWidth'

export interface PartCalibration {
  /** Uniform cross-section scale for the two non-length axes. */
  crossScale: number
  /** Profile width this GLB was calibrated at, in meters. */
  calibratedProfileW: number
  /** Scale-per-meter for the length axis. */
  lengthScalePerMeter: number
  /** Which tent dimension drives length scaling. */
  lengthSource: CalibrationLengthSource
  /** Which model axis is the extrusion/length axis. */
  lengthAxis: PartAxis
  /** Profile key that supplies width correction from specs. */
  profileKey: keyof ProfileSpecs
}

export const PART_CALIBRATIONS: Record<string, PartCalibration> = {
  // PartBuilder-proven values.
  'eave-side-beam': {
    profileKey: 'eaveBeam',
    crossScale: 0.0001479,
    calibratedProfileW: 0.127,
    lengthScalePerMeter: 0.02,
    lengthSource: 'bayDistance',
    lengthAxis: 'z',
  },
  // Exported from PartBuilder for gable-beam-80x150.
  // Note: raw vertex extents X=435 (profH), Y=809 (profW), Z=50 (length).
  // crossScale here is the profile-width value; X axis needs 0.0001747 for
  // exact profileHeight but the uniform model approximates with profW only.
  'gable-beam': {
    profileKey: 'gableBeam',
    crossScale: 0.000157,
    calibratedProfileW: 0.127,
    lengthScalePerMeter: 0.0199,
    lengthSource: 'tentWidth',
    lengthAxis: 'z',
  },
  // Exported from PartBuilder for gable-support-77x127.
  'gable-support': {
    profileKey: 'gableColumn',
    crossScale: 0.0003428,
    calibratedProfileW: 0.127,
    lengthScalePerMeter: 0.05128125,
    lengthSource: 'eaveHeight',
    lengthAxis: 'z',
  },
  upright: {
    profileKey: 'upright',
    crossScale: 0.001,
    calibratedProfileW: 0.212,
    lengthScalePerMeter: 1 / 3200,
    lengthSource: 'eaveHeight',
    lengthAxis: 'z',
  },
}

function getLengthTarget(specs: TentSpecs, source: CalibrationLengthSource): number {
  switch (source) {
    case 'bayDistance':
      return specs.bayDistance
    case 'eaveHeight':
      return specs.eaveHeight
    case 'tentWidth':
      return specs.width
  }
}

function crossAxes(lengthAxis: PartAxis): [PartAxis, PartAxis] {
  if (lengthAxis === 'x') return ['y', 'z']
  if (lengthAxis === 'y') return ['x', 'z']
  return ['x', 'y']
}

export function computeCalibrationScale(
  calibration: PartCalibration,
  specs: TentSpecs,
): { x: number; y: number; z: number } {
  const profile = specs.profiles[calibration.profileKey]
  const widthCorrection = profile.width / calibration.calibratedProfileW
  const cross = calibration.crossScale * widthCorrection
  const length = calibration.lengthScalePerMeter * getLengthTarget(specs, calibration.lengthSource)

  const [a, b] = crossAxes(calibration.lengthAxis)
  const scale = { x: cross, y: cross, z: cross }
  scale[calibration.lengthAxis] = length
  scale[a] = cross
  scale[b] = cross
  return scale
}

export function getPartCalibrationScale(
  partId: string,
  specs: TentSpecs,
): { x: number; y: number; z: number } | null {
  const calibration = PART_CALIBRATIONS[partId]
  if (!calibration) return null
  return computeCalibrationScale(calibration, specs)
}
