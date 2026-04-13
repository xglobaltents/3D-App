import { Vector3 } from '@babylonjs/core'
import type { TransformValues, MirrorFlags, AxisScale } from './types'
import type { GLBOption } from './catalogue'
import { MIRROR_CONFIGS } from './catalogue'
import { roundTo4, radToDeg } from './utils'

/* ═══════════════════════════════════════════════════════════════════════════
   Rich Code Export — generates fully documented, parametric placement code
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CodeExportContext {
  glb: GLBOption
  transform: TransformValues
  axisScale: AxisScale
  /** modelNode rotation (from GLTF __root__). Euler angles {x, y, z} in radians. */
  modelRotation: { x: number; y: number; z: number }
  /** true if modelNode used a rotationQuaternion (exported as quaternion too) */
  modelUsedQuaternion: boolean
  mirrors: MirrorFlags
  dimensions: { w: number; h: number; d: number }
  specs: {
    name: string
    halfWidth: number
    eaveHeight: number
    ridgeHeight: number
    bayDistance: number
  }
  numBays: number
  lineZs: number[]
  baseplateTop: number
  halfLength: number
}

export type PlacementPattern =
  | 'both-sides-every-bay'
  | 'gable-ends-only'
  | 'every-frame-line'
  | 'single-instance'

export interface ComponentExportOptions {
  componentName: string
  placementPattern: PlacementPattern
}

/* ─── Nearest frame line finder ───────────────────────────────────────────── */

function findNearestLine(
  z: number,
  lineZs: number[]
): { index: number; z: number; offset: number } {
  let bestIdx = 0
  let bestDist = Infinity
  for (let i = 0; i < lineZs.length; i++) {
    const dist = Math.abs(z - lineZs[i])
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = i
    }
  }
  return {
    index: bestIdx,
    z: lineZs[bestIdx],
    offset: roundTo4(z - lineZs[bestIdx]),
  }
}

function describeFrameLineIndex(index: number, total: number): string {
  if (index === 0) return `Frame line 0 (front gable)`
  if (index === total - 1) return `Frame line ${index} (back gable)`
  return `Frame line ${index} (interior)`
}

/* ─── Side (X) description ────────────────────────────────────────────────── */

interface AxisDescription {
  desc: string
  formula: string
}

function describeSide(px: number, halfWidth: number): AxisDescription {
  if (Math.abs(px) < 0.005) {
    return { desc: 'Center (X=0)', formula: '0' }
  }

  const side = px < 0 ? 'Right' : 'Left'

  if (px < 0) {
    // Right side: px is negative, halfWidth reference is -halfWidth
    const offset = roundTo4(px + halfWidth) // how far from -halfWidth
    if (Math.abs(offset) < 0.005) {
      return { desc: `${side} side at edge`, formula: '-specs.halfWidth' }
    }
    const direction = offset > 0 ? 'inward from' : 'outward from'
    const absOff = Math.abs(offset)
    const sign = offset > 0 ? '+' : '-'
    return {
      desc: `${side} side ${absOff.toFixed(2)}m ${direction} edge`,
      formula: `-specs.halfWidth ${sign} ${absOff}`,
    }
  } else {
    // Left side: px is positive, halfWidth reference is +halfWidth
    const offset = roundTo4(px - halfWidth)
    if (Math.abs(offset) < 0.005) {
      return { desc: `${side} side at edge`, formula: 'specs.halfWidth' }
    }
    const direction = offset > 0 ? 'outward from' : 'inward from'
    const absOff = Math.abs(offset)
    const sign = offset > 0 ? '+' : '-'
    return {
      desc: `${side} side ${absOff.toFixed(2)}m ${direction} edge`,
      formula: `specs.halfWidth ${sign} ${absOff}`,
    }
  }
}

/* ─── Level (Y) description ───────────────────────────────────────────────── */

