import { type FC, useEffect, useState, useRef, useCallback } from 'react'
import { Engine, EngineInstrumentation, SceneInstrumentation, WebGPUEngine } from '@babylonjs/core'

interface MeshBreakdown {
  name: string
  triangles: number
  vertices: number
}

interface PerformanceStatsProps {
  onClose?: () => void
}

interface Stats {
  fps: number
  frameTime: number
  cpuRenderTime: number
  gpuFrameTime: number | null
  drawCalls: number
  triangles: number
  vertices: number
  activeMeshes: number
  totalMeshes: number
  materials: number
  textures: number
  engineType: 'WebGPU' | 'WebGL' | 'Unknown'
  meshBreakdown: MeshBreakdown[]
}

const EMPTY_STATS: Stats = {
  fps: 0,
  frameTime: 0,
  cpuRenderTime: 0,
  gpuFrameTime: null,
  drawCalls: 0,
  triangles: 0,
  vertices: 0,
  activeMeshes: 0,
  totalMeshes: 0,
  materials: 0,
  textures: 0,
  engineType: 'Unknown',
  meshBreakdown: [],
}

export const PerformanceStats: FC<PerformanceStatsProps> = ({ onClose }) => {
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [showBreakdown, setShowBreakdown] = useState(false)
  const instrumentationRef = useRef<SceneInstrumentation | null>(null)
  const engineInstrumentationRef = useRef<EngineInstrumentation | null>(null)
  const prevMeshCountRef = useRef<number>(-1)
  const cachedBreakdownRef = useRef<MeshBreakdown[]>([])
  const cachedTrianglesRef = useRef<number>(0)
  const cachedVerticesRef = useRef<number>(0)
  /** Track which scene the instrumentation belongs to */
  const instrumentedSceneUidRef = useRef<string | null>(null)

  const disposeInstrumentation = useCallback(() => {
    if (instrumentationRef.current) {
      try { instrumentationRef.current.dispose() } catch { /* already gone */ }
      instrumentationRef.current = null
      instrumentedSceneUidRef.current = null
    }
    if (engineInstrumentationRef.current) {
      try { engineInstrumentationRef.current.dispose() } catch { /* already gone */ }
      engineInstrumentationRef.current = null
    }
  }, [])

  useEffect(() => {
    const updateStats = () => {
      const engine = Engine.LastCreatedEngine
      if (!engine) return

      const scene = engine.scenes[0]
      if (!scene || scene.isDisposed) {
        // Scene gone — dispose stale instrumentation
        disposeInstrumentation()
        return
      }

      // Re-create instrumentation if scene changed (env switch disposes old scene)
      if (
        !instrumentationRef.current ||
        instrumentedSceneUidRef.current !== scene.uid
      ) {
        disposeInstrumentation()
        const inst = new SceneInstrumentation(scene)
        inst.captureFrameTime = true
        inst.captureRenderTime = true
        inst.captureInterFrameTime = true
        instrumentationRef.current = inst

        const engineInst = new EngineInstrumentation(engine)
        engineInst.captureGPUFrameTime = true
        engineInstrumentationRef.current = engineInst

        instrumentedSceneUidRef.current = scene.uid
        // Reset mesh cache so breakdown rebuilds for new scene
        prevMeshCountRef.current = -1
      }

      // Only recalculate mesh breakdown when mesh count changes
      const currentMeshCount = scene.meshes.length
      if (currentMeshCount !== prevMeshCountRef.current) {
        prevMeshCountRef.current = currentMeshCount
        let totalTriangles = 0
        let totalVertices = 0
        const meshMap = new Map<string, { triangles: number; vertices: number }>()

        for (const mesh of scene.meshes) {
          if (mesh.isEnabled() && mesh.isVisible && mesh.getTotalIndices) {
            const indices = mesh.getTotalIndices()
            let vertices = mesh.getTotalVertices?.() ?? 0

            // Handle non-indexed geometry (e.g. CAD-exported GLBs with no
            // index buffer): fall back to vertices / 3.
            let triangles = indices > 0
              ? Math.floor(indices / 3)
              : Math.floor(vertices / 3)

            // Thin instances multiply the template geometry
            const instanceCount = (mesh as unknown as { thinInstanceCount?: number }).thinInstanceCount
            if (instanceCount && instanceCount > 0) {
              triangles *= instanceCount
              vertices *= instanceCount
            }

            totalTriangles += triangles
            totalVertices += vertices

            // Walk the parent chain past __root__ nodes to find the
            // component TransformNode (e.g. "uprights-root")
            let componentName = mesh.name
            let parent = mesh.parent
            while (parent && (parent.name === '__root__' || parent.name === '')) {
              parent = parent.parent
            }
            if (parent?.name) {
              componentName = parent.name
            }

            // Clean up common prefixes
            componentName = componentName
              .replace(/^__root__\.?/, '')
              .replace(/_primitive\d+$/, '')
              .replace(/\.\d+$/, '')
              .replace(/-root$/, '')

            if (!componentName || componentName === '') {
              componentName = mesh.name || 'Unnamed'
            }

            const existing = meshMap.get(componentName)
            if (existing) {
              existing.triangles += triangles
              existing.vertices += vertices
            } else {
              meshMap.set(componentName, { triangles, vertices })
            }
          }
        }

        cachedBreakdownRef.current = Array.from(meshMap.entries())
          .map(([name, data]) => ({ name, ...data }))
          .sort((a, b) => b.triangles - a.triangles)
        cachedTrianglesRef.current = totalTriangles
        cachedVerticesRef.current = totalVertices
      }

      // Detect engine type
      const isWebGPU = engine instanceof WebGPUEngine || engine.name === 'WebGPU'

      const instrumentation = instrumentationRef.current!
      const drawCalls = Math.round(
        instrumentation.drawCallsCounter.lastSecAverage ||
        instrumentation.drawCallsCounter.current
      )
      const frameTime =
        instrumentation.frameTimeCounter.lastSecAverage ||
        engine.getDeltaTime()
      const cpuRenderTime =
        instrumentation.renderTimeCounter.lastSecAverage ||
        instrumentation.renderTimeCounter.current
      const gpuFrameTimeNs =
        engineInstrumentationRef.current?.gpuFrameTimeCounter.lastSecAverage ||
        engineInstrumentationRef.current?.gpuFrameTimeCounter.current
      const gpuFrameTime = gpuFrameTimeNs && gpuFrameTimeNs > 0
        ? gpuFrameTimeNs / 1_000_000
        : null

      // getActiveMeshes() returns the last frustum-evaluated list.
      // Safe after the first render tick (our 500ms interval guarantees this).
      const activeMeshes = scene.getActiveMeshes?.()?.length ?? 0
      const visibleMeshes = scene.meshes.filter(m => m.isEnabled() && m.isVisible).length

      setStats({
        fps: Math.round(engine.getFps()),
        frameTime: parseFloat(frameTime.toFixed(2)),
        cpuRenderTime: parseFloat(cpuRenderTime.toFixed(2)),
        gpuFrameTime: gpuFrameTime == null ? null : parseFloat(gpuFrameTime.toFixed(2)),
        drawCalls,
        triangles: cachedTrianglesRef.current,
        vertices: cachedVerticesRef.current,
        activeMeshes,
        totalMeshes: visibleMeshes,
        materials: scene.materials.length,
        textures: scene.textures.length,
        engineType: isWebGPU ? 'WebGPU' : 'WebGL',
        meshBreakdown: cachedBreakdownRef.current,
      })
    }

    const interval = setInterval(updateStats, 500)
    updateStats()

    return () => {
      clearInterval(interval)
      disposeInstrumentation()
    }
  }, [disposeInstrumentation])

  return (
    <div className="performance-stats">
      <div className="stats-header">
        <h3>Performance Analytics</h3>
        {onClose && (
          <button className="stats-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        )}
      </div>
      
      <div className="engine-badge" data-engine={stats.engineType.toLowerCase()}>
        {stats.engineType}
      </div>
      
      <div className="stats-row">
        <div className="stat-item">
          <span className="stat-label">FPS</span>
          <span className={`stat-value ${stats.fps < 30 ? 'warning' : stats.fps < 50 ? 'caution' : 'good'}`}>
            {stats.fps}
          </span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Frame Time</span>
          <span className="stat-value">{stats.frameTime}ms</span>
        </div>

        <div className="stat-item">
          <span className="stat-label">CPU Render</span>
          <span className="stat-value">{stats.cpuRenderTime}ms</span>
        </div>

        <div className="stat-item">
          <span className="stat-label">GPU Time</span>
          <span className="stat-value">
            {stats.gpuFrameTime == null ? 'N/A' : `${stats.gpuFrameTime}ms`}
          </span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Draw Calls</span>
          <span className="stat-value">{stats.drawCalls}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Triangles</span>
          <span className="stat-value">{stats.triangles.toLocaleString()}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Vertices</span>
          <span className="stat-value">{stats.vertices.toLocaleString()}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Active Meshes</span>
          <span className="stat-value">{stats.activeMeshes}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Total Meshes</span>
          <span className="stat-value">{stats.totalMeshes}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Materials</span>
          <span className="stat-value">{stats.materials}</span>
        </div>
        
        <div className="stat-item">
          <span className="stat-label">Textures</span>
          <span className="stat-value">{stats.textures}</span>
        </div>
      </div>

      {/* Mesh Breakdown Section */}
      {stats.meshBreakdown.length > 0 && (
        <div className="breakdown-section">
          <button 
            className="breakdown-toggle"
            onClick={() => setShowBreakdown(!showBreakdown)}
          >
            {showBreakdown ? '▼' : '▶'} Triangle Breakdown ({stats.meshBreakdown.length} components)
          </button>
          
          {showBreakdown && (
            <div className="breakdown-list">
              {stats.meshBreakdown.map((mesh, i) => (
                <div key={i} className="breakdown-item">
                  <span className="breakdown-name" title={mesh.name}>
                    {mesh.name.length > 20 ? mesh.name.slice(0, 20) + '...' : mesh.name}
                  </span>
                  <span className="breakdown-stats">
                    <span className="breakdown-triangles">{mesh.triangles.toLocaleString()} △</span>
                    <span className="breakdown-percent">
                      {stats.triangles > 0 ? Math.round((mesh.triangles / stats.triangles) * 100) : 0}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}