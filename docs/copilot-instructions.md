# Copilot Instructions

3D Tent Configurator built with **React 19**, **Babylon.js 8**, and **react-babylonjs**. Uses Vite for builds.

## Architecture

```
src/tents/{TentType}/{Variant}/     # Tent implementations
├── specs.ts                        # Dimensions, profiles, path constants
├── index.tsx                       # Main tent component (composes frame/covers)
├── frame/*.tsx                     # Individual frame components
└── covers/*.tsx                    # Cover components

src/lib/
├── utils/GLBLoader.ts              # loadGLBMesh(), createThinInstances()
├── constants/assetPaths.ts         # Path helpers: getFramePath(), getCoversPath()
└── accessories/                    # Shared accessory components

public/tents/{TentType}/{Variant}/  # GLB files (NOT in src/)
├── frame/*.glb
└── covers/*.glb
```

## Coordinate System

- **Authoring**: Z-up (X=width, Y=length, Z=height) — all specs and positions use this
- **Display**: Y-up (Babylon.js) — App.tsx applies `-Math.PI/2` X rotation to tent container

## Key Patterns

### Frame Component Structure
```tsx
// src/tents/PremiumArchTent/15m/frame/Baseplates.tsx
export const Baseplates: FC<FrameComponentProps> = ({ numBays, specs }) => {
  // Calculate positions from specs, not hardcoded values
  for (let bay = 0; bay <= numBays; bay++) {
    const y = bay * specs.bayDistance  // Use specs
  }
  return <transformNode name="baseplates">...</transformNode>
}
```

### GLB Loading with Thin Instances (GPU Instancing)
```tsx
import { loadGLBMesh, createThinInstances } from '@/lib/utils/GLBLoader'
import { FRAME_PATH } from '../specs'

const mesh = await loadGLBMesh(scene, FRAME_PATH, 'baseplate.glb')
createThinInstances(mesh, [
  { position: new Vector3(-7.5, 0, 0) },
  { position: new Vector3(7.5, 0, 0) },
])
```

### Types (always use)
- `TentSpecs` — tent dimensions/profiles
- `FrameComponentProps` — `{ numBays, specs }`
- `CoverComponentProps` — `{ numBays, tentLength, specs }`
- `TentComponentProps` — `{ numBays, showFrame, showCovers, position }`

## Commands

```bash
npm run dev      # Dev server (default port 5173)
npm run build    # tsc + vite build → dist/
npm run lint     # ESLint
```

## Rules

1. **Use Babylon.js** — NOT Three.js. No `InstancedMesh`, no `useFrame()`, no drei
2. **GLB files go in `public/`** — never in `src/`
3. **Use `specs.ts` for dimensions** — no hardcoded measurements in components
4. **Use thin instances for repeated geometry** — `createThinInstances()` not `.clone()`
5. **Use `StandardMaterial` for frame** — `PBRMaterial` only for covers/reflective surfaces
6. **Share materials** — don't create per-instance materials in loops

## Adding a New Tent

1. Create `src/tents/{TentType}/{Variant}/specs.ts` with `TentSpecs`
2. Create `src/tents/{TentType}/{Variant}/index.tsx` composing frame/cover components
3. Add frame components in `frame/` following `FrameComponentProps` pattern
4. Create GLB folders: `public/tents/{TentType}/{Variant}/frame/` and `covers/`
5. Reference [PremiumArchTent-15m-structure.md](PremiumArchTent-15m-structure.md) for build guide format

## Performance Checklist

- [ ] Thin instances for all repeated geometry (purlins, baseplates, etc.)
- [ ] `mesh.freezeWorldMatrix()` for static meshes
- [ ] Shared materials across instances
- [ ] LOD levels for complex geometry: `mesh.addLODLevel(distance, simplifiedMesh)`