function describeLevel(
  py: number,
  baseplateTop: number,
  eaveHeight: number,
  ridgeHeight: number
): AxisDescription {
  const eaveY = baseplateTop + eaveHeight
  const ridgeY = baseplateTop + ridgeHeight

  // Reference points sorted by distance from py
  const refs = [
    { name: 'ground', label: 'Ground level (baseplate top)', y: baseplateTop, formula: 'baseplateTop' },
    { name: 'eave', label: 'Eave height', y: eaveY, formula: 'baseplateTop + specs.eaveHeight' },
    { name: 'ridge', label: 'Ridge height', y: ridgeY, formula: 'baseplateTop + specs.ridgeHeight' },
  ].sort((a, b) => Math.abs(py - a.y) - Math.abs(py - b.y))

  const best = refs[0]
  const offset = roundTo4(py - best.y)

  // Exact match
  if (Math.abs(offset) < 0.005) {
    return { desc: best.label, formula: best.formula }
  }

  const absOff = Math.abs(offset)
  const vertDir = offset > 0 ? 'above' : 'below'
  let desc = `${absOff.toFixed(2)}m ${vertDir} ${best.name}`

  // Extra context for arch zone
  if (best.name === 'eave' && offset > 0 && py < ridgeY) {
    desc += ' (in arch zone)'
  }

  const sign = offset > 0 ? '+' : '-'
  return {
    desc,
    formula: `${best.formula} ${sign} ${absOff}`,
  }
}

/* ─── Z position description ──────────────────────────────────────────────── */

function describeZ(pz: number, lineZs: number[]): AxisDescription {
  const nearest = findNearestLine(pz, lineZs)
  const lineLabel = describeFrameLineIndex(nearest.index, lineZs.length)

  if (Math.abs(nearest.offset) < 0.005) {
    return {
      desc: `${lineLabel} at Z=${nearest.z.toFixed(1)}m`,
      formula: `lineZs[${nearest.index}]`,
    }
  }

  const direction = nearest.offset > 0 ? 'toward back' : 'toward front'
  const absOff = Math.abs(nearest.offset)
  const sign = nearest.offset > 0 ? '+' : '-'
  return {
    desc: `${absOff.toFixed(3)}m ${direction} from ${lineLabel}`,
    formula: `lineZs[${nearest.index}] ${sign} ${absOff}`,
  }
}

/* ─── Rotation description ────────────────────────────────────────────────── */

function describeRotation(rx: number, ry: number, rz: number): string {
  const dRx = radToDeg(rx)
  const dRy = radToDeg(ry)
  const dRz = radToDeg(rz)
  const parts: string[] = []

  if (Math.abs(dRx) > 0.5) {
    const suffix = Math.abs(Math.abs(dRx) - 180) < 1.5 ? ' (flipped)' : ''
    parts.push(`Pitch: ${dRx}deg${suffix}`)
  }
  if (Math.abs(dRy) > 0.5) {
    const suffix = Math.abs(Math.abs(dRy) - 180) < 1.5 ? ' (reversed)' : ''
    parts.push(`Yaw: ${dRy}deg${suffix}`)
  }
  if (Math.abs(dRz) > 0.5) {
    parts.push(`Roll: ${dRz}deg`)
  }

  return parts.length > 0 ? parts.join(' | ') : 'No rotation'
}

/* ─── Mirror description ──────────────────────────────────────────────────── */

