import { useEffect, useRef, useState, useCallback } from 'react'
import { Move, Pause, Play, RotateCcw, ZoomIn, ZoomOut, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

export type GraphNode = {
  id: string
  type: string
  label: string
  weight: number
  documentIds: string[]
}

export type Edge = {
  id: string
  from: string
  to: string
  relation: string
  weight: number
}

interface SimNode extends GraphNode {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  degree: number
}

interface SimParticle {
  t: number
  speed: number
  size: number
}

interface SimEdge extends Edge {
  particles: SimParticle[]
}

const DEFAULT_NODE_COLORS: Record<string, string> = {
  subject: '#22d3ee',
  keyword: '#a78bfa',
  platform: '#34d399',
  topic: '#fb923c',
}

interface ObsidianForceGraphProps {
  nodes: GraphNode[]
  edges: Edge[]
  selectedElement: GraphNode | Edge | null
  onSelectElement: (element: GraphNode | Edge | null) => void
  nodeColors?: Record<string, string>
}

export function ObsidianForceGraph({
  nodes,
  edges,
  selectedElement,
  onSelectElement,
  nodeColors = DEFAULT_NODE_COLORS,
}: ObsidianForceGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Simulation & View state
  const simNodesRef = useRef<Map<string, SimNode>>(new Map())
  const simEdgesRef = useRef<SimEdge[]>([])
  const transformRef = useRef({ panX: 0, panY: 0, zoom: 1 })
  const alphaRef = useRef<number>(1.0)

  const [isPaused, setIsPaused] = useState(false)
  const isPausedRef = useRef(false)
  isPausedRef.current = isPaused

  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)
  const hoveredNodeRef = useRef<SimNode | null>(null)
  hoveredNodeRef.current = hoveredNode

  const dragRef = useRef<{
    node: SimNode | null
    isPanning: boolean
    startX: number
    startY: number
    initialPanX: number
    initialPanY: number
    hasMoved: boolean
  }>({
    node: null,
    isPanning: false,
    startX: 0,
    startY: 0,
    initialPanX: 0,
    initialPanY: 0,
    hasMoved: false,
  })

  // Wake up physics
  const reheat = useCallback((alpha = 0.7) => {
    alphaRef.current = Math.max(alphaRef.current, alpha)
  }, [])

  // Physics simulation single step function
  const runPhysicsStep = useCallback((alpha: number, width: number, height: number) => {
    const nodeList = Array.from(simNodesRef.current.values())
    const edgeList = simEdgesRef.current
    const nodeMap = simNodesRef.current

    const repulsion = 3800
    const springLength = 110
    const springK = 0.022
    const centerGravity = 0.004
    const minDistance = 32
    const maxDistance = 450

    const centerX = width / 2
    const centerY = height / 2

    // 1. Repulsion & Collision between node pairs
    for (let i = 0; i < nodeList.length; i++) {
      const n1 = nodeList[i]
      for (let j = i + 1; j < nodeList.length; j++) {
        const n2 = nodeList[j]
        const dx = n2.x - n1.x
        const dy = n2.y - n1.y
        const distSq = dx * dx + dy * dy
        if (distSq > maxDistance * maxDistance) continue

        const dist = Math.max(Math.sqrt(distSq), 0.1)
        const minDist = n1.radius + n2.radius + 18

        let force = (repulsion * alpha) / Math.max(distSq, minDistance * minDistance)
        // Strong collision push if overlapping
        if (dist < minDist) {
          force += ((minDist - dist) * 0.8 * alpha)
        }

        const fx = Math.min((dx / dist) * force, 6)
        const fy = Math.min((dy / dist) * force, 6)

        if (n1 !== dragRef.current.node) {
          n1.vx -= fx
          n1.vy -= fy
        }
        if (n2 !== dragRef.current.node) {
          n2.vx += fx
          n2.vy += fy
        }
      }

      // Centering gravity
      if (n1 !== dragRef.current.node) {
        n1.vx += (centerX - n1.x) * centerGravity * alpha
        n1.vy += (centerY - n1.y) * centerGravity * alpha
      }
    }

    // 2. Spring attraction for connected edges
    for (let i = 0; i < edgeList.length; i++) {
      const edge = edgeList[i]
      const source = nodeMap.get(edge.from)
      const target = nodeMap.get(edge.to)
      if (!source || !target) continue

      const dx = target.x - source.x
      const dy = target.y - source.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
      const force = (dist - springLength) * springK * alpha * Math.min(edge.weight || 1, 2)
      const fx = Math.min(Math.max((dx / dist) * force, -6), 6)
      const fy = Math.min(Math.max((dy / dist) * force, -6), 6)

      if (source !== dragRef.current.node) {
        source.vx += fx
        source.vy += fy
      }
      if (target !== dragRef.current.node) {
        target.vx -= fx
        target.vy -= fy
      }
    }

    // 3. Velocity integration & damping
    const damping = 0.82
    const maxSpeed = 8
    for (let i = 0; i < nodeList.length; i++) {
      const n = nodeList[i]
      if (n === dragRef.current.node) continue
      n.vx *= damping
      n.vy *= damping

      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
      if (speed > maxSpeed) {
        n.vx = (n.vx / speed) * maxSpeed
        n.vy = (n.vy / speed) * maxSpeed
      }

      n.x += n.vx
      n.y += n.vy
    }
  }, [])

  // Sync incoming nodes/edges with simulation ref
  useEffect(() => {
    const currentNodes = simNodesRef.current
    const newMap = new Map<string, SimNode>()

    const width = containerRef.current?.clientWidth || 550
    const height = containerRef.current?.clientHeight || 450
    const centerX = width / 2
    const centerY = height / 2

    // Compute node degrees (connectivity)
    const degreeMap = new Map<string, number>()
    edges.forEach((e) => {
      degreeMap.set(e.from, (degreeMap.get(e.from) || 0) + 1)
      degreeMap.set(e.to, (degreeMap.get(e.to) || 0) + 1)
    })

    const initialRadius = Math.min(width, height) * 0.35

    nodes.forEach((node, idx) => {
      const existing = currentNodes.get(node.id)
      const degree = degreeMap.get(node.id) || 0
      const radius = Math.min(18, Math.max(6, 5 + Math.sqrt(node.weight || 1) * 2.5 + Math.min(degree * 0.4, 4)))

      if (existing) {
        newMap.set(node.id, {
          ...existing,
          ...node,
          radius,
          degree,
        })
      } else {
        const angle = (Math.PI * 2 * idx) / Math.max(nodes.length, 1) + (Math.random() - 0.5) * 0.3
        const dist = initialRadius * (0.3 + (idx % 6) * 0.15) + (Math.random() - 0.5) * 40
        newMap.set(node.id, {
          ...node,
          x: centerX + Math.cos(angle) * dist,
          y: centerY + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          radius,
          degree,
        })
      }
    })

    simNodesRef.current = newMap

    // Prepare edges with photon particles
    simEdgesRef.current = edges.map((e) => {
      const particles: SimParticle[] = [
        { t: Math.random(), speed: 0.0022 + Math.random() * 0.0018, size: 2.2 },
        { t: (Math.random() + 0.5) % 1, speed: 0.0022 + Math.random() * 0.0018, size: 1.8 },
      ]
      return {
        ...e,
        particles,
      }
    })

    // Pre-warm the simulation for 50 ticks so nodes are already well distributed
    for (let k = 0; k < 50; k++) {
      runPhysicsStep(0.9 * (1 - k / 60), width, height)
    }

    reheat(0.8)
  }, [nodes, edges, reheat, runPhysicsStep])

  // Center/Reset View - Scaled cleanly to fill ~82% of the canvas area
  const resetView = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return

    const allNodes = Array.from(simNodesRef.current.values())
    if (!allNodes.length) {
      transformRef.current = { panX: width / 2, panY: height / 2, zoom: 1 }
      return
    }

    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity
    allNodes.forEach((n) => {
      if (n.x < minX) minX = n.x
      if (n.x > maxX) maxX = n.x
      if (n.y < minY) minY = n.y
      if (n.y > maxY) maxY = n.y
    })

    const boundsW = Math.max(maxX - minX + 80, 150)
    const boundsH = Math.max(maxY - minY + 80, 150)

    const scaleX = (width - 40) / boundsW
    const scaleY = (height - 40) / boundsH
    const fitZoom = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.92, 0.45), 1.6)

    const clusterCenterX = (minX + maxX) / 2
    const clusterCenterY = (minY + maxY) / 2

    transformRef.current = {
      zoom: fitZoom,
      panX: width / 2 - clusterCenterX * fitZoom,
      panY: height / 2 - clusterCenterY * fitZoom,
    }
  }, [])

  // Auto fit once after mount & handle container resize
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let prevWidth = container.clientWidth
    let prevHeight = container.clientHeight

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (Math.abs(width - prevWidth) > 20 || Math.abs(height - prevHeight) > 20) {
          prevWidth = width
          prevHeight = height
          resetView()
          reheat(0.4)
        }
      }
    })

    resizeObserver.observe(container)
    const timer = setTimeout(() => {
      resetView()
      reheat(0.8)
    }, 120)

    return () => {
      clearTimeout(timer)
      resizeObserver.disconnect()
    }
  }, [resetView, reheat])

  // Main Animation Loop
  useEffect(() => {
    let animId: number

    const render = (time: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const width = canvas.clientWidth
      const height = canvas.clientHeight
      const dpr = window.devicePixelRatio || 1

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr
        canvas.height = height * dpr
      }

      ctx.save()
      ctx.scale(dpr, dpr)
      ctx.clearRect(0, 0, width, height)

      const nodeList = Array.from(simNodesRef.current.values())
      const edgeList = simEdgesRef.current
      const nodeMap = simNodesRef.current

      // --- 1. Physics Step ---
      const alpha = alphaRef.current
      if (!isPausedRef.current && alpha > 0.003) {
        runPhysicsStep(alpha, width, height)
        alphaRef.current *= 0.985
      }

      // Update Edge Particles
      for (let i = 0; i < edgeList.length; i++) {
        const edge = edgeList[i]
        edge.particles.forEach((p) => {
          p.t = (p.t + p.speed) % 1
        })
      }

      // --- 2. Canvas Rendering with Transform ---
      const { panX, panY, zoom } = transformRef.current
      ctx.save()
      ctx.translate(panX, panY)
      ctx.scale(zoom, zoom)

      // Subtle Cyber Grid
      const gridSize = 45
      const startX = -panX / zoom - 50
      const startY = -panY / zoom - 50
      const endX = (width - panX) / zoom + 50
      const endY = (height - panY) / zoom + 50

      ctx.fillStyle = 'rgba(148, 163, 184, 0.05)'
      for (let gx = Math.floor(startX / gridSize) * gridSize; gx < endX; gx += gridSize) {
        for (let gy = Math.floor(startY / gridSize) * gridSize; gy < endY; gy += gridSize) {
          ctx.fillRect(gx, gy, 1, 1)
        }
      }

      const activeHover = hoveredNodeRef.current
      const selectedId = selectedElement && 'id' in selectedElement ? selectedElement.id : null

      // Build Set of connected node IDs if hover/selected
      const connectedNodeIds = new Set<string>()
      const highlightedEdgeIds = new Set<string>()
      const targetFocusId = activeHover?.id || selectedId

      if (targetFocusId) {
        connectedNodeIds.add(targetFocusId)
        edgeList.forEach((e) => {
          if (e.from === targetFocusId || e.to === targetFocusId) {
            connectedNodeIds.add(e.from)
            connectedNodeIds.add(e.to)
            highlightedEdgeIds.add(e.id)
          }
        })
      }

      // Draw Edges
      edgeList.forEach((edge) => {
        const source = nodeMap.get(edge.from)
        const target = nodeMap.get(edge.to)
        if (!source || !target) return

        const isHighlighted = highlightedEdgeIds.has(edge.id)
        const isDimmed = Boolean(targetFocusId && !isHighlighted)

        ctx.beginPath()
        ctx.moveTo(source.x, source.y)
        ctx.lineTo(target.x, target.y)

        if (isHighlighted) {
          ctx.strokeStyle = '#22d3ee'
          ctx.lineWidth = Math.min(3, 1.6 + edge.weight * 0.2)
          ctx.shadowColor = '#22d3ee'
          ctx.shadowBlur = 8
        } else if (isDimmed) {
          ctx.strokeStyle = 'rgba(71, 85, 105, 0.12)'
          ctx.lineWidth = 0.6
          ctx.shadowBlur = 0
        } else {
          ctx.strokeStyle = 'rgba(100, 116, 139, 0.28)'
          ctx.lineWidth = Math.min(1.6, 0.8 + edge.weight * 0.08)
          ctx.shadowBlur = 0
        }

        ctx.stroke()
        ctx.shadowBlur = 0

        // Animated photon particles
        if (!isDimmed) {
          edge.particles.forEach((p) => {
            const px = source.x + (target.x - source.x) * p.t
            const py = source.y + (target.y - source.y) * p.t

            ctx.beginPath()
            ctx.arc(px, py, isHighlighted ? p.size * 1.3 : p.size, 0, Math.PI * 2)
            ctx.fillStyle = isHighlighted ? '#38bdf8' : 'rgba(34, 211, 238, 0.7)'
            if (isHighlighted) {
              ctx.shadowColor = '#38bdf8'
              ctx.shadowBlur = 5
            }
            ctx.fill()
            ctx.shadowBlur = 0
          })
        }
      })

      // Sort nodes to find top important ones for smart label density (Obsidian Style)
      const topNodes = new Set(
        [...nodeList]
          .sort((a, b) => (b.weight * 2 + b.degree) - (a.weight * 2 + a.degree))
          .slice(0, 16)
          .map((n) => n.id)
      )

      // Draw Nodes
      const now = time * 0.0025
      nodeList.forEach((node) => {
        const isSelected = selectedId === node.id
        const isHovered = activeHover?.id === node.id
        const isConnected = connectedNodeIds.has(node.id)
        const isDimmed = Boolean(targetFocusId && !isConnected)
        const isMajorNode = topNodes.has(node.id)

        const baseColor = nodeColors[node.type] || '#94a3b8'

        ctx.save()
        ctx.translate(node.x, node.y)

        // 1. Outer Pulse Aura / Halo
        if (isSelected || isHovered) {
          const pulseR = node.radius + 5 + Math.sin(now * 3.5) * 1.8
          const gradient = ctx.createRadialGradient(0, 0, node.radius * 0.7, 0, 0, pulseR)
          gradient.addColorStop(0, `${baseColor}60`)
          gradient.addColorStop(1, `${baseColor}00`)

          ctx.beginPath()
          ctx.arc(0, 0, pulseR, 0, Math.PI * 2)
          ctx.fillStyle = gradient
          ctx.fill()
        }

        // 2. Node Core Circle
        ctx.beginPath()
        ctx.arc(0, 0, node.radius, 0, Math.PI * 2)

        if (isDimmed) {
          ctx.fillStyle = 'rgba(51, 65, 85, 0.3)'
          ctx.fill()
        } else {
          ctx.fillStyle = baseColor
          if (isSelected || isHovered) {
            ctx.shadowColor = baseColor
            ctx.shadowBlur = 12
          }
          ctx.fill()

          ctx.lineWidth = isSelected ? 2.4 : isHovered ? 1.8 : 1.2
          ctx.strokeStyle = isSelected ? '#ffffff' : isHovered ? '#f8fafc' : 'rgba(255, 255, 255, 0.45)'
          ctx.stroke()
        }
        ctx.shadowBlur = 0

        // 3. Obsidian Smart Label Density (Prevents overlapping chaos)
        // Show label if:
        // - Node is hovered, selected, or directly connected to active focus
        // - OR node is a major hub (top 16)
        // - OR user zoomed in (zoom > 1.3)
        const shouldShowLabel =
          isHovered ||
          isSelected ||
          (targetFocusId && isConnected) ||
          (!targetFocusId && (isMajorNode || zoom > 1.3))

        if (shouldShowLabel) {
          const fontSize = isSelected || isHovered ? 11 : isMajorNode ? 10 : 9
          ctx.font = `${isSelected || isHovered ? '600' : '500'} ${fontSize}px Inter, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'

          const labelY = node.radius + 3
          const text = node.label.length > 12 ? `${node.label.slice(0, 11)}…` : node.label

          if (!isDimmed) {
            ctx.fillStyle = isSelected ? '#38bdf8' : isHovered ? '#ffffff' : isMajorNode ? '#e2e8f0' : '#94a3b8'
            ctx.shadowColor = 'rgba(10, 15, 29, 0.95)'
            ctx.shadowBlur = 4
            ctx.fillText(text, 0, labelY)
            ctx.shadowBlur = 0
          } else {
            ctx.fillStyle = 'rgba(100, 116, 139, 0.25)'
            ctx.fillText(text, 0, labelY)
          }
        }

        ctx.restore()
      })

      ctx.restore()
      ctx.restore()

      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animId)
  }, [selectedElement, nodeColors, runPhysicsStep])

  // Mouse Handlers
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>): { screenX: number; screenY: number } => {
    const canvas = canvasRef.current
    if (!canvas) return { screenX: 0, screenY: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
    }
  }

  const screenToWorld = (screenX: number, screenY: number) => {
    const { panX, panY, zoom } = transformRef.current
    return {
      worldX: (screenX - panX) / zoom,
      worldY: (screenY - panY) / zoom,
    }
  }

  const findNodeAt = (worldX: number, worldY: number): SimNode | null => {
    const nodes = Array.from(simNodesRef.current.values())
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      const dx = n.x - worldX
      const dy = n.y - worldY
      if (dx * dx + dy * dy <= (n.radius + 7) * (n.radius + 7)) {
        return n
      }
    }
    return null
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { screenX, screenY } = getCanvasCoords(e)
    const { worldX, worldY } = screenToWorld(screenX, screenY)
    const hitNode = findNodeAt(worldX, worldY)

    if (hitNode) {
      dragRef.current = {
        node: hitNode,
        isPanning: false,
        startX: screenX,
        startY: screenY,
        initialPanX: transformRef.current.panX,
        initialPanY: transformRef.current.panY,
        hasMoved: false,
      }
      hitNode.vx = 0
      hitNode.vy = 0
      reheat(0.35)
    } else {
      dragRef.current = {
        node: null,
        isPanning: true,
        startX: screenX,
        startY: screenY,
        initialPanX: transformRef.current.panX,
        initialPanY: transformRef.current.panY,
        hasMoved: false,
      }
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { screenX, screenY } = getCanvasCoords(e)
    const { worldX, worldY } = screenToWorld(screenX, screenY)

    const drag = dragRef.current
    const dx = screenX - drag.startX
    const dy = screenY - drag.startY
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.hasMoved = true
    }

    if (drag.node) {
      drag.node.x = worldX
      drag.node.y = worldY
      drag.node.vx = 0
      drag.node.vy = 0
      reheat(0.25)
    } else if (drag.isPanning) {
      transformRef.current.panX = drag.initialPanX + dx
      transformRef.current.panY = drag.initialPanY + dy
    } else {
      const hovered = findNodeAt(worldX, worldY)
      setHoveredNode(hovered)
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag.hasMoved) {
      const { screenX, screenY } = getCanvasCoords(e)
      const { worldX, worldY } = screenToWorld(screenX, screenY)
      const hitNode = findNodeAt(worldX, worldY)
      if (hitNode) {
        onSelectElement(hitNode)
      } else {
        onSelectElement(null)
      }
    }
    dragRef.current = {
      node: null,
      isPanning: false,
      startX: 0,
      startY: 0,
      initialPanX: 0,
      initialPanY: 0,
      hasMoved: false,
    }
  }

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const { screenX, screenY } = getCanvasCoords(e)
    const zoomFactor = e.deltaY < 0 ? 1.12 : 0.89

    const currentZoom = transformRef.current.zoom
    const newZoom = Math.min(Math.max(currentZoom * zoomFactor, 0.4), 3.2)
    if (newZoom === currentZoom) return

    const { panX, panY } = transformRef.current
    transformRef.current = {
      zoom: newZoom,
      panX: screenX - (screenX - panX) * (newZoom / currentZoom),
      panY: screenY - (screenY - panY) * (newZoom / currentZoom),
    }
  }

  const handleZoomIn = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cx = canvas.clientWidth / 2
    const cy = canvas.clientHeight / 2
    const currentZoom = transformRef.current.zoom
    const newZoom = Math.min(currentZoom * 1.25, 3.2)
    const { panX, panY } = transformRef.current
    transformRef.current = {
      zoom: newZoom,
      panX: cx - (cx - panX) * (newZoom / currentZoom),
      panY: cy - (cy - panY) * (newZoom / currentZoom),
    }
  }

  const handleZoomOut = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const cx = canvas.clientWidth / 2
    const cy = canvas.clientHeight / 2
    const currentZoom = transformRef.current.zoom
    const newZoom = Math.max(currentZoom * 0.8, 0.4)
    const { panX, panY } = transformRef.current
    transformRef.current = {
      zoom: newZoom,
      panX: cx - (cx - panX) * (newZoom / currentZoom),
      panY: cy - (cy - panY) * (newZoom / currentZoom),
    }
  }

  return (
    <div ref={containerRef} className="relative h-full w-full min-h-[360px] overflow-hidden rounded-xl border border-cyber-border-subtle bg-cyber-bg-primary/70 select-none group">
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Floating Control Toolbar (Obsidian style) */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/90 p-1 shadow-xl backdrop-blur-md">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10"
          onClick={handleZoomIn}
          title="放大 (滚轮向上)"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10"
          onClick={handleZoomOut}
          title="缩小 (滚轮向下)"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10"
          onClick={() => { resetView(); reheat(0.8) }}
          title="居中适应画布"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10"
          onClick={() => reheat(0.8)}
          title="重新激活力学布局"
        >
          <Sparkles className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 w-7 p-0 ${isPaused ? 'text-amber-400 bg-amber-400/10' : 'text-cyber-text-muted hover:text-cyber-text-primary'}`}
          onClick={() => setIsPaused((prev) => !prev)}
          title={isPaused ? '恢复物理动力学' : '锁定当前位置'}
        >
          {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Quick Interactive Hint Overlay */}
      <div className="pointer-events-none absolute top-2.5 left-3 text-[10px] text-cyber-text-muted/60 flex items-center gap-1.5">
        <Move className="h-3 w-3" />
        <span>拖拽节点 / 滚轮缩放 / 拖拽平移</span>
      </div>
    </div>
  )
}
