/**
 * PartBuilder — Interactive visual tool to position tent parts.
 *
 * Load any GLB from `public/`, drag/rotate/scale it with Babylon gizmos,
 * and read the exact transforms.  "Mirror" clones the part for the opposite
 * tent side.  "Copy Transforms" exports JSON you can paste into code.
 *
 * Usage:  Drop <PartBuilder specs={TENT_SPECS} numBays={3} /> into the scene.
 */

import { type FC, useEffect, useRef, useState, useCallback, memo } from 'react'
import { useScene } from '@/engine/BabylonProvider'
import {
	Mesh,
	MeshBuilder,
	TransformNode,
	Color3,
	GizmoManager,
	UtilityLayerRenderer,
	PBRMetallicRoughnessMaterial,
	StandardMaterial,
} from '@babylonjs/core'
import { loadGLB, stripAndApplyMaterial } from '@/lib/utils/GLBLoader'
import { getAluminumMaterial } from '@/lib/materials/frameMaterials'
import type { TentSpecs } from '@/types'

// ── Available GLB parts ──────────────────────────────────────────────────────

interface GLBOption {
	label: string
	folder: string
	file: string
}

const GLB_PARTS: GLBOption[] = [
	{ label: 'Upright Connector R', folder: '/tents/SharedFrames/', file: 'upright-connector-r.glb' },
	{ label: 'Connector Triangle', folder: '/tents/SharedFrames/', file: 'connector-triangle.glb' },
	{ label: 'Eave Side Beam', folder: '/tents/SharedFrames/', file: 'eave-side-beam.glb' },
	{ label: 'Gable Support 77x127', folder: '/tents/SharedFrames/', file: 'gable-support-77x127.glb' },
	{ label: 'Gable Beam 80x150', folder: '/tents/SharedFrames/', file: 'gable-beam-80x150.glb' },
	{ label: 'Baseplates', folder: '/tents/SharedFrames/', file: 'basePlates.glb' },
	{ label: 'Upright 15m', folder: '/tents/PremiumArchTent/15m/frame/', file: 'upright.glb' },
]

// ── Transform state ──────────────────────────────────────────────────────────

interface TransformValues {
	px: number; py: number; pz: number
	rx: number; ry: number; rz: number
	sx: number; sy: number; sz: number
}

const ZERO_TRANSFORM: TransformValues = {
	px: 0, py: 0, pz: 0,
	rx: 0, ry: 0, rz: 0,
	sx: 1, sy: 1, sz: 1,
}

function rad2deg(r: number) { return Math.round(r * 180 / Math.PI * 100) / 100 }
function round4(n: number) { return Math.round(n * 10000) / 10000 }

// ── Props ────────────────────────────────────────────────────────────────────

interface PartBuilderProps {
	specs: TentSpecs
	numBays: number
}

// ── Component ────────────────────────────────────────────────────────────────