function describeMirrors(mirrors: MirrorFlags): string {
  const labels: string[] = []
  if (mirrors.x) labels.push('X (Left/Right)')
  if (mirrors.z) labels.push('Z (Front/Back)')
  if (mirrors.xz) labels.push('XZ (Diagonal)')

  if (labels.length === 0) return 'No mirrors (single instance)'

  const total = 1 + (mirrors.x ? 1 : 0) + (mirrors.z ? 1 : 0) + (mirrors.xz ? 1 : 0)
  return `${labels.join(', ')} — ${total} total copies`
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Export: Rich Code
   ═══════════════════════════════════════════════════════════════════════════ */

export function generateRichCode(ctx: CodeExportContext): string {
  const {
    glb, transform: v, axisScale: sc, modelRotation: modelRot, modelUsedQuaternion,
    mirrors, dimensions, specs, numBays, lineZs, baseplateTop, halfLength,
  } = ctx

  const side = describeSide(v.px, specs.halfWidth)
  const level = describeLevel(v.py, baseplateTop, specs.eaveHeight, specs.ridgeHeight)
  const zDesc = describeZ(v.pz, lineZs)
  const orientation = describeRotation(v.rx, v.ry, v.rz)
  const mirrorDesc = describeMirrors(mirrors)

  const pos = new Vector3(v.px, v.py, v.pz)
  const rot = new Vector3(v.rx, v.ry, v.rz)
  const slug = glb.label.toLowerCase().replace(/\s+/g, '-')
  const bar = '═'.repeat(61)

  // Describe modelNode rotation for the guide
  const modelRotDesc = (Math.abs(modelRot.x) < 0.001 && Math.abs(modelRot.z) < 0.001 && Math.abs(modelRot.y - Math.PI) < 0.01)
    ? 'Y=PI (standard GLTF handedness)'
    : `(${radToDeg(modelRot.x)}deg, ${radToDeg(modelRot.y)}deg, ${radToDeg(modelRot.z)}deg)`

  let c = ''

  // ── Header ──
  c += `// ${bar}\n`
  c += `// Part:  ${glb.label}\n`
  c += `// GLB:   ${glb.folder}${glb.file}\n`
  c += `// ${bar}\n`
  c += `//\n`

  // ── Placement guide ──
  c += `// PLACEMENT GUIDE:\n`
  c += `//   Side:        ${side.desc}\n`
  c += `//   Level:       ${level.desc}\n`
  c += `//   Frame line:  ${zDesc.desc}\n`
  c += `//   Orientation: ${orientation}\n`
  c += `//   Mirrors:     ${mirrorDesc}\n`
  c += `//   Model rot:   ${modelRotDesc}  <- GLTF handedness (always Y=PI for standard GLTF)\n`
  c += `//   Model scale:  ${sc.x}, ${sc.y}, ${sc.z}\n`
  c += `//   Dimensions:  ${dimensions.w.toFixed(3)} x ${dimensions.h.toFixed(3)} x ${dimensions.d.toFixed(3)} m (W x H x D)\n`
  c += `//\n`

  // ── Node hierarchy ──
  c += `// NODE HIERARCHY (two-node setup):\n`
  c += `//   root (TransformNode, parented to tent root or builder-root)\n`
  c += `//     └─ partNode (TransformNode) — holds position & rotation\n`
  c += `//          └─ modelNode (TransformNode) — holds scale & GLTF root transform\n`
  c += `//               └─ mesh(es) — actual GLB geometry\n`
  c += `//\n`
  c += `//   Why two nodes?\n`
  c += `//     partNode  = WHERE the part goes (position + rotation in world space)\n`
  c += `//     modelNode = HOW the part looks (scale + GLTF coordinate conversion)\n`
  c += `//     Keeping them separate means scaling never affects position offsets.\n`
  c += `//\n`

  // ── Specs-relative formulas ──
  c += `// SPECS-RELATIVE FORMULAS (use these in component code):\n`
  c += `//   X: ${side.formula}\n`
  c += `//   Y: ${level.formula}\n`
  c += `//   Z: ${zDesc.formula}\n`
  c += `//\n`

  // ── Tent context ──
  c += `// TENT CONTEXT:\n`
  c += `//   tent:             ${specs.name}\n`
  c += `//   specs.halfWidth   = ${specs.halfWidth}m\n`
  c += `//   specs.eaveHeight  = ${specs.eaveHeight}m\n`
  c += `//   specs.ridgeHeight = ${specs.ridgeHeight}m\n`
  c += `//   specs.bayDistance  = ${specs.bayDistance}m\n`
  c += `//   baseplateTop      = ${baseplateTop}m  (specs.baseplate.height)\n`
  c += `//   numBays           = ${numBays}\n`
  c += `//   halfLength        = ${halfLength}m  (numBays * specs.bayDistance / 2)\n`
  c += `//   frameLines [Z]:   [${lineZs.map((z) => z.toFixed(3)).join(', ')}]\n`
  c += `// ${bar}\n`

  // ── Parametric code ──
  c += `\n// ── Parametric code (adapts to tent size) ─────────────────────\n`
  c += `const partNode = new TransformNode('${slug}', scene)\n`
  c += `partNode.rotationQuaternion = null\n`
  c += `partNode.parent = root  // parent to tent root TransformNode\n\n`
  c += `const modelNode = new TransformNode('${slug}-model', scene)\n`
  c += `modelNode.rotationQuaternion = null\n`
  c += `modelNode.parent = partNode\n\n`
  c += `const loaded = await loadGLB(scene, '${glb.folder}', '${glb.file}')\n`
  c += `const meshes = loaded.filter((m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0)\n`
  c += `stripAndApplyMaterial(meshes, aluminumMat)\n`
  c += `for (const mesh of meshes) {\n`
  c += `  if (mesh.rotationQuaternion) {\n`
  c += `    const euler = mesh.rotationQuaternion.toEulerAngles()\n`
  c += `    mesh.rotationQuaternion = null\n`
  c += `    mesh.rotation.copyFrom(euler)\n`
  c += `  }\n`
  c += `  mesh.parent = modelNode\n`
  c += `}\n\n`
  c += `modelNode.scaling.set(${sc.x}, ${sc.y}, ${sc.z})\n`
  // Include the GLTF __root__ rotation — this is critical for correct orientation
  if (modelUsedQuaternion) {
    c += `// GLTF __root__ used a quaternion — safest to read it from the loaded GLB:\n`
    c += `// const rootMesh = loaded.find(m => m.name === '__root__')\n`
    c += `// modelNode.rotationQuaternion = rootMesh?.rotationQuaternion?.clone()\n`
    c += `// For reference, the current value in euler: (${roundTo4(modelRot.x)}, ${roundTo4(modelRot.y)}, ${roundTo4(modelRot.z)})\n`
    c += `modelNode.rotation.set(${roundTo4(modelRot.x)}, ${roundTo4(modelRot.y)}, ${roundTo4(modelRot.z)})  // ${modelRotDesc}\n\n`
  } else {
    c += `modelNode.rotation.set(${roundTo4(modelRot.x)}, ${roundTo4(modelRot.y)}, ${roundTo4(modelRot.z)})  // GLTF __root__: ${modelRotDesc}\n\n`
  }

  // ── Position (parametric) ──
  c += `// Position & rotation on partNode (world placement)\n`
  c += `partNode.position.set(\n`
  c += `  ${side.formula},  // X: ${side.desc}\n`
  c += `  ${level.formula},  // Y: ${level.desc}\n`
  c += `  ${zDesc.formula},  // Z: ${zDesc.desc}\n`
  c += `)\n`
  c += `//   -> resolves to (${v.px}, ${v.py}, ${v.pz})\n\n`

  // ── Rotation ──
  c += `partNode.rotation.set(${roundTo4(v.rx)}, ${roundTo4(v.ry)}, ${roundTo4(v.rz)})  // ${orientation}\n`

  // ── Raw values ──
  c += `\n// ── Raw values (for quick testing, not recommended for production) ──\n`
  c += `// partNode.position.set(${v.px}, ${v.py}, ${v.pz})\n`
  c += `// partNode.rotation.set(${roundTo4(v.rx)}, ${roundTo4(v.ry)}, ${roundTo4(v.rz)})`
  c += `  // (${radToDeg(v.rx)}deg, ${radToDeg(v.ry)}deg, ${radToDeg(v.rz)}deg)\n`

  // ── Mirror instances ──
  if (mirrors.x || mirrors.z || mirrors.xz) {
    c += `\n// ── Mirror instances ──────────────────────────────────────────\n`

    for (const cfg of MIRROR_CONFIGS) {
      if (!mirrors[cfg.axis]) continue
      const mp = cfg.posFn(pos)
      const mr = cfg.rotFn(rot)
      const tag = cfg.axis.toUpperCase()

      c += `\n// Mirror ${tag} — ${cfg.desc}\n`
      c += `const mirror${tag}Part = new TransformNode('${slug}-mirror-${cfg.axis}', scene)\n`
      c += `mirror${tag}Part.rotationQuaternion = null\n`
      c += `mirror${tag}Part.parent = root\n`

      c += `const mirror${tag}Model = new TransformNode('${slug}-mirror-${cfg.axis}-model', scene)\n`
      c += `mirror${tag}Model.rotationQuaternion = null\n`
      c += `mirror${tag}Model.parent = mirror${tag}Part\n`
      c += `mirror${tag}Model.scaling.set(${sc.x}, ${sc.y}, ${sc.z})\n`
      c += `mirror${tag}Model.rotation.set(${roundTo4(modelRot.x)}, ${roundTo4(modelRot.y)}, ${roundTo4(modelRot.z)})  // GLTF __root__\n`

      c += `// Clone meshes to mirror${tag}Model...\n\n`

      c += `mirror${tag}Part.position.set(${roundTo4(mp.x)}, ${roundTo4(mp.y)}, ${roundTo4(mp.z)})\n`
      c += `mirror${tag}Part.rotation.set(${roundTo4(mr.x)}, ${roundTo4(mr.y)}, ${roundTo4(mr.z)})`
      c += `  // (${radToDeg(mr.x)}deg, ${radToDeg(mr.y)}deg, ${radToDeg(mr.z)}deg)\n`
    }
  }

  return c
}

/* ═══════════════════════════════════════════════════════════════════════════
   Main Export: Rich JSON
   ═══════════════════════════════════════════════════════════════════════════ */

export function generateRichJSON(ctx: CodeExportContext): string {
  const {
    glb, transform: v, axisScale: sc, modelRotation: modelRot,
    mirrors, dimensions, specs, numBays, lineZs, baseplateTop, halfLength,
  } = ctx

  const side = describeSide(v.px, specs.halfWidth)
  const level = describeLevel(v.py, baseplateTop, specs.eaveHeight, specs.ridgeHeight)
  const zDesc = describeZ(v.pz, lineZs)
  const orientation = describeRotation(v.rx, v.ry, v.rz)

  const pos = new Vector3(v.px, v.py, v.pz)
  const rot = new Vector3(v.rx, v.ry, v.rz)

  const placements: Record<string, unknown> = {
    original: {
      position: { x: v.px, y: v.py, z: v.pz },
      rotation_rad: { x: roundTo4(v.rx), y: roundTo4(v.ry), z: roundTo4(v.rz) },
      rotation_deg: { x: radToDeg(v.rx), y: radToDeg(v.ry), z: radToDeg(v.rz) },
    },
  }

  for (const cfg of MIRROR_CONFIGS) {
    if (!mirrors[cfg.axis]) continue
    const mp = cfg.posFn(pos)
    const mr = cfg.rotFn(rot)
    placements[`mirror_${cfg.axis}`] = {
      desc: cfg.desc,
      position: { x: roundTo4(mp.x), y: roundTo4(mp.y), z: roundTo4(mp.z) },
      rotation_rad: { x: roundTo4(mr.x), y: roundTo4(mr.y), z: roundTo4(mr.z) },
      rotation_deg: { x: radToDeg(mr.x), y: radToDeg(mr.y), z: radToDeg(mr.z) },
    }
  }

  const output = {
    part: glb.label,
    glb: `${glb.folder}${glb.file}`,
    modelNode: {
      scale: sc,
      rotation_rad: { x: roundTo4(modelRot.x), y: roundTo4(modelRot.y), z: roundTo4(modelRot.z) },
      rotation_deg: { x: radToDeg(modelRot.x), y: radToDeg(modelRot.y), z: radToDeg(modelRot.z) },
      note: 'from GLTF __root__ — read from loaded GLB, do not hardcode',
    },
    dimensions: {
      width: dimensions.w,
      height: dimensions.h,
      depth: dimensions.d,
    },
    placement: {
      side: side.desc,
      level: level.desc,
      frameLine: zDesc.desc,
      orientation,
    },
    formulas: {
      x: side.formula,
      y: level.formula,
      z: zDesc.formula,
    },
    mirrors,
    placements,
    tentContext: {
      tent: specs.name,
      halfWidth: specs.halfWidth,
      eaveHeight: specs.eaveHeight,
      ridgeHeight: specs.ridgeHeight,
      bayDistance: specs.bayDistance,
      baseplateTop,
      numBays,
      halfLength,
      frameLines: lineZs,
    },
  }

  return JSON.stringify(output, null, 2)
}

function normalizeComponentName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9]+/g, ' ').trim()
  const pascal = cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('')
  return pascal || 'GeneratedFramePart'
}

