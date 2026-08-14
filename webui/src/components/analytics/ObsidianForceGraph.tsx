import { useEffect, useRef, useState, useCallback } from 'react'
import { Combine, Link2, Move, Pause, Play, RotateCcw, Sparkles, ZoomIn, ZoomOut } from 'lucide-react'
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
  onMergeNodes?: (sourceNode: GraphNode, targetNode: GraphNode) => void
  onConnectNodes?: (sourceNode: GraphNode, targetNode: GraphNode) => void
  nodeColors?: Record<string, string>
}

export function ObsidianForceGraph({
  nodes,
  edges,
  selectedElement,
  onSelectElement,
  onMergeNodes,
  onConnectNodes,
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

  const [isLinkMode, setIsLinkMode] = useState(false)
  const isLinkModeRef = useRef(false)
  isLinkModeRef.current = isLinkMode

  const [isMergeMode, setIsMergeMode] = useState(false)
  const isMergeModeRef = useRef(false)
  isMergeModeRef.current = isMergeMode

  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)
  const hoveredNodeRef = useRef<SimNode | null>(null)
  hoveredNodeRef.current = hoveredNode

  const linkingCursorRef = useRef<{ worldX: number; worldY: number } | null>(null)
  const linkTargetNodeRef = useRef<SimNode | null>(null)
  const mergeTargetNodeRef = useRef<SimNode | null>(null)

  const dragRef = useRef<{
    node: SimNode | null
    isPanning: boolean
    isLinking: boolean
    isMerging: boolean
    startX: number
    startY: number
    initialPanX: number
    initialPanY: number
    hasMoved: boolean
  }>({
    node: null,
    isPanning: false,
    isLinking: false,
    isMerging: false,
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
    const draggingNode = dragRef.current.node
    const isMerging = dragRef.current.isMerging

    for (let i = 0; i < nodeList.length; i++) {
      const n1 = nodeList[i]
      for (let j = i + 1; j < nodeList.length; j++) {
        const n2 = nodeList[j]
        // If in deliberate Merge mode (Alt key or button), mute mutual repulsion so target node stays steady
        if (isMerging && draggingNode && (n1 === draggingNode || n2 === draggingNode)) {
          continue
        }

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

        if (n1 !== draggingNode) {
          n1.vx -= fx
          n1.vy -= fy
        }
        if (n2 !== draggingNode) {
          n2.vx += fx
          n2.vy += fy
        }
      }

      // Centering gravity
      if (n1 !== draggingNode) {
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

  // Auto fit once after mount & whenever nodes change
  useEffect(() => {
    const timer = setTimeout(() => {
      resetView()
      reheat(0.8)
    }, 80)

    return () => {
      clearTimeout(timer)
    }
  }, [nodes, resetView, reheat])

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

        // 3. Obsidian Authentic Label Density (Hides labels on zoom-out, pure starry constellation)
        // - When hovered or selected: show label for this node and directly connected neighbors
        // - When zoomed in (zoom >= 1.25): show labels for major hub nodes
        // - When deeply zoomed in (zoom >= 1.7): show all visible labels
        // - When zoomed out (zoom < 1.25): hide all background labels for a clean, minimal graph
        const shouldShowLabel =
          isHovered ||
          isSelected ||
          (targetFocusId && isConnected) ||
          (!targetFocusId && (
            (zoom >= 1.7) ||
            (zoom >= 1.25 && isMajorNode)
          ))

        if (shouldShowLabel) {
          const fontSize = isSelected || isHovered ? 11 : isMajorNode ? 10 : 9.5
          ctx.font = `${isSelected || isHovered ? '600' : isMajorNode ? '600' : '500'} ${fontSize}px Inter, -apple-system, system-ui, sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'

          const labelY = node.radius + 4
          const text = node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label

          ctx.shadowBlur = 0
          ctx.shadowColor = 'transparent'

          const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

          if (isDark) {
            ctx.fillStyle = isSelected
              ? '#38bdf8'
              : isHovered
              ? '#ffffff'
              : isMajorNode
              ? '#f1f5f9'
              : !isDimmed
              ? '#cbd5e1'
              : 'rgba(148, 163, 184, 0.35)'
          } else {
            // Light Theme (Clean, Sharp, High-Contrast)
            ctx.fillStyle = isSelected
              ? '#0284c7'
              : isHovered
              ? '#0f172a'
              : isMajorNode
              ? '#0f172a'
              : !isDimmed
              ? '#334155'
              : '#94a3b8'
          }

          ctx.fillText(text, 0, labelY)
        }

        ctx.restore()
      })

      // --- 3. Draw Link in Progress (Shift-drag or Link Mode) ---
      if (dragRef.current.isLinking && dragRef.current.node && linkingCursorRef.current) {
        const source = dragRef.current.node
        const cursor = linkingCursorRef.current
        const target = linkTargetNodeRef.current

        ctx.save()
        ctx.beginPath()
        ctx.moveTo(source.x, source.y)
        if (target) {
          ctx.lineTo(target.x, target.y)
          ctx.strokeStyle = '#34d399'
          ctx.shadowColor = '#34d399'
        } else {
          ctx.lineTo(cursor.worldX, cursor.worldY)
          ctx.strokeStyle = '#22d3ee'
          ctx.shadowColor = '#22d3ee'
        }
        ctx.lineWidth = 2.5
        ctx.shadowBlur = 10
        ctx.setLineDash([6, 4])
        ctx.stroke()
        ctx.setLineDash([])

        if (target) {
          ctx.beginPath()
          const pulse = (Math.sin(Date.now() / 150) + 1) * 3 + target.radius + 6
          ctx.arc(target.x, target.y, pulse, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(52, 211, 153, 0.9)'
          ctx.lineWidth = 2.5
          ctx.stroke()

          ctx.font = '600 11px Inter, system-ui, sans-serif'
          ctx.fillStyle = '#059669'
          ctx.textAlign = 'center'
          ctx.shadowBlur = 0
          ctx.fillText(`⚡ 松开建立关联: ${source.label} ↔ ${target.label}`, target.x, target.y - target.radius - 12)
        }
        ctx.restore()
      }

      // --- 4. Draw Merge Target Indicator (Drag over another node) ---
      if (dragRef.current.node && !dragRef.current.isLinking && mergeTargetNodeRef.current) {
        const source = dragRef.current.node
        const target = mergeTargetNodeRef.current

        ctx.save()
        ctx.beginPath()
        const pulse = (Math.sin(Date.now() / 120) + 1) * 4 + target.radius + 8
        ctx.arc(target.x, target.y, pulse, 0, Math.PI * 2)
        ctx.strokeStyle = '#a855f7'
        ctx.shadowColor = '#a855f7'
        ctx.shadowBlur = 14
        ctx.lineWidth = 2.5
        ctx.stroke()

        ctx.font = '600 11.5px Inter, system-ui, sans-serif'
        ctx.fillStyle = '#7c3aed'
        ctx.textAlign = 'center'
        ctx.shadowBlur = 0
        ctx.fillText(`🧩 松开以合并「${source.label}」入「${target.label}」`, target.x, target.y - target.radius - 14)
        ctx.restore()
      }

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

  const findNodeAt = (worldX: number, worldY: number, excludeId?: string, extraRadius = 14): SimNode | null => {
    const nodes = Array.from(simNodesRef.current.values())
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i]
      if (excludeId && n.id === excludeId) continue
      const dx = n.x - worldX
      const dy = n.y - worldY
      const hitRadius = Math.max(n.radius + extraRadius, 18)
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return n
      }
    }
    return null
  }

  const findEdgeAt = (worldX: number, worldY: number, maxDist = 10): SimEdge | null => {
    const edges = simEdgesRef.current
    const nodeMap = simNodesRef.current
    for (const edge of edges) {
      const s = nodeMap.get(edge.from)
      const t = nodeMap.get(edge.to)
      if (!s || !t) continue
      const dx = t.x - s.x
      const dy = t.y - s.y
      const lenSq = dx * dx + dy * dy
      if (lenSq === 0) continue
      let param = ((worldX - s.x) * dx + (worldY - s.y) * dy) / lenSq
      param = Math.max(0, Math.min(1, param))
      const projX = s.x + param * dx
      const projY = s.y + param * dy
      const distSq = (worldX - projX) ** 2 + (worldY - projY) ** 2
      if (distSq <= maxDist * maxDist) {
        return edge
      }
    }
    return null
  }

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { screenX, screenY } = getCanvasCoords(e)
    const { worldX, worldY } = screenToWorld(screenX, screenY)
    const hitNode = findNodeAt(worldX, worldY, undefined, 14)

    const shouldLink = e.shiftKey || isLinkModeRef.current
    const shouldMerge = e.altKey || isMergeModeRef.current

    if (hitNode) {
      if (shouldLink) {
        dragRef.current = {
          node: hitNode,
          isPanning: false,
          isLinking: true,
          isMerging: false,
          startX: screenX,
          startY: screenY,
          initialPanX: transformRef.current.panX,
          initialPanY: transformRef.current.panY,
          hasMoved: false,
        }
        linkingCursorRef.current = { worldX, worldY }
        linkTargetNodeRef.current = null
        mergeTargetNodeRef.current = null
      } else if (shouldMerge && hitNode.type !== 'platform') {
        dragRef.current = {
          node: hitNode,
          isPanning: false,
          isLinking: false,
          isMerging: true,
          startX: screenX,
          startY: screenY,
          initialPanX: transformRef.current.panX,
          initialPanY: transformRef.current.panY,
          hasMoved: false,
        }
        linkingCursorRef.current = null
        linkTargetNodeRef.current = null
        mergeTargetNodeRef.current = null
        hitNode.vx = 0
        hitNode.vy = 0
        reheat(0.35)
      } else {
        dragRef.current = {
          node: hitNode,
          isPanning: false,
          isLinking: false,
          isMerging: false,
          startX: screenX,
          startY: screenY,
          initialPanX: transformRef.current.panX,
          initialPanY: transformRef.current.panY,
          hasMoved: false,
        }
        hitNode.vx = 0
        hitNode.vy = 0
        reheat(0.35)
      }
    } else {
      dragRef.current = {
        node: null,
        isPanning: true,
        isLinking: false,
        isMerging: false,
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
    const distMoved = Math.hypot(dx, dy)
    if (distMoved > 6) {
      drag.hasMoved = true
    }

    if (drag.isLinking && drag.node) {
      linkingCursorRef.current = { worldX, worldY }
      const target = findNodeAt(worldX, worldY, drag.node.id, 16)
      linkTargetNodeRef.current = target
    } else if (drag.isMerging && drag.node) {
      drag.node.x = worldX
      drag.node.y = worldY
      drag.node.vx = 0
      drag.node.vy = 0
      reheat(0.25)

      // Detect hover over another node to merge (must match node type and cannot be platform)
      const target = findNodeAt(worldX, worldY, drag.node.id, 32)
      if (target && target.type === drag.node.type && drag.node.type !== 'platform') {
        target.vx = 0
        target.vy = 0
        mergeTargetNodeRef.current = target
      } else {
        mergeTargetNodeRef.current = null
      }
    } else if (drag.node) {
      // Normal physics dragging (explore dynamic electromagnetic repulsion)
      drag.node.x = worldX
      drag.node.y = worldY
      drag.node.vx = 0
      drag.node.vy = 0
      mergeTargetNodeRef.current = null
      reheat(0.35)
    } else if (drag.isPanning) {
      transformRef.current.panX = drag.initialPanX + dx
      transformRef.current.panY = drag.initialPanY + dy
    } else {
      const hovered = findNodeAt(worldX, worldY, undefined, 14)
      setHoveredNode(hovered)
    }
  }

  const handleMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    const { screenX, screenY } = getCanvasCoords(e)
    const { worldX, worldY } = screenToWorld(screenX, screenY)
    const distMoved = Math.hypot(screenX - drag.startX, screenY - drag.startY)

    if (drag.isLinking && drag.node && linkTargetNodeRef.current) {
      const source = drag.node
      const target = linkTargetNodeRef.current
      if (source.id !== target.id) {
        onConnectNodes?.(source, target)
      }
    } else if (drag.isMerging && drag.node && mergeTargetNodeRef.current) {
      const source = drag.node
      const target = mergeTargetNodeRef.current
      if (source.id !== target.id && source.type === target.type && source.type !== 'platform') {
        onMergeNodes?.(source, target)
      }
    } else {
      // 1. If user interacted with a node (pressed down on it), ALWAYS select that node!
      if (drag.node) {
        onSelectElement(drag.node)
      } else {
        // Did user click on a node near release position?
        const clickedNode = findNodeAt(worldX, worldY, undefined, 20)
        if (clickedNode) {
          onSelectElement(clickedNode)
        } else if (distMoved < 8) {
          // Did user click on an edge?
          const clickedEdge = findEdgeAt(worldX, worldY, 12)
          if (clickedEdge) {
            onSelectElement(clickedEdge)
          } else {
            // Clicked empty canvas -> deselect
            onSelectElement(null)
          }
        }
      }
    }

    linkingCursorRef.current = null
    linkTargetNodeRef.current = null
    mergeTargetNodeRef.current = null
    dragRef.current = {
      node: null,
      isPanning: false,
      isLinking: false,
      isMerging: false,
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
        className={`h-full w-full ${
          isLinkMode ? 'cursor-crosshair' : isMergeMode ? 'cursor-alias' : 'cursor-grab active:cursor-grabbing'
        }`}
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
          className={`h-7 px-2 gap-1 text-xs transition-colors ${
            isMergeMode
              ? 'text-violet-300 bg-violet-500/25 border border-violet-500/50 font-medium'
              : 'text-cyber-text-muted hover:text-violet-300 hover:bg-violet-500/10'
          }`}
          onClick={() => {
            setIsMergeMode((prev) => !prev)
            if (!isMergeMode) setIsLinkMode(false)
          }}
          title={isMergeMode ? '退出合并模式' : '开启合并模式 (也可按住 Alt / Option 拖拽)'}
        >
          <Combine className="h-3.5 w-3.5" />
          <span className="text-[11px] hidden sm:inline">{isMergeMode ? '合并中' : '合并'}</span>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 px-2 gap-1 text-xs transition-colors ${
            isLinkMode
              ? 'text-cyber-neon-cyan bg-cyber-neon-cyan/20 border border-cyber-neon-cyan/50 font-medium'
              : 'text-cyber-text-muted hover:text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10'
          }`}
          onClick={() => {
            setIsLinkMode((prev) => !prev)
            if (!isLinkMode) setIsMergeMode(false)
          }}
          title={isLinkMode ? '退出连线模式' : '开启连线模式 (也可按住 Shift 拖拽)'}
        >
          <Link2 className="h-3.5 w-3.5" />
          <span className="text-[11px] hidden sm:inline">{isLinkMode ? '连线中' : '连线'}</span>
        </Button>
        <div className="h-4 w-px bg-cyber-border-subtle mx-0.5" />
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
      <div className="pointer-events-none absolute top-2.5 left-3 text-[10.5px] text-cyber-text-muted/80 flex items-center gap-2 bg-cyber-bg-primary/75 backdrop-blur-xs px-2.5 py-1 rounded-md border border-cyber-border-subtle/50">
        <span className="flex items-center gap-1"><Move className="h-3 w-3 text-cyber-neon-cyan" /> 拖拽探索斥力</span>
        <span className="opacity-40">|</span>
        <span className="flex items-center gap-1"><Combine className="h-3 w-3 text-violet-400" /> 按住 Alt 拖拽可合并</span>
        <span className="opacity-40">|</span>
        <span className="flex items-center gap-1"><Link2 className="h-3 w-3 text-emerald-400" /> 按住 Shift 拖拽可连线</span>
      </div>
    </div>
  )
}