export const PartBuilder: FC<PartBuilderProps> = memo(({ specs, numBays }) => {
	const scene = useScene()

	// Refs
	const rootRef = useRef<TransformNode | null>(null)
	const partNodeRef = useRef<TransformNode | null>(null)
	const partMeshesRef = useRef<Mesh[]>([])
	const mirrorNodeRef = useRef<TransformNode | null>(null)
	const mirrorMeshesRef = useRef<Mesh[]>([])
	const gizmoManagerRef = useRef<GizmoManager | null>(null)
	const referenceRef = useRef<Mesh[]>([])
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

	// State
	const [selectedPart, setSelectedPart] = useState(0)
	const [gizmoMode, setGizmoMode] = useState<'position' | 'rotation' | 'scale'>('position')
	const [transform, setTransform] = useState<TransformValues>(ZERO_TRANSFORM)
	const [mirrorEnabled, setMirrorEnabled] = useState(false)
	const [copied, setCopied] = useState(false)

	// ── Read transform from the part node ──
	const readTransform = useCallback((): TransformValues => {
		const node = partNodeRef.current
		if (!node) return ZERO_TRANSFORM
		node.computeWorldMatrix(true)
		return {
			px: round4(node.position.x),
			py: round4(node.position.y),
			pz: round4(node.position.z),
			rx: round4(node.rotation.x),
			ry: round4(node.rotation.y),
			rz: round4(node.rotation.z),
			sx: round4(node.scaling.x),
			sy: round4(node.scaling.y),
			sz: round4(node.scaling.z),
		}
	}, [])

	// ── Update mirror to match ──
	const updateMirror = useCallback(() => {
		const node = partNodeRef.current
		const mirror = mirrorNodeRef.current
		if (!node || !mirror) return
		// Mirror across X axis (opposite tent side)
		mirror.position.set(-node.position.x, node.position.y, node.position.z)
		mirror.rotation.set(node.rotation.x, -node.rotation.y + Math.PI, -node.rotation.z)
		mirror.scaling.copyFrom(node.scaling)
	}, [])

	// ── Poll transform values from gizmo interaction ──
	useEffect(() => {
		pollRef.current = setInterval(() => {
			const t = readTransform()
			setTransform(prev => {
				if (
					prev.px === t.px && prev.py === t.py && prev.pz === t.pz &&
					prev.rx === t.rx && prev.ry === t.ry && prev.rz === t.rz &&
					prev.sx === t.sx && prev.sy === t.sy && prev.sz === t.sz
				) return prev
				if (mirrorEnabled) updateMirror()
				return t
			})
		}, 100)
		return () => { if (pollRef.current) clearInterval(pollRef.current) }
	}, [readTransform, mirrorEnabled, updateMirror])

	// ── Create reference geometry (uprights as wireframe boxes) ──
	const createReferenceGeometry = useCallback((sc: NonNullable<typeof scene>) => {
		// Dispose old
		for (const m of referenceRef.current) { try { m.dispose() } catch { /* */ } }
		referenceRef.current = []

		const refMat = new StandardMaterial('builder-ref-mat', sc)
		refMat.wireframe = true
		refMat.diffuseColor = new Color3(0.3, 0.5, 0.8)
		refMat.alpha = 0.6

		const highlightMat = new StandardMaterial('builder-highlight-mat', sc)
		highlightMat.diffuseColor = new Color3(0.9, 0.6, 0.1)
		highlightMat.alpha = 0.4

		const totalLength = numBays * specs.bayDistance
		const halfLength = totalLength / 2
		const baseplateTop = specs.baseplate?.height ?? 0
		const uprightH = specs.eaveHeight
		const numLines = numBays + 1

		for (let i = 0; i < numLines; i++) {
			const z = i * specs.bayDistance - halfLength
			for (const side of [-1, 1]) {
				const x = side * specs.halfWidth
				// Upright box
				const upright = MeshBuilder.CreateBox(`ref-upright-${i}-${side}`, {
					width: specs.profiles.upright.width,
					height: uprightH,
					depth: specs.profiles.upright.height,
				}, sc)
				upright.material = refMat
				upright.position.set(x, baseplateTop + uprightH / 2, z)
				upright.isPickable = false
				referenceRef.current.push(upright)

				// Highlight disc at top of upright (where connector goes)
				const disc = MeshBuilder.CreateDisc(`ref-top-${i}-${side}`, { radius: 0.15 }, sc)
				disc.material = highlightMat
				disc.rotation.x = Math.PI / 2
				disc.position.set(x, baseplateTop + uprightH, z)
				disc.isPickable = false
				referenceRef.current.push(disc)
			}
		}
	}, [numBays, specs])

	// ── Load selected GLB part ──
	const loadPart = useCallback(async (sc: NonNullable<typeof scene>, index: number) => {
		// Dispose old part
		for (const m of partMeshesRef.current) { try { m.dispose() } catch { /* */ } }
		partMeshesRef.current = []
		if (partNodeRef.current) { try { partNodeRef.current.dispose() } catch { /* */ } }

		// Dispose old mirror
		for (const m of mirrorMeshesRef.current) { try { m.dispose() } catch { /* */ } }
		mirrorMeshesRef.current = []
		if (mirrorNodeRef.current) { try { mirrorNodeRef.current.dispose() } catch { /* */ } }

		const glb = GLB_PARTS[index]
		if (!glb) return

		const loaded = await loadGLB(sc, glb.folder, glb.file)
		const meshes = loaded.filter(
			(m): m is Mesh => m instanceof Mesh && m.getTotalVertices() > 0,
		)

		// Dispose non-geometry
		for (const m of loaded) {
			if (!meshes.includes(m as Mesh)) {
				try { m.dispose() } catch { /* */ }
			}
		}

		if (meshes.length === 0) return

		const mat = getAluminumMaterial(sc)
		stripAndApplyMaterial(meshes, mat)

		// Part node
		const partNode = new TransformNode('builder-part', sc)
		partNode.rotationQuaternion = null
		partNode.parent = rootRef.current
		partNodeRef.current = partNode

		for (const m of meshes) {
			m.rotationQuaternion = null
			m.parent = partNode
			m.setEnabled(true)
			m.isPickable = true
			partMeshesRef.current.push(m)
		}

		// Place at first right upright top by default
		const baseplateTop = specs.baseplate?.height ?? 0
		partNode.position.set(
			-specs.halfWidth,
			baseplateTop + specs.eaveHeight,
			-((numBays * specs.bayDistance) / 2),
		)

		// Mirror node
		const mirrorNode = new TransformNode('builder-mirror', sc)
		mirrorNode.rotationQuaternion = null
		mirrorNode.parent = rootRef.current
		mirrorNodeRef.current = mirrorNode

		const mirrorMat = new PBRMetallicRoughnessMaterial('builder-mirror-mat', sc)
		mirrorMat.baseColor = new Color3(0.2, 0.7, 0.9)
		mirrorMat.metallic = 0.8
		mirrorMat.roughness = 0.3
		mirrorMat.alpha = 0.7

		for (const m of meshes) {
			const clone = m.clone(m.name + '-mirror', mirrorNode)
			if (clone) {
				clone.material = mirrorMat
				clone.isPickable = false
				clone.setEnabled(mirrorEnabled)
				mirrorMeshesRef.current.push(clone)
			}
		}

		// Attach gizmo to part node
		if (gizmoManagerRef.current) {
			gizmoManagerRef.current.attachToNode(partNode)
		}

		// Read initial
		setTransform(readTransform())
		if (mirrorEnabled) updateMirror()
	}, [specs, numBays, mirrorEnabled, readTransform, updateMirror])

	// ── Setup scene, gizmo manager, reference geometry ──
	useEffect(() => {
		if (!scene) return

		const root = new TransformNode('builder-root', scene)
		rootRef.current = root

		// Gizmo manager
		const utilLayer = new UtilityLayerRenderer(scene)
		const gm = new GizmoManager(scene, undefined, utilLayer)
		gm.positionGizmoEnabled = true
		gm.rotationGizmoEnabled = false
		gm.scaleGizmoEnabled = false
		gm.usePointerToAttachGizmos = false // manual attach
		gizmoManagerRef.current = gm

		createReferenceGeometry(scene)
		loadPart(scene, selectedPart)

		return () => {
			if (pollRef.current) clearInterval(pollRef.current)
			gm.dispose()
			utilLayer.dispose()
			for (const m of referenceRef.current) { try { m.dispose() } catch { /* */ } }
			for (const m of partMeshesRef.current) { try { m.dispose() } catch { /* */ } }
			for (const m of mirrorMeshesRef.current) { try { m.dispose() } catch { /* */ } }
			if (partNodeRef.current) { try { partNodeRef.current.dispose() } catch { /* */ } }
			if (mirrorNodeRef.current) { try { mirrorNodeRef.current.dispose() } catch { /* */ } }
			root.dispose()
		}
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scene])

	// ── Gizmo mode switching ──
	useEffect(() => {
		const gm = gizmoManagerRef.current
		if (!gm) return
		gm.positionGizmoEnabled = gizmoMode === 'position'
		gm.rotationGizmoEnabled = gizmoMode === 'rotation'
		gm.scaleGizmoEnabled = gizmoMode === 'scale'
		if (partNodeRef.current) {
			gm.attachToNode(partNodeRef.current)
		}
	}, [gizmoMode])

	// ── Reload part on selection change ──
	useEffect(() => {
		if (!scene) return
		loadPart(scene, selectedPart)
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [selectedPart])

	// ── Toggle mirror visibility ──
	useEffect(() => {
		for (const m of mirrorMeshesRef.current) {
			m.setEnabled(mirrorEnabled)
		}
		if (mirrorEnabled) updateMirror()
	}, [mirrorEnabled, updateMirror])

	// ── Manual transform input ──
	const applyManualTransform = useCallback((field: keyof TransformValues, value: number) => {
		const node = partNodeRef.current
		if (!node) return
		const t = { ...transform, [field]: value }
		node.position.set(t.px, t.py, t.pz)
		node.rotation.set(t.rx, t.ry, t.rz)
		node.scaling.set(t.sx, t.sy, t.sz)
		setTransform(t)
		if (mirrorEnabled) updateMirror()
	}, [transform, mirrorEnabled, updateMirror])

	// ── Copy transforms ──
	const handleCopy = useCallback(() => {
		const t = readTransform()
		const json = {
			position: { x: t.px, y: t.py, z: t.pz },
			rotation: { x: t.rx, y: t.ry, z: t.rz },
			rotationDeg: { x: rad2deg(t.rx), y: rad2deg(t.ry), z: rad2deg(t.rz) },
			scaling: { x: t.sx, y: t.sy, z: t.sz },
			glb: GLB_PARTS[selectedPart],
		}
		navigator.clipboard.writeText(JSON.stringify(json, null, 2)).then(() => {
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		})
	}, [readTransform, selectedPart])

	// ── Render UI panel ──
	return (
		<div style={styles.panel}>
			<h3 style={styles.title}>Part Builder</h3>

			{/* Part selector */}
			<label style={styles.label}>GLB Part</label>
			<select
				style={styles.select}
				value={selectedPart}
				onChange={(e) => setSelectedPart(Number(e.target.value))}
			>
				{GLB_PARTS.map((p, i) => (
					<option key={i} value={i}>{p.label}</option>
				))}
			</select>

			{/* Gizmo mode */}
			<div style={styles.row}>
				{(['position', 'rotation', 'scale'] as const).map(mode => (
					<button
						key={mode}
						style={{
							...styles.modeBtn,
							...(gizmoMode === mode ? styles.modeBtnActive : {}),
						}}
						onClick={() => setGizmoMode(mode)}
					>
						{mode.charAt(0).toUpperCase() + mode.slice(1)}
					</button>
				))}
			</div>

			{/* Transform values */}
			<div style={styles.section}>
				<div style={styles.sectionTitle}>Position</div>
				{(['px', 'py', 'pz'] as const).map(f => (
					<div key={f} style={styles.fieldRow}>
						<span style={styles.fieldLabel}>{f[1].toUpperCase()}</span>
						<input
							type="number"
							step={0.01}
							style={styles.input}
							value={transform[f]}
							onChange={(e) => applyManualTransform(f, parseFloat(e.target.value) || 0)}
						/>
					</div>
				))}
			</div>

			<div style={styles.section}>
				<div style={styles.sectionTitle}>Rotation (rad / deg)</div>
				{(['rx', 'ry', 'rz'] as const).map(f => (
					<div key={f} style={styles.fieldRow}>
						<span style={styles.fieldLabel}>{f[1].toUpperCase()}</span>
						<input
							type="number"
							step={0.01}
							style={styles.input}
							value={transform[f]}
							onChange={(e) => applyManualTransform(f, parseFloat(e.target.value) || 0)}
						/>
						<span style={styles.degLabel}>{rad2deg(transform[f])}°</span>
					</div>
				))}
			</div>

			<div style={styles.section}>
				<div style={styles.sectionTitle}>Scale</div>
				{(['sx', 'sy', 'sz'] as const).map(f => (
					<div key={f} style={styles.fieldRow}>
						<span style={styles.fieldLabel}>{f[1].toUpperCase()}</span>
						<input
							type="number"
							step={0.01}
							style={styles.input}
							value={transform[f]}
							onChange={(e) => applyManualTransform(f, parseFloat(e.target.value) || 0)}
						/>
					</div>
				))}
			</div>

			{/* Mirror toggle */}
			<div style={styles.row}>
				<button
					style={{
						...styles.actionBtn,
						...(mirrorEnabled ? styles.actionBtnActive : {}),
					}}
					onClick={() => setMirrorEnabled(!mirrorEnabled)}
				>
					{mirrorEnabled ? 'Mirror ON' : 'Mirror OFF'}
				</button>
			</div>

			{/* Copy */}
			<button style={styles.copyBtn} onClick={handleCopy}>
				{copied ? 'Copied!' : 'Copy Transforms'}
			</button>

			{/* Quick info */}
			<div style={styles.info}>
				Drag the gizmo arrows to position the part on the upright.
				Toggle Mirror to see it on the opposite tent side.
				Copy Transforms to paste into code.
			</div>
		</div>
	)
})

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
	panel: {
		position: 'fixed',
		top: 16,
		right: 16,
		width: 280,
		background: 'rgba(10, 10, 30, 0.92)',
		color: '#c8d0e0',
		borderRadius: 12,
		padding: 16,
		fontSize: 13,
		lineHeight: 1.5,
		border: '1px solid rgba(100,120,200,0.25)',
		backdropFilter: 'blur(10px)',
		zIndex: 100,
		maxHeight: 'calc(100vh - 32px)',
		overflowY: 'auto',
		fontFamily: "'Segoe UI', system-ui, sans-serif",
	},
	title: {
		margin: '0 0 12px',
		fontSize: 16,
		color: '#7eb8ff',
		fontWeight: 600,
	},
	label: {
		display: 'block',
		fontSize: 11,
		color: '#8090a8',
		marginBottom: 4,
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	select: {
		width: '100%',
		padding: '6px 8px',
		background: 'rgba(30,30,60,0.8)',
		color: '#c8d0e0',
		border: '1px solid rgba(100,120,200,0.3)',
		borderRadius: 6,
		fontSize: 13,
		marginBottom: 12,
		outline: 'none',
	},
	row: {
		display: 'flex',
		gap: 6,
		marginBottom: 12,
	},
	modeBtn: {
		flex: 1,
		padding: '6px 0',
		background: 'rgba(30,30,60,0.6)',
		color: '#8090a8',
		border: '1px solid rgba(100,120,200,0.2)',
		borderRadius: 6,
		cursor: 'pointer',
		fontSize: 12,
		transition: 'all 0.2s',
	},
	modeBtnActive: {
		background: 'rgba(60,80,160,0.7)',
		color: '#fff',
		borderColor: '#7eb8ff',
	},
	section: {
		marginBottom: 10,
		padding: '8px 0',
		borderTop: '1px solid rgba(100,120,200,0.15)',
	},
	sectionTitle: {
		fontSize: 11,
		color: '#6fea8d',
		marginBottom: 6,
		fontWeight: 600,
		textTransform: 'uppercase',
		letterSpacing: 0.5,
	},
	fieldRow: {
		display: 'flex',
		alignItems: 'center',
		gap: 6,
		marginBottom: 4,
	},
	fieldLabel: {
		width: 16,
		fontSize: 12,
		fontWeight: 700,
		color: '#7eb8ff',
	},
	input: {
		flex: 1,
		padding: '4px 6px',
		background: 'rgba(20,20,50,0.8)',
		color: '#c8d0e0',
		border: '1px solid rgba(100,120,200,0.2)',
		borderRadius: 4,
		fontSize: 12,
		outline: 'none',
		fontFamily: 'monospace',
	},
	degLabel: {
		fontSize: 11,
		color: '#8090a8',
		minWidth: 50,
		textAlign: 'right' as const,
		fontFamily: 'monospace',
	},
	actionBtn: {
		flex: 1,
		padding: '8px 0',
		background: 'rgba(30,30,60,0.6)',
		color: '#8090a8',
		border: '1px solid rgba(100,120,200,0.2)',
		borderRadius: 6,
		cursor: 'pointer',
		fontSize: 12,
		transition: 'all 0.2s',
	},
	actionBtnActive: {
		background: 'rgba(40,120,180,0.5)',
		color: '#fff',
		borderColor: '#4cc9f0',
	},
	copyBtn: {
		width: '100%',
		padding: '10px 0',
		background: 'linear-gradient(135deg, rgba(60,80,160,0.7), rgba(40,120,180,0.7))',
		color: '#fff',
		border: 'none',
		borderRadius: 8,
		cursor: 'pointer',
		fontSize: 13,
		fontWeight: 600,
		marginTop: 8,
		transition: 'all 0.2s',
	},
	info: {
		marginTop: 12,
		fontSize: 11,
		color: '#606880',
		lineHeight: 1.5,
	},
}
