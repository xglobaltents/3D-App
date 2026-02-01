# Performance Guide

Best practices for keeping the 3D tent configurator fast.

---

## Thin Instances (GPU Instancing)

**Always use thin instances for repeated geometry.**

Instead of creating N separate meshes:
```typescript
// ❌ BAD - N draw calls
for (let i = 0; i < numBays; i++) {
  const mesh = baseMesh.clone()
  mesh.position = new Vector3(0, i * 5, 0)
}
```

Use thin instances:
```typescript
// ✅ GOOD - 1 draw call
import { createThinInstances } from '@/lib/utils/glbLoader'

const positions = Array.from({ length: numBays }, (_, i) => ({
  position: new Vector3(0, i * 5, 0)
}))

createThinInstances(baseMesh, positions)
```

**Benefits:**
- 1 draw call instead of N
- Shared geometry buffer
- Minimal memory overhead

---

## Material Reuse

**Share materials across meshes.**

```typescript
// ❌ BAD - Creates new material per mesh
positions.forEach((pos, i) => {
  <box>
    <standardMaterial name={`mat-${i}`} diffuseColor={ALUMINUM} />
  </box>
})
```

```typescript
// ✅ GOOD - Reuse material
const sharedMaterial = new StandardMaterial('aluminum', scene)
sharedMaterial.diffuseColor = ALUMINUM

positions.forEach(pos => {
  mesh.material = sharedMaterial
})
```

---

## Material Guidelines

| Material Type | Use Case | Performance |
|---------------|----------|-------------|
| `StandardMaterial` | Most geometry (aluminum, steel) | Fast |
| `PBRMaterial` | Covers, panels, reflective surfaces | Medium |
| `BackgroundMaterial` | Ground, skybox | Fast |

**Avoid** `PBRMaterial` for frame components - use `StandardMaterial`.

---

## Geometry Optimization

### Merge Static Geometry
If parts don't move independently, merge them:
```typescript
const merged = Mesh.MergeMeshes([mesh1, mesh2, mesh3], true)
```

### LOD (Level of Detail)
For distant views, use simpler geometry:
```typescript
mesh.addLODLevel(50, simplifiedMesh)  // Use simplified at 50m distance
mesh.addLODLevel(100, null)           // Hide at 100m
```

### Freeze Transforms
For static meshes:
```typescript
mesh.freezeWorldMatrix()
```

---

## Lazy Loading

**Load GLBs on demand, not all at once.**

```typescript
// ✅ Load only when tent type is selected
const loadTent = async (tentType: string) => {
  const module = await import(`@/tents/${tentType}/15m`)
  // ...
}
```

---

## Render Loop

Babylon.js renders continuously by default. For configurators with infrequent changes:

```typescript
// Render only when needed
scene.getEngine().stopRenderLoop()

function requestRender() {
  scene.render()
}

// Call requestRender() after any change
```

---

## Memory Management

### Dispose Unused Meshes
```typescript
mesh.dispose()
material.dispose()
texture.dispose()
```

### Clear Scene on Tent Change
```typescript
function clearTent() {
  scene.meshes
    .filter(m => m.name.startsWith('tent-'))
    .forEach(m => m.dispose())
}
```

---

## Profiling

Use Babylon.js Inspector:
```typescript
scene.debugLayer.show()
```

Check:
- Draw calls (keep under 100)
- Triangle count
- Texture memory
- FPS

---

## Checklist

- [ ] Thin instances for repeated parts
- [ ] Shared materials
- [ ] StandardMaterial for frame (not PBR)
- [ ] Frozen transforms for static meshes
- [ ] Lazy load tent modules
- [ ] Dispose meshes on tent change
