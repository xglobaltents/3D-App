# Specular Flicker, Anti-Aliasing & Distant Detail

This page documents the rendering settings and material rules that keep the
tent frame stable (no shimmer) while preserving sharpness on far-away parts.
Read this **before** changing materials, post-processing, or procedural mesh
geometry — the failure modes are subtle and easy to reintroduce.

---

## 1. The Symptom: Dancing Shimmer on Distant Frame Tubing

Symptom: thin metal arches, uprights, or purlins appear to "blink",
sparkle, or jitter when the camera is still or orbiting slowly. Worse on
arches at the back of the tent than on closer parts.

Symptom: distant parts look soft / low-resolution even though no LOD is
applied.

Both are caused by aliasing of sub-pixel specular highlights on glossy metal
combined with post-process passes that either amplify or over-blur them.

---

## 2. Root Causes (in order of impact)

### 2.1 Two-sided geometry rendering twice in the same pixels

**The biggest contributor for the procedural arch frame.**

`ArchFrames.tsx` builds a procedural hollow tube: outer wall + inner wall +
end caps. Inner-loop winding is intentionally reversed in
`appendLoopSideGeometry`, so backface culling correctly hides the inside of
the tube. The end caps fully seal the tube — the inside is **never** visible
from the outside.

If the material is configured with `backFaceCulling = false` and
`twoSidedLighting = true`, both walls rasterize for every pixel of the arch.
At distance, outer + inner triangles land in the same screen pixels and
their specular highlights compete each frame depending on which wins the
depth test by a sub-pixel margin → dancing shimmer.

**Rule:** Closed procedural tubes (sealed by caps) MUST keep
`backFaceCulling = true`. Only enable two-sided rendering for parts that
are genuinely open (e.g. cover fabric viewed from inside).

See: [src/tents/PremiumArchTent/15m/frame/ArchFrames.tsx](../src/tents/PremiumArchTent/15m/frame/ArchFrames.tsx).

### 2.2 No MSAA on the HDR pipeline

`new Engine(canvas, true, { antialias: true, ... })` only enables MSAA on the
**back buffer**. Once `DefaultRenderingPipeline` is created with HDR (`true`),
all rendering goes through float render targets that the back-buffer flag
does **not** apply to. Without explicitly setting `pipeline.samples`, the
pipeline RTs run with no MSAA at all.

**Rule:** When an HDR pipeline is active, set `pipeline.samples` explicitly.
We use `4` on desktop, `2` on mobile. See
[src/lib/utils/postProcessing.ts](../src/lib/utils/postProcessing.ts).

### 2.3 FXAA over MSAA over-blurs distant edges

FXAA is a screen-space edge blur. Stacking it on top of MSAA gives no
additional AA quality for thin tubing — but it does soften distant 1–2 px
features into mush. With MSAA + TAA enabled, **leave FXAA off**.

**Rule:** `pipeline.fxaaEnabled = false` when MSAA + TAA are active.

### 2.4 TAA `factor` too high → distant detail blurred

`TAARenderingPipeline.factor` controls history blend. Higher = more
temporal stability but smears distant sub-pixel detail.

**Rule:** Use `factor: 0.85`. Lower causes shimmer to return; higher loses
sharpness on far parts. Combine with `samples: 8`.

### 2.5 Bloom amplifies single-pixel sparkles

With `threshold ≈ 0.9` and `weight ≈ 0.15`, any aliased pixel that exceeds
the threshold for one frame blooms into a visible flash. Raise the
threshold so only true HDR overshoots bloom.

**Rule:** Default preset uses `threshold: 1.2`, `weight: 0.10`. Black
preset uses `threshold: 1.2`, `weight: 0.12` (slightly brighter to read on
dark background).

### 2.6 Aluminum too glossy for thin tubing

`PBRMaterial` with `metallic: 0.95` and `roughness: 0.28` produces a very
small specular lobe — easily sub-pixel on distant 60 mm tubing. The lobe
appears/disappears from one frame to the next.

**Rule:** Aluminum frame material uses `roughness: 0.38` and default-preset
`specularIntensity: 1.0`. Studio presets use higher `specularIntensity`
(white 1.3, black 1.4) to stay readable on flat backgrounds. Do not drop
roughness below 0.35 unless you also raise the bloom threshold further.

