# Premium Arch Tent 15m - Build Guide

---

## GLB Files Location

Add your GLB files here:
```
public/tents/PremiumArchTent/15m/
├── frame/
│   ├── baseplate.glb
│   ├── upright.glb
│   ├── arch-frame.glb
│   ├── ground-beam.glb
│   ├── eave-side-beam.glb
│   ├── gable-eave-beam.glb
│   ├── gable-support.glb
│   ├── main-purlin.glb
│   ├── intermediate-purlin.glb
│   └── connectors/
│       ├── upright-arch-plate.glb
│       ├── connector-triangle.glb
│       └── outer-connector.glb
└── covers/
    ├── roof-panel.glb
    ├── gable-front.glb
    └── gable-back.glb
```

---

## Key Dimensions

| Property | Value |
|----------|-------|
| Width | 15m |
| Half-width | 7.5m |
| Eave height | 3.2m |
| Ridge height | 5.1m |
| Bay distance | 5.0m |
| Arch outer span | ±7.606m |

---

## Profiles (from technical drawing)

| ID | Name | Size | Used For |
|----|------|------|----------|
| 01 | Upright | 212×112mm | Vertical uprights |
| 02 | Rafter | 212×112mm | Curved arch frame |
| 03 | Gable Column | 127×76mm | Front/back center columns |
| 04 | Eave Beam | 127×76mm | Horizontal beam at eave |
| 05 | Gable Beam | 127×76mm | Front/back horizontal beam |
| 06 | Main Purlin | 76×125mm | Ridge & eave purlins |
| 07 | Intermediate Purlin | 60×60mm | Roof purlins between main |

---

## Build Steps

### Step 1: Baseplates ✅
- **File**: `frame/Baseplates.tsx`
- **GLB**: `baseplate.glb`
- **Position**: X=±7.5m, Y=per bay

### Step 2: Uprights ✅
- **File**: `frame/Uprights.tsx`
- **GLB**: `upright.glb`
- **Position**: X=±7.5m at each bay line
- **Height**: baseplate top → eaveHeight - 150mm

### Step 3: Arch Frames ✅
- **File**: `frame/ArchFrames.tsx`
- **GLB**: `arch-frame.glb`
- **Position**: One arch at each bay line

### Step 4: Ground Beams ✅
- **File**: `frame/GroundBeams.tsx`
- **GLB**: `ground-beam.glb`
- **Position**: Z=0, between uprights

### Step 5: Eave Side Beams ✅
- **File**: `frame/EaveSideBeams.tsx`
- **GLB**: `eave-side-beam.glb`
- **Position**: Z = eaveHeight - 90mm

### Step 6: Gable Eave Beams ✅
- **File**: `frame/GableEaveBeams.tsx`
- **GLB**: `gable-eave-beam.glb`
- **Position**: Z=eaveHeight, Y=0 and Y=tentLength

### Step 7: Gable Supports ✅
- **File**: `frame/GableSupports.tsx`
- **GLB**: `gable-support.glb`
- **Position**: X=±2.5m, front and back

### Step 8: Main Purlins ✅
- **File**: `frame/MainPurlins.tsx`
- **GLB**: `main-purlin.glb`
- **Position**: X=±2.5m, along arch

### Step 9: Intermediate Purlins ✅
- **File**: `frame/IntermediatePurlins.tsx`
- **GLB**: `intermediate-purlin.glb`
- **Position**: X=±5.0m, ±1.25m, 0m

### Step 10: Connectors ⬜
- **GLBs**: `connectors/upright-arch-plate.glb`, etc.
- **Position**: Between uprights and arches

### Step 11: Covers ✅
- **File**: `covers/Covers.tsx`
- **GLBs**: `roof-panel.glb`, `gable-front.glb`, `gable-back.glb`

---

## Position Reference (Z-up)

| Component | X | Y | Z |
|-----------|---|---|---|
| Uprights | ±7.5m | per bay | baseplate → eave-150mm |
| Arch Frames | -7.606 → +7.606m | per bay | eave → ridge |
| Ground Beams | ±(7.5m + 85mm) | between bays | 0 |
| Eave Beams | ±outer upright | between bays | eaveHeight - 90mm |
| Gable Supports | ±2.5m | 50mm, length-50mm | 0 → arch |
| Purlins | various | 0 → tentLength | arch top + 15mm |

---

## Code Pattern for GLB Loading

```typescript
// In Baseplates.tsx (example)
import { useEffect } from 'react'
import { useScene } from 'react-babylonjs'
import { loadGLBMesh, createThinInstances } from '@/lib/utils/glbLoader'
import { FRAME_PATH } from '../specs'

export const Baseplates = ({ numBays, specs }) => {
  const scene = useScene()

  useEffect(() => {
    if (!scene) return

    const load = async () => {
      const mesh = await loadGLBMesh(scene, FRAME_PATH, 'baseplate.glb')
      if (!mesh) return

      // Create positions for all baseplates
      const transforms = []
      for (let bay = 0; bay <= numBays; bay++) {
        transforms.push({ position: new Vector3(-specs.halfWidth, bay * specs.bayDistance, 0) })
        transforms.push({ position: new Vector3(specs.halfWidth, bay * specs.bayDistance, 0) })
      }

      createThinInstances(mesh, transforms)
    }

    load()
  }, [scene, numBays, specs])

  return <transformNode name="baseplates" />
}
```
