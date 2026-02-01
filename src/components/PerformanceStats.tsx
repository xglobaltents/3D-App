import { type FC, useEffect, useState, useRef } from 'react'
import { Engine, SceneInstrumentation, WebGPUEngine } from '@babylonjs/core'

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
}

export const PerformanceStats: FC = () => {
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
  })
  const instrumentationRef = useRef<SceneInstrumentation | null>(null)

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

      // Calculate triangles from meshes
      let totalTriangles = 0
      for (const mesh of scene.meshes) {
        if (mesh.isEnabled() && mesh.isVisible && mesh.getTotalIndices) {
          totalTriangles += Math.floor(mesh.getTotalIndices() / 3)
        }
      }

      // Detect engine type
      const isWebGPU = engine instanceof WebGPUEngine || engine.name === 'WebGPU'

      setStats({
        fps: Math.round(engine.getFps()),
        frameTime: parseFloat(instrumentationRef.current.frameTimeCounter.lastSecAverage.toFixed(2)),
        drawCalls: engine.drawCallsPerfCounter?.current ?? 0,
        triangles: totalTriangles,
        vertices: scene.getTotalVertices?.() ?? 0,
        activeMeshes: scene.getActiveMeshes?.().length ?? 0,
        totalMeshes: scene.meshes.length,
        materials: scene.materials.length,
        textures: scene.textures.length,
        engineType: isWebGPU ? 'WebGPU' : 'WebGL',
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
      <h3>Performance Analytics</h3>
      
      <div className="engine-badge" data-engine={stats.engineType.toLowerCase()}>
        {stats.engineType === 'WebGPU' ? '🚀' : '🎮'} {stats.engineType}
      </div>
      
      <div className="stats-grid">
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
    </div>
  )
}
