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
See [Baseplates.tsx](../src/tents/PremiumArchTent/frame/Baseplates.tsx):
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
5. **`StandardMaterial` for frame** — reserve `PBRMaterial` for covers/reflective
6. **Share materials** — create once, reuse across instances
7. **No emojis in UI** — keep interface text clean
8. **Remove GLB materials** — strip default materials from loaded GLBs, apply materials via code:
   ```tsx
   const meshes = await loadGLB(scene, path, file)
   for (const mesh of meshes) {
     if (mesh instanceof Mesh) {
       mesh.material = sharedAluminumMaterial // Apply code-defined material
     }
   }
   ```

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