function placementLoop(pattern: PlacementPattern): string {
  switch (pattern) {
    case 'both-sides-every-bay':
      return `for (let i = 0; i <= numBays; i++) {
          const z = i * specs.bayDistance - halfLength
          for (const side of [-1, 1]) {
            partMatrices.push(
              Matrix.Compose(
                Vector3.One(),
                PART_ROT_QUAT,
                new Vector3(side * specs.halfWidth, BASE_Y, z),
              ),
            )
          }
        }`
    case 'gable-ends-only':
      return `for (const z of [-halfLength, halfLength]) {
          partMatrices.push(
            Matrix.Compose(
              Vector3.One(),
              PART_ROT_QUAT,
              new Vector3(BASE_X, BASE_Y, z),
            ),
          )
        }`
    case 'every-frame-line':
      return `for (let i = 0; i <= numBays; i++) {
          const z = i * specs.bayDistance - halfLength
          partMatrices.push(
            Matrix.Compose(
              Vector3.One(),
              PART_ROT_QUAT,
              new Vector3(BASE_X, BASE_Y, z),
            ),
          )
        }`
    case 'single-instance':
    default:
      return `partMatrices.push(
          Matrix.Compose(
            Vector3.One(),
            PART_ROT_QUAT,
            new Vector3(BASE_X, BASE_Y, BASE_Z),
          ),
        )`
  }
}

