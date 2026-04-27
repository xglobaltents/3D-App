# Copilot Instructions

3D tent configurator using **React 19**, **Babylon.js 8**, and **react-babylonjs**. Vite build tooling.

## Architecture

```
src/tents/{TentType}/{Variant}/     # Tent implementations
├── specs.ts                        # Dimensions, profiles, asset paths
├── index.tsx                       # Main component composing frame/covers
├── frame/*.tsx                     # Frame part components
└── covers/*.tsx                    # Cover components

src/lib/
├── utils/GLBLoader.ts              # loadGLBMesh(), createThinInstances()
├── constants/assetPaths.ts         # getFramePath(), getCoversPath() helpers
└── accessories/                    # Shared accessory components

public/tents/{TentType}/{Variant}/  # GLB 3D models (NOT in src/)
```

## Coordinate System

- **Specs/authoring**: Z-up (X=width, Y=length, Z=height)
- **Display**: Y-up (Babylon.js default) — rotation applied at App level

## Critical Patterns

### Frame Component Pattern
See [Baseplates.tsx](../src/tents/SharedFrames/Baseplates.tsx):
```tsx
export const Baseplates: FC<BaseplatesProps> = ({ enabled }) => {
  const scene = useScene()
  useEffect(() => {
    const root = new TransformNode('baseplates-root', scene)
    loadGLB(scene, '/tents/PremiumArchTent/frame/', 'basePlates.glb')
      .then((meshes) => { /* parent to root */ })
    return () => { /* cleanup: dispose meshes and root */ }
  }, [scene, enabled])
  return null
}
```

### GPU Instancing (Thin Instances)
Use for repeated geometry—purlins, baseplates, uprights:
```tsx
import { loadGLBMesh, createThinInstances } from '@/lib/utils/GLBLoader'
const mesh = await loadGLBMesh(scene, '/tents/PremiumArchTent/15m/frame/', 'baseplate.glb')
createThinInstances(mesh, positions.map(p => ({ position: p })))
```

### Required Types ([src/types/index.ts](../src/types/index.ts))
- `TentSpecs` — dimensions, profiles, measurements
- `FrameComponentProps` — `{ numBays, specs }`
- `CoverComponentProps` — `{ numBays, tentLength, specs }`
- `TentComponentProps` — `{ numBays, showFrame, showCovers, position }`

## Commands

```bash
npm run dev      # Dev server (hot reload)
npm run build    # tsc + vite build → dist/
npm run lint     # ESLint
```

## Rules

1. **Babylon.js only** — no Three.js, no `InstancedMesh`, no `useFrame()`, no drei
2. **GLB files in `public/`** — never import 3D assets into `src/`
3. **Use `specs.ts` for dimensions** — no hardcoded measurements in components
4. **Thin instances for repeated geometry** — `createThinInstances()` not `.clone()`
5. **`PBRMaterial` for all materials** — frame and cover parts both use PBR for consistent quality
6. **Share materials** — create once, reuse across instances
7. **No emojis in UI** — keep interface text clean
8. **Apply your own material to GLB meshes** — `loadGLB()` parses with `pluginOptions.gltf.skipMaterials = true`, so returned meshes have `material === null`. Always assign one before enabling:
   ```tsx
   const meshes = await loadGLB(scene, path, file)
   for (const mesh of meshes) {
     if (mesh instanceof Mesh) {
       mesh.material = sharedAluminumMaterial // Apply code-defined material
     }
   }
   ```
   Existing `stripAndApplyMaterial` helpers are kept for back-compat but the strip step is a no-op now.
9. **Uniform scaling only for GLB models** — always use `template.scaling.clone()` for thin instance scaling. Never use negative axis scaling (e.g. `new Vector3(-s, s, s)`) to mirror — it flips normals causing black faces. Mirror via `rotation.y = Math.PI` instead.
10. **Never read `__root__` from `loadGLB()` results** — `loadGLB()` returns clones from `result.meshes` only. The `__root__` TransformNode lives in `result.transformNodes` and is never included. Always create your own template TransformNode with explicit rotation/scaling.
11. **Never mutate the material singleton** — `getAluminumMaterial(scene)` returns a shared singleton. If a component needs different properties (e.g. `backFaceCulling = false`), clone it and dispose the clone in cleanup.
12. **Use `specs.halfWidth`** — never `specs.width / 2`. All components must be consistent.
13. **Create cloned materials before async calls** — keeps them in scope for the cleanup function. Creating inside `.then()` causes leaks.
14. **All positions (both sides) in one transforms array** — unless geometry differs per side (e.g. miter-cut uprights). Never split left/right into separate mesh sets for symmetric parts.