Also: every PBR metal material has `enableSpecularAntiAliasing = true` —
this widens the spec lobe in screen space based on normal derivatives.
Keep it enabled. It complements (does not replace) MSAA + TAA.

---

## 3. The Working Stack (current settings)

Settings are split across three files; do not change one without
considering the others.

### `src/lib/utils/postProcessing.ts`
```ts
const pipeline = new DefaultRenderingPipeline('default-pipeline', true, scene, [camera])
pipeline.samples = isMobile() ? 2 : 4   // MSAA on HDR RT
pipeline.fxaaEnabled = false             // intentionally off
```

### `src/lib/constants/sceneConfig.ts` (per preset)
```ts
default: {
  sharpen: { enabled: true, edgeAmount: 0.5,  colorAmount: 1.0 },
  bloom:   { enabled: true, threshold: 1.2,  weight: 0.10, kernel: 64, scale: 0.5 },
  taa:     { enabled: true, samples: 8,      factor: 0.85 },
}
white: {
  sharpen: { enabled: true, edgeAmount: 0.45, colorAmount: 1.0 },
  bloom:   { enabled: false, ... },
  taa:     { enabled: true, samples: 8,      factor: 0.85 },
}
black: {
  sharpen: { enabled: true, edgeAmount: 0.5,  colorAmount: 1.0 },
  bloom:   { enabled: true, threshold: 1.2,  weight: 0.12, kernel: 64, scale: 0.5 },
  taa:     { enabled: true, samples: 8,      factor: 0.85 },
}
```

### `src/lib/materials/frameMaterials.ts`
```ts
mat.metallic  = 0.95
mat.roughness = 0.38
mat.enableSpecularAntiAliasing = true
mat.backFaceCulling = true   // singleton default
```

Per-preset profiles (`INTENSITY_PROFILES`):
| Preset  | aluminum.specularIntensity |
|---------|---------------------------|
| default | 1.0                       |
| white   | 1.3                       |
| black   | 1.4                       |

### `src/tents/PremiumArchTent/15m/frame/ArchFrames.tsx`
```ts
const archMat = getAluminumClone(scene, 'aluminum-arch', (m) => {
  m.backFaceCulling  = true   // sealed tube — inside never visible
  m.twoSidedLighting = false
})
```

---

## 4. Anti-Patterns to Avoid

- **Disabling backface culling on sealed procedural tubes.** Use only for
  genuinely thin/open geometry (curtains, cover fabric viewed from inside).
- **Stacking FXAA on top of MSAA + TAA.** Pick one screen-space AA, not
  three. We use MSAA (geometric) + TAA (temporal).
- **Raising TAA `factor` above 0.90 to "fix shimmer".** This blurs distant
  detail. Fix shimmer at the source (geometry / material) instead.
- **Lowering aluminum `roughness` below 0.30 for "more shine".** Sub-pixel
  spec lobe → guaranteed flicker on thin parts at distance.
- **Adding LOD levels to tent parts.** Forbidden by project rules
  ([copilot-instructions.md](copilot-instructions.md)) — creates visual
  inconsistency and is unnecessary with proper AA.
- **Leaving the back-buffer `antialias: true` flag and assuming the HDR
  pipeline picks it up.** Always set `pipeline.samples` explicitly when
  using `DefaultRenderingPipeline` with HDR enabled.

---

## 5. Debugging Checklist When Flicker Returns

1. Was a frame component changed to clone aluminum with `backFaceCulling = false`? → Restore to `true` unless the geometry is genuinely open.
2. Was a procedural mesh added without end caps? → Either add caps + cull backfaces, or accept that two-sided rendering will flicker on thin parts.
3. Was `pipeline.samples` removed or set to `0`? → Restore to `4` desktop / `2` mobile.
4. Was TAA disabled per preset? → Re-enable at `factor: 0.85`.
5. Did someone lower aluminum roughness? → Restore to `0.38`.
6. Did someone lower bloom threshold below 1.0? → Restore to `1.2`.
7. Console: any `TAA init failed` / `TAA skipped — engine lacks float render targets` warnings? → On WebGPU lacking float RTs, MSAA alone covers most of it; do not add FXAA back as a workaround.

---

## 6. Why No LOD?

Thin metal tubing at distance is the **opposite** of what LOD helps. Lower
poly counts make the tubes thinner-looking, and decimating them into
fewer cylinders *adds* aliasing rather than removes it. The right answer
is consistent geometry + proper AA, not LOD.