export function generateComponentFile(
  ctx: CodeExportContext,
  options: ComponentExportOptions,
): string {
  const componentName = normalizeComponentName(options.componentName)
  const loopBody = placementLoop(options.placementPattern)
  const yRotComment = `Quaternion.FromEulerAngles(${roundTo4(ctx.modelRotation.x)}, ${roundTo4(ctx.modelRotation.y)}, ${roundTo4(ctx.modelRotation.z)})`

  return `import { type FC, useEffect, memo, useRef } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import { TransformNode, Mesh, Vector3, Quaternion, Matrix } from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

const FOLDER = '${ctx.glb.folder}'
const FILE = '${ctx.glb.file}'

const MODEL_SCALE = new Vector3(${ctx.axisScale.x}, ${ctx.axisScale.y}, ${ctx.axisScale.z})
const MODEL_ROT_QUAT = ${yRotComment}
const PART_ROT_QUAT = Quaternion.FromEulerAngles(${roundTo4(ctx.transform.rx)}, ${roundTo4(ctx.transform.ry)}, ${roundTo4(ctx.transform.rz)})

interface ${componentName}Props {
  numBays: number
  specs: TentSpecs
  enabled: boolean
  onLoadStateChange?: (loading: boolean) => void
}

export const ${componentName}: FC<${componentName}Props> = memo(({
  numBays, specs, enabled, onLoadStateChange
}) => {
  const scene = useScene()
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!scene || !enabled) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    const root = new TransformNode('${componentName}-root', scene)
    const allDisposables: (Mesh | TransformNode)[] = [root]
    const aluminumMat = getAluminumMaterial(scene)

    onLoadStateChange?.(true)

    loadGLB(scene, FOLDER, FILE, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) {
          for (const m of loaded) m.dispose()
          onLoadStateChange?.(false)
          return
        }

        const geoMeshes = loaded.filter(
          (m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
        )
        if (!geoMeshes.length) {
          for (const m of loaded) {
            try { m.dispose() } catch {}
          }
          onLoadStateChange?.(false)
          return
        }
        for (const m of loaded) {
          if (!geoMeshes.includes(m as Mesh)) {
            try { m.dispose() } catch {}
          }
        }

        stripAndApplyMaterial(geoMeshes, aluminumMat)

        const meshLocals = new Map<Mesh, Matrix>()
        for (const mesh of geoMeshes) {
          const rot = mesh.rotationQuaternion?.clone()
            ?? Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z)
          meshLocals.set(mesh, Matrix.Compose(mesh.scaling.clone(), rot, mesh.position.clone()))
        }

        const modelMatrix = Matrix.Compose(MODEL_SCALE, MODEL_ROT_QUAT, Vector3.Zero())

        const baseplateTop = specs.baseplate?.height ?? 0
        const halfLength = (numBays * specs.bayDistance) / 2
        const BASE_X = ${ctx.transform.px}
        const BASE_Y = ${ctx.transform.py}
        const BASE_Z = ${ctx.transform.pz}

        const partMatrices: Matrix[] = []
        ${loopBody}

        for (const src of geoMeshes) {
          const meshLocal = meshLocals.get(src) ?? Matrix.Identity()
          const prefix = meshLocal.multiply(modelMatrix)
          const buf = new Float32Array(partMatrices.length * 16)
          for (let j = 0; j < partMatrices.length; j++) {
            prefix.multiply(partMatrices[j]).copyToArray(buf, j * 16)
          }

          src.parent = root
          src.position.setAll(0)
          src.rotationQuaternion = null
          src.rotation.setAll(0)
          src.scaling.setAll(1)
          src.setEnabled(true)
          src.thinInstanceSetBuffer('matrix', buf, 16)
          src.thinInstanceRefreshBoundingInfo(false)
          src.alwaysSelectAsActiveMesh = true
          src.freezeWorldMatrix()
          src.freezeNormals()
          allDisposables.push(src)
        }

        onLoadStateChange?.(false)
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error('${componentName}: load failed', err)
        }
        onLoadStateChange?.(false)
      })

    return () => {
      controller.abort()
      for (const d of allDisposables) {
        try { d.dispose() } catch {}
      }
    }
  }, [scene, enabled, specs, numBays, onLoadStateChange])

  return null
})
`
}
