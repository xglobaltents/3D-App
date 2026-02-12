# Environment Settings

Technical reference for the 3D scene environment configuration (Babylon.js).
Three environment modes selectable via UI dropdown.

---

## Environment Modes

| Preset | Description |
|--------|-------------|
| **Outdoor** (default) | Sky dome + terracotta tile ground + 4-light rig + ACES tone mapping |
| **White Studio** | PBR ground + grid overlay + fog + IBL + 2-light rig |
| **Black Studio** | Same as white studio with dark colours |

---

## Outdoor (Default) Preset

### Sky Dome

| Setting | Value |
|---------|-------|
| Diameter | 1200m |
| Segments | 32 |
| Infinite Distance | true |
| Rendering Group | 0 (behind everything) |
| Shader | Custom GLSL gradient (horizon → zenith) |

#### Gradient Colors

| Position | Color | Hex |
|----------|-------|-----|
| Horizon | `Color3(0.77, 0.83, 0.88)` | `#c4d4e0` |
| Low | `Color3(0.53, 0.81, 0.92)` | `#87CEEB` |
| Mid | `Color3(0.36, 0.64, 0.85)` | `#5BA3D9` |
| Zenith | `Color3(0.29, 0.56, 0.76)` | `#4A90C2` |

### Terracotta Tile Ground

| Setting | Value | Notes |
|---------|-------|-------|
| Size | 600m x 600m | Large enough for all views |
| Tile Repeat | 150 | ~4m per tile |
| Grout Width | 1px | Thin, subtle |
| Material | `StandardMaterial` | `DynamicTexture` tiled pattern |

#### Ground Colors

| Element | Hex |
|---------|-----|
| Grout | `#8a5545` |
| Tile Base | `rgb(145, 78, 62)` (terracotta) |

### 4-Light Rig

| Light | Type | Intensity | Direction |
|-------|------|-----------|-----------|
| Hemispheric | `HemisphericLight` | 0.8 | `(0, 1, 0)` |
| Sun | `DirectionalLight` | 1.5 | `(-30, -50, -30)` normalized |
| Fill | `DirectionalLight` | 0.8 | `(20, -30, 20)` normalized |
| Bottom | `DirectionalLight` | 0.3 | `(0, 1, 0)` (upward) |

### Default Shadow Generator

| Setting | Value |
|---------|-------|
| Blur Kernel | 32 |
| Bias | -0.00025 |
| Normal Bias | 0.008 |
| Darkness | 0.4 |

### Image Processing

| Setting | Value |
|---------|-------|
| Tone Mapping | ACES (type 1) |
| Exposure | 1.0 |
| Contrast | 1.1 |

### Scene Flags

| Flag | Value | Reason |
|------|-------|--------|
| `autoClear` | false | Sky dome covers background |
| `fogMode` | NONE | No fog in outdoor mode |

---

## White Studio Preset

### PBR Ground

| Setting | Value |
|---------|-------|
| Size | 200m x 200m |
| Material | `PBRMaterial` |
| Albedo Color | `Color3(0.85, 0.85, 0.85)` |
| Metallic | 0.0 |
| Roughness | 0.9 |
| Environment Intensity | 0.4 |

### Grid Overlay

Uses `GridMaterial` from `@babylonjs/materials`.

| Setting | Value |
|---------|-------|
| Y Offset | 0.001m |
| Major Unit Frequency | 10 |
| Minor Unit Visibility | 0.3 |
| Grid Ratio | 1 |
| Main Color | `Color3(0.85, 0.85, 0.85)` |
| Line Color | `Color3(0.7, 0.7, 0.7)` |
| Opacity | 0.6 |

### Background & Fog

| Setting | Value |
|---------|-------|
| Clear Color | `Color4(0.95, 0.95, 0.95, 1.0)` |
| Fog Mode | Linear |
| Fog Color | `Color3(0.95, 0.95, 0.95)` |
| Fog Start | 80m |
| Fog End | 150m |

### IBL Environment

| Setting | Value |
|---------|-------|
| URL | `https://assets.babylonjs.com/environments/environmentSpecular.env` |
| Intensity | 0.5 |

### 2-Light Rig

| Light | Intensity | Notes |
|-------|-----------|-------|
| Hemispheric | 0.6 | Diffuse: white, Ground: `(0.4, 0.4, 0.4)` |
| Directional | 0.8 | Direction: `(-1, -2, -1)` normalized |

### Studio Shadow Generator

| Setting | Value |
|---------|-------|
| Blur Kernel | 16 |
| Darkness | 0.3 |

---

## Black Studio Preset

Same structure as White Studio with dark values:

| Property | Value |
|----------|-------|
| Clear Color | `Color4(0.06, 0.06, 0.08, 1.0)` |
| Fog Color | `Color3(0.06, 0.06, 0.08)` |
| Ground Albedo | `Color3(0.10, 0.10, 0.12)` |
| Ground Env Intensity | 0.15 |
| Grid Main / Line | `0.10` / `0.20` |
| Grid Opacity | 0.35 |
| Hemi Intensity | 0.2 |
| Dir Intensity | 0.4 |
| Env Intensity | 0.2 |

---

## Shared Configuration

### Shadow Map Size

| Device | Size |
|--------|------|
| Desktop | 2048 |
| Mobile | 1024 |

All presets use `useBlurExponentialShadowMap = true`.
All meshes auto-registered via `onNewMeshAddedObservable`.

### Camera (Arc Rotate)

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
| FOV | 50 deg | 50 deg |
| Near / Far | 0.5 / 1000 | 0.5 / 1000 |

### Responsive

| Setting | Value |
|---------|-------|
| Mobile Breakpoint | 768px |

---

## File References

| File | Purpose |
|------|---------|
| `src/components/SceneSetup.tsx` | Scene environment implementation |
| `src/lib/constants/sceneConfig.ts` | Centralized configuration values |
