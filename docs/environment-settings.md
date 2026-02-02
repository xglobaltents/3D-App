# Environment Settings

Technical reference for the 3D scene environment configuration (Babylon.js).

---

## Ground Configuration

| Setting | Value | Notes |
|---------|-------|-------|
| Size | 600m × 600m | Large enough for side views |
| Tile Repeat | 150 | ~4m per texture tile |
| Grout Width | 1px | Thin, subtle tile pattern |

### Ground Colors

| Element | Hex | Notes |
|---------|-----|-------|
| Grout | `#8a5545` | Close to tile color, subtle |
| Tile Base | `#914e3e` | Terracotta/brick red |

---

## Sky Dome

| Setting | Value |
|---------|-------|
| Diameter | 1200m (GROUND_SIZE × 2) |
| Segments | 32 |
| Infinite Distance | true |
| Rendering Group | 0 (renders first/behind) |

### Default Gradient Colors

| Position | Color | Hex | Description |
|----------|-------|-----|-------------|
| Horizon | `Color3(0.77, 0.83, 0.88)` | `#c4d4e0` | Pale/hazy |
| Low | `Color3(0.53, 0.81, 0.92)` | `#87CEEB` | Light blue |
| Mid | `Color3(0.36, 0.64, 0.85)` | `#5BA3D9` | Medium blue |
| Zenith | `Color3(0.29, 0.56, 0.76)` | `#4A90C2` | Deeper blue at top |

### Sky Presets

Select via UI dropdown in control panel.

#### Dark Preset

| Position | Color | Hex |
|----------|-------|-----|
| All | `Color3(0.16, 0.17, 0.22)` | `#2A2C38` |

#### Midnight Preset

| Position | Color | Hex |
|----------|-------|-----|
| All | `Color3(0.06, 0.06, 0.11)` | `#10101C` |

---

## Lighting Setup (Babylon.js)

### Hemispheric Light (Ambient)

| Setting | Value |
|---------|-------|
| Direction | `Vector3(0, 1, 0)` |
| Intensity | 0.8 |
| Diffuse | `Color3(1, 1, 1)` |
| Ground Color | `Color3(0.67, 0.67, 0.67)` |

### Directional Light (Sun)

| Setting | Value |
|---------|-------|
| Direction | `Vector3(-0.5, -0.87, -0.5)` normalized from `(-30, -50, -30)` |
| Intensity | 1.5 |
| Diffuse | `Color3(1, 1, 1)` |

### Fill Light (Secondary Directional)

| Setting | Value |
|---------|-------|
| Direction | `Vector3(0.5, -0.75, 0.5)` normalized from `(20, -30, 20)` |
| Intensity | 0.8 |
| Diffuse | `Color3(1, 1, 1)` |

### Bottom Fill Light

| Setting | Value |
|---------|-------|
| Direction | `Vector3(0, 1, 0)` (pointing up) |
| Intensity | 0.3 |
| Diffuse | `Color3(1, 1, 1)` |

---

## Shadow Configuration (Babylon.js)

### Shadow Generator

| Setting | Value | Notes |
|---------|-------|-------|
| Map Size | 2048 | Desktop |
| Map Size | 1024 | Mobile |
| Use Blur | true | Soft shadows |
| Blur Kernel | 32 | Shadow softness |
| Bias | 0.00025 | Reduces shadow acne |
| Normal Bias | 0.008 | Reduces peter-panning |

### Shadow Light Frustum

| Setting | Value |
|---------|-------|
| Shadow Min Z | 1 |
| Shadow Max Z | 150 |
| Ortho Left/Right | ±60 |
| Ortho Top/Bottom | ±60 |

---

## Camera Configuration

### Arc Rotate Camera

| Setting | Desktop | Mobile |
|---------|---------|--------|
| Alpha | `Math.PI / 4` | `Math.PI / 4` |
| Beta | `Math.PI / 3` | `Math.PI / 3` |
| Radius | 25 | 40 |
| Target | `Vector3(0, 3, 7.5)` | `Vector3(0, 3, 7.5)` |
| Lower Radius | 5 | 10 |
| Upper Radius | 100 | 150 |
| Lower Beta | 0.1 | 0.1 |
| Upper Beta | `Math.PI / 2 - 0.1` | `Math.PI / 2 - 0.1` |

---

## Responsive Breakpoints

| Setting | Value |
|---------|-------|
| Mobile Breakpoint | 768px |

```typescript
const isMobile = () => window.innerWidth < 768
```

---

## File References

| File | Purpose |
|------|---------|
| `src/components/SceneSetup.tsx` | Scene environment implementation |
| `src/lib/constants/environment.ts` | Environment constants (planned) |
