import { type FC, useEffect, useState, useRef } from 'react'
import { Engine, SceneInstrumentation, WebGPUEngine } from '@babylonjs/core'

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

export const PerformanceStats: FC<PerformanceStatsProps> = ({ onClose }) => {
  const [stats, setStats] = useState<Stats>({
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    vertices: 0,
    activeMeshes: 0,
    totalMeshes: 0,
    materials: 0,
    textures: 0,
    engineType: 'Unknown',
    meshBreakdown: [],
  })
  const [showBreakdown, setShowBreakdown] = useState(false)
  const instrumentationRef = useRef<SceneInstrumentation | null>(null)
  const prevMeshCountRef = useRef<number>(-1)
  const cachedBreakdownRef = useRef<MeshBreakdown[]>([])
  const cachedTrianglesRef = useRef<number>(0)

  useEffect(() => {
    const updateStats = () => {
      const engine = Engine.LastCreatedEngine
      if (!engine) return

      const scene = engine.scenes[0]
      if (!scene) return

      // Enable instrumentation if not already
      if (!instrumentationRef.current) {
        instrumentationRef.current = new SceneInstrumentation(scene)
        instrumentationRef.current.captureFrameTime = true
        instrumentationRef.current.captureRenderTime = true
        instrumentationRef.current.captureInterFrameTime = true
      }

      // Only recalculate mesh breakdown when mesh count changes
      const currentMeshCount = scene.meshes.length
      if (currentMeshCount !== prevMeshCountRef.current) {
        prevMeshCountRef.current = currentMeshCount
        let totalTriangles = 0
        const meshMap = new Map<string, { triangles: number; vertices: number }>()

        for (const mesh of scene.meshes) {
          if (mesh.isEnabled() && mesh.isVisible && mesh.getTotalIndices) {
            const indices = mesh.getTotalIndices()
            const vertices = mesh.getTotalVertices?.() ?? 0

            // Handle non-indexed geometry (e.g. CAD-exported GLBs with no
            // index buffer): fall back to vertices / 3.
            let triangles = indices > 0
              ? Math.floor(indices / 3)
              : Math.floor(vertices / 3)

            // Thin instances multiply the template geometry
            const instanceCount = (mesh as unknown as { thinInstanceCount?: number }).thinInstanceCount
            if (instanceCount && instanceCount > 0) {
              triangles *= instanceCount
            }

            totalTriangles += triangles

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
      }

      // Detect engine type
      const isWebGPU = engine instanceof WebGPUEngine || engine.name === 'WebGPU'

      // Use the scene instrumentation's draw call count (v8 compatible)
      const drawCalls = (engine as unknown as { _drawCalls?: { current: number } })._drawCalls?.current ?? 0

      setStats({
        fps: Math.round(engine.getFps()),
        frameTime: parseFloat(instrumentationRef.current.frameTimeCounter.lastSecAverage.toFixed(2)),
        drawCalls,
        triangles: cachedTrianglesRef.current,
        vertices: scene.getTotalVertices?.() ?? 0,
        activeMeshes: scene.getActiveMeshes?.().length ?? 0,
        totalMeshes: currentMeshCount,
        materials: scene.materials.length,
        textures: scene.textures.length,
        engineType: isWebGPU ? 'WebGPU' : 'WebGL',
        meshBreakdown: cachedBreakdownRef.current,
      })
    }

    // Update every 500ms
    const interval = setInterval(updateStats, 500)
    updateStats()

    return () => {
      clearInterval(interval)
      if (instrumentationRef.current) {
        instrumentationRef.current.dispose()
        instrumentationRef.current = null
      }
    }
  }, [])

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
