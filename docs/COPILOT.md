# Copilot Guide

Instructions for AI assistants working on this codebase.

---

## Project Overview

3D Tent Configurator built with:
- **Vite** - Build tool
- **React** - UI framework
- **Babylon.js** - 3D engine
- **react-babylonjs** - React bindings for Babylon.js
- **TypeScript** - Type safety

---

## Folder Structure

```
public/                    # Static assets (GLB files)
├── tents/                 # Tent-specific 3D models
│   └── {TentType}/{Variant}/frame/   → GLBs for that tent
│   └── {TentType}/{Variant}/covers/  → GLBs for that tent
└── accessories/           # Shared accessory 3D models
    └── {category}/        → GLBs shared across all tents

src/                       # Source code
├── tents/                 # Tent implementations
│   └── {TentType}/{Variant}/
│       ├── specs.ts       # Dimensions, profiles, helpers
│       ├── index.tsx      # Main tent component
│       ├── frame/         # Frame components
│       └── covers/        # Cover components
├── lib/
│   ├── accessories/       # Code-only or GLB-backed accessories
│   ├── constants/         # Asset paths, shared constants
│   └── utils/             # GLB loader, thin instances
├── components/            # Shared scene components
└── types/                 # TypeScript interfaces
```

---

## GLB File Locations

### Tent Parts (tent-specific)
```
public/tents/{TentType}/{Variant}/frame/{part}.glb
public/tents/{TentType}/{Variant}/covers/{part}.glb
```

Example:
```
/tents/PremiumArchTent/15m/frame/baseplate.glb
/tents/PremiumArchTent/15m/frame/connectors/outer-connector.glb
/tents/PremiumArchTent/15m/covers/roof-panel.glb
```

### Accessories (shared across tents)
```
public/accessories/{category}/{accessory}.glb
```

Example:
```
/accessories/doors/single-door.glb
/accessories/hvac/ac-unit.glb
```

---

## Coordinate System

- **Authoring:** Z-up (X=width, Y=length, Z=height)
- **Display:** Y-up (Babylon.js default)
- **Conversion:** `TentManager` applies `-Math.PI/2` rotation on X axis

---

## Adding a New Tent

1. Create folder: `src/tents/{TentType}/{Variant}/`
2. Add `specs.ts` with dimensions
3. Add `index.tsx` as main component
4. Add frame components in `frame/`
5. Add cover components in `covers/`
6. Create GLB folders: `public/tents/{TentType}/{Variant}/frame/` and `covers/`

---

## Adding a New Accessory

### GLB-backed accessory
1. Add GLB to `public/accessories/{category}/`
2. Create component in `src/lib/accessories/{category}/`
3. Use `loadGLB()` from `src/lib/utils/glbLoader.ts`

### Code-only accessory
1. Create component in `src/lib/accessories/{category}/`
2. Build geometry with Babylon.js primitives

---

## Key Patterns

### Loading GLB
```typescript
import { loadGLBMesh } from '@/lib/utils/glbLoader'

const mesh = await loadGLBMesh(scene, '/tents/PremiumArchTent/15m/frame/', 'baseplate.glb')
```

### Thin Instances (GPU instancing)
```typescript
import { createThinInstances } from '@/lib/utils/glbLoader'

createThinInstances(mesh, [
  { position: new Vector3(0, 0, 0) },
  { position: new Vector3(0, 5, 0) },
  { position: new Vector3(0, 10, 0) },
])
```

### Frame Component Pattern
```typescript
export const Baseplates: FC<FrameComponentProps> = ({ numBays, specs }) => {
  // Calculate positions based on numBays and specs
  // Render placeholders OR load GLB with thin instances
}
```

---

## DO NOT

- ❌ Use Three.js patterns (InstancedMesh, etc.) - this is Babylon.js
- ❌ Put GLB files in `src/` - they go in `public/`
- ❌ Hardcode dimensions - use `specs.ts`
- ❌ Create components without TypeScript types