## GLB Loading Pattern (Frame Components)

All frame components **must** follow this standard pattern. See Baseplates.tsx for the reference implementation.

### Step-by-step:

1. **Effect setup**: AbortController, clear boundsCache, create root TransformNode, create material (clone if needed — before async)
2. **Load & filter**: `loadGLB()` → check abort → filter `instanceof Mesh && getTotalVertices() > 0` → dispose all non-geometry nodes
3. **Template container**: `stripAndApplyMaterial()` → create TransformNode → clear `rotationQuaternion` on all meshes → reset mesh transforms to identity → parent to template → apply known rotation/scaling on template (never extract from `__root__`)
4. **Bounds & offsets**: `computeWorldMatrix(true)` → `measureWorldBounds()` → compute centerOffsetX/Z
5. **Transforms array**: ALL positions (both sides) in one array → use `template.rotation.clone()` / `template.scaling.clone()`
6. **Apply thin instances**: reparent meshes to root → reset local transforms to identity → `setEnabled(true)` → `createFrozenThinInstances()` → track in allDisposables
7. **Cleanup**: dispose template container → in return: abort + dispose allDisposables + dispose cloned materials

### GLTF Handedness

GLTF is right-handed (Y-up, +Z toward viewer), BabylonJS is left-handed (+Z away). The loader's `__root__` node carries `rotation.y = Math.PI` for conversion, but since `__root__` is invisible to `loadGLB()`, each component handles it:
- **Baseplates**: `rotation.y = PI/2` (alignment rotation incidentally handles it; symmetric model)
- **Uprights**: `rotation.x = -PI/2` (Z-up → Y-up; manual rotation accounts for coordinate system)
- **Connectors**: `rotation.y = PI` in thin-instance transforms for right side; `rotation.y = 0` for left side (PI handedness + PI mirror = 0)

### BackFace Culling

| Component | Material | Culling | Reason |
|-----------|----------|---------|--------|
| Baseplates | Shared singleton | `true` (default) | Solid plate, only top visible |
| Uprights | Shared singleton | `true` (default) | GLB has proper inner face normals baked |
| Connectors | Cloned `aluminum-connectors` | `false` | Handedness rotation can flip winding order |

### Deviations

- **Asymmetric left/right geometry** (e.g. miter-cut uprights): separate mesh sets with separate transform arrays — the only valid reason to split
- **Custom material properties**: clone before async, dispose in cleanup

## Adding a New Tent

1. Create `src/tents/{TentType}/{Variant}/specs.ts` with `TentSpecs`
2. Create `src/tents/{TentType}/{Variant}/index.tsx` composing frame/covers
3. Add frame components in `frame/` using `FrameComponentProps`
4. Place GLBs in `public/tents/{TentType}/{Variant}/frame/` and `covers/`
5. Reference [PremiumArchTent-15m-structure.md](../docs/PremiumArchTent-15m-structure.md) for build guide format

## Environment Configuration

Scene environment (ground, sky, lighting) is configured in [SceneSetup.tsx](../src/components/SceneSetup.tsx).
Full settings reference: [docs/environment-settings.md](../docs/environment-settings.md)

Key settings:
- **Ground**: 600×600m terracotta (`#914e3e`)
- **Lighting**: Hemispheric (0.8) + Sun directional (1.5) + Fill (0.8) + Bottom fill (0.3)
- **Camera**: Arc rotate, radius 25m desktop / 40m mobile

## Performance Checklist

- Thin instances for all repeated geometry
- `mesh.freezeWorldMatrix()` for static meshes
- Shared materials across instances
- Do NOT use LOD on tent parts (creates visual inconsistency)
