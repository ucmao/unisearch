import { useEffect, useRef, useState, useCallback } from 'react'
import { Combine, Link2, Move, Pause, Play, RotateCcw, Wand2, ZoomIn, ZoomOut } from 'lucide-react'
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
  spawnTime?: number
  spawnProgress?: number
  isVisible?: boolean
  parentId?: string | null
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
  subject: '#4a82b3', // Obsidian-like calm slate/steel blue
  keyword: '#818cf8', // Soft indigo
  platform: '#34d399', // Emerald
  topic: '#e06a68', // Obsidian-like warm coral/red
}

function computeGrowthSequence(
  graphNodes: GraphNode[],
  graphEdges: Edge[],
  degreeMap: Map<string, number>
): { id: string; parentId: string | null; depth: number }[] {
  if (!graphNodes.length) return []

  const adj = new Map<string, string[]>()
  graphNodes.forEach((n) => adj.set(n.id, []))
  graphEdges.forEach((e) => {
    adj.get(e.from)?.push(e.to)
    adj.get(e.to)?.push(e.from)
  })

  // Sort candidate seeds by importance score (degree + weight)
  const sortedCandidates = [...graphNodes].sort((a, b) => {
    const degA = degreeMap.get(a.id) || 0
    const degB = degreeMap.get(b.id) || 0
    return degB * 2.5 + (b.weight || 1) - (degA * 2.5 + (a.weight || 1))
  })

  const visited = new Set<string>()
  const sequence: { id: string; parentId: string | null; depth: number }[] = []

  for (const candidate of sortedCandidates) {
    if (visited.has(candidate.id)) continue

    const queue: { id: string; parentId: string | null; depth: number }[] = [
      { id: candidate.id, parentId: null, depth: 0 },
    ]
    visited.add(candidate.id)

    while (queue.length > 0) {
      const current = queue.shift()!
      sequence.push(current)

      const neighbors = adj.get(current.id) || []
      const unvisitedNeighbors = neighbors
        .filter((nbrId) => !visited.has(nbrId))
        .sort((idA, idB) => {
          const degA = degreeMap.get(idA) || 0
          const degB = degreeMap.get(idB) || 0
          return degB - degA
        })

      for (const nbrId of unvisitedNeighbors) {
        visited.add(nbrId)
        queue.push({
          id: nbrId,
          parentId: current.id,
          depth: current.depth + 1,
        })
      }
    }
  }

  return sequence
}

function computeFitTransform(
  nodesList: SimNode[],
  width: number,
  height: number,
  customZoom?: number
): { panX: number; panY: number; zoom: number } {
  if (!nodesList.length || !width || !height) {
    return { panX: width / 2 || 0, panY: height / 2 || 0, zoom: 1 }
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity
  nodesList.forEach((n) => {
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  })

  const boundsW = Math.max(maxX - minX + 160, 260)
  const boundsH = Math.max(maxY - minY + 160, 260)

  const scaleX = (width - 60) / boundsW
  const scaleY = (height - 60) / boundsH
  // Cap max zoom to 1.0 so it never over-magnifies into a narrow tunnel
  const naturalZoom = Math.min(Math.max(Math.min(scaleX, scaleY) * 0.90, 0.35), 1.0)
  const fitZoom = customZoom ?? naturalZoom

  const clusterCenterX = (minX + maxX) / 2
  const clusterCenterY = (minY + maxY) / 2

  return {
    zoom: fitZoom,
    panX: width / 2 - clusterCenterX * fitZoom,
    panY: height / 2 - clusterCenterY * fitZoom,
  }
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

  // Smooth camera tweening animation
  const cameraAnimRef = useRef<{
    active: boolean
    startTime: number
    duration: number
    startPanX: number
    startPanY: number
    startZoom: number
    targetPanX: number
    targetPanY: number
    targetZoom: number
  }>({
    active: false,
    startTime: 0,
    duration: 250,
    startPanX: 0,
    startPanY: 0,
    startZoom: 1,
    targetPanX: 0,
    targetPanY: 0,
    targetZoom: 1,
  })

  // Subtle entrance fade-in on dataset switch
  const fadeRef = useRef<{
    active: boolean
    startTime: number
    duration: number
  }>({
    active: false,
    startTime: 0,
    duration: 160,
  })

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

  // Evolution Growth Animation state
  const [isEvolving, setIsEvolving] = useState(false)
  const [evolutionProgress, setEvolutionProgress] = useState({ current: 0, total: 0 })
  const evolutionRef = useRef<{
    active: boolean
    startTime: number
    totalDuration: number
    sequence: { id: string; parentId: string | null; depth: number }[]
  }>({
    active: false,
    startTime: 0,
    totalDuration: 0,
    sequence: [],
  })

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
    const allNodes = Array.from(simNodesRef.current.values())
    const nodeList = allNodes.filter((n) => n.isVisible !== false)
    const edgeList = simEdgesRef.current
    const nodeMap = simNodesRef.current

    // Obsidian-like expansive force parameters: broader repulsion, longer natural spring length, gentle center gravity
    const repulsion = 7200
    const baseSpringLength = 160
    const springK = 0.016
    const centerGravity = 0.0022
    const minDistance = 24
    const maxDistance = 680

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
        const minDist = n1.radius + n2.radius + 16

        let force = (repulsion * alpha) / Math.max(distSq, minDistance * minDistance)
        // Collision push if overlapping
        if (dist < minDist) {
          force += (minDist - dist) * 0.9 * alpha
        }

        const fx = Math.min((dx / dist) * force, 7)
        const fy = Math.min((dy / dist) * force, 7)

        if (n1 !== draggingNode) {
          n1.vx -= fx
          n1.vy -= fy
        }
        if (n2 !== draggingNode) {
          n2.vx += fx
          n2.vy += fy
        }
      }

      // Gentle centering gravity to keep galaxy centered without clumping
      if (n1 !== draggingNode) {
        n1.vx += (centerX - n1.x) * centerGravity * alpha
        n1.vy += (centerY - n1.y) * centerGravity * alpha
      }
    }

    // 2. Spring attraction for connected edges (with adaptive length for hub satellites)
    for (let i = 0; i < edgeList.length; i++) {
      const edge = edgeList[i]
      const source = nodeMap.get(edge.from)
      const target = nodeMap.get(edge.to)
      if (!source || !target || source.isVisible === false || target.isVisible === false) continue

      const dx = target.x - source.x
      const dy = target.y - source.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)

      // Allow satellites around large hub nodes to stretch further out
      const hubDegreeBonus = Math.min(((source.degree || 0) + (target.degree || 0)) * 2.6, 65)
      const effectiveSpringLength = baseSpringLength + hubDegreeBonus

      const force = (dist - effectiveSpringLength) * springK * alpha * Math.min(edge.weight || 1, 1.8)
      const fx = Math.min(Math.max((dx / dist) * force, -7), 7)
      const fy = Math.min(Math.max((dy / dist) * force, -7), 7)

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
    const damping = 0.84
    const maxSpeed = 9
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

  // Center/Reset View - Scaled cleanly to fill ~85% of the canvas area
  const resetView = useCallback((customZoom?: number, smooth = false) => {
    const canvas = canvasRef.current
    const width = canvas?.clientWidth || containerRef.current?.clientWidth || 550
    const height = canvas?.clientHeight || containerRef.current?.clientHeight || 450
    if (!width || !height) return

    const allNodes = Array.from(simNodesRef.current.values())
    const target = computeFitTransform(allNodes, width, height, customZoom)

    if (smooth) {
      cameraAnimRef.current = {
        active: true,
        startTime: performance.now(),
        duration: 260,
        startPanX: transformRef.current.panX,
        startPanY: transformRef.current.panY,
        startZoom: transformRef.current.zoom,
        targetPanX: target.panX,
        targetPanY: target.panY,
        targetZoom: target.zoom,
      }
    } else {
      cameraAnimRef.current.active = false
      transformRef.current = target
    }
  }, [])

  // Skip Evolution Animation (instantly reveal all nodes)
  const skipEvolutionAnimation = useCallback(() => {
    const currentNodes = simNodesRef.current
    currentNodes.forEach((n) => {
      n.isVisible = true
      n.spawnProgress = 1
    })
    evolutionRef.current.active = false
    setIsEvolving(false)
    resetView(undefined, true)
    reheat(0.6)
  }, [resetView, reheat])

  // Start Evolution Growth Animation (Obsidian Time-lapse)
  const startEvolutionAnimation = useCallback(() => {
    const canvas = canvasRef.current
    const width = canvas?.clientWidth || 550
    const height = canvas?.clientHeight || 450
    const centerX = width / 2
    const centerY = height / 2

    const currentNodes = simNodesRef.current

    // 1. Medium-Shot Camera (中景展现: 主体圆点与文字清晰可读，约 0.92 ~ 0.98 舒适中景)
    const midShotZoom = 0.94

    cameraAnimRef.current.active = false
    // Set camera to medium-shot view centered precisely on the growth center
    transformRef.current = {
      zoom: midShotZoom,
      panX: width / 2 - centerX * midShotZoom,
      panY: height / 2 - centerY * midShotZoom,
    }

    const degreeMap = new Map<string, number>()
    edges.forEach((e) => {
      degreeMap.set(e.from, (degreeMap.get(e.from) || 0) + 1)
      degreeMap.set(e.to, (degreeMap.get(e.to) || 0) + 1)
    })

    const sequence = computeGrowthSequence(nodes, edges, degreeMap)
    const count = sequence.length
    // Slower, graceful pacing (approx 300ms - 650ms per node so users can clearly watch the evolution)
    const interval = Math.max(280, Math.min(650, 7200 / Math.max(count, 1)))
    const now = performance.now()

    sequence.forEach((item, index) => {
      const node = currentNodes.get(item.id)
      if (!node) return

      node.parentId = item.parentId
      node.spawnTime = now + index * interval
      node.spawnProgress = 0
      node.isVisible = index === 0

      if (index === 0) {
        node.x = centerX + (Math.random() - 0.5) * 10
        node.y = centerY + (Math.random() - 0.5) * 10
        node.vx = 0
        node.vy = 0
      } else if (item.parentId) {
        const parent = currentNodes.get(item.parentId)
        const angle = (Math.PI * 2 * (index % 6)) / 6 + (Math.random() - 0.5) * 0.4
        node.x = (parent?.x || centerX) + Math.cos(angle) * 15
        node.y = (parent?.y || centerY) + Math.sin(angle) * 15
        node.vx = Math.cos(angle) * 1.5
        node.vy = Math.sin(angle) * 1.5
      } else {
        const angle = (Math.PI * 2 * index) / count
        node.x = centerX + Math.cos(angle) * 120
        node.y = centerY + Math.sin(angle) * 120
        node.vx = 0
        node.vy = 0
      }
    })

    evolutionRef.current = {
      active: true,
      startTime: now,
      totalDuration: count * interval + 900,
      sequence,
    }

    setIsEvolving(true)
    setEvolutionProgress({ current: 1, total: count })
    reheat(0.85)
  }, [nodes, edges, reheat])

  // Sync incoming nodes/edges with simulation ref
  useEffect(() => {
    const currentNodes = simNodesRef.current
    const newMap = new Map<string, SimNode>()

    const width = containerRef.current?.clientWidth || canvasRef.current?.clientWidth || 550
    const height = containerRef.current?.clientHeight || canvasRef.current?.clientHeight || 450
    const centerX = width / 2
    const centerY = height / 2

    // Compute node degrees (connectivity)
    const degreeMap = new Map<string, number>()
    edges.forEach((e) => {
      degreeMap.set(e.from, (degreeMap.get(e.from) || 0) + 1)
      degreeMap.set(e.to, (degreeMap.get(e.to) || 0) + 1)
    })

    const initialRadius = Math.min(width, height) * 0.42

    nodes.forEach((node, idx) => {
      const existing = currentNodes.get(node.id)
      const degree = degreeMap.get(node.id) || 0
      // Obsidian-style delicate scale: leaf nodes are compact dots (3.2-4.5px), while major hubs scale up gracefully (9-14px)
      const radius = Math.min(14, Math.max(3.2, 2.6 + Math.sqrt(degree) * 1.5 + Math.log2((node.weight || 1) + 1) * 0.8))

      if (existing) {
        newMap.set(node.id, {
          ...existing,
          ...node,
          radius,
          degree,
          isVisible: existing.isVisible !== undefined ? existing.isVisible : true,
          spawnProgress: existing.spawnProgress !== undefined ? existing.spawnProgress : 1,
        })
      } else {
        const angle = (Math.PI * 2 * idx) / Math.max(nodes.length, 1) + (Math.random() - 0.5) * 0.3
        const dist = initialRadius * (0.35 + (idx % 6) * 0.14) + (Math.random() - 0.5) * 45
        newMap.set(node.id, {
          ...node,
          x: centerX + Math.cos(angle) * dist,
          y: centerY + Math.sin(angle) * dist,
          vx: 0,
          vy: 0,
          radius,
          degree,
          isVisible: true,
          spawnProgress: 1,
        })
      }
    })

    simNodesRef.current = newMap

    // Prepare edges
    simEdgesRef.current = edges.map((e) => ({
      ...e,
      particles: [],
    }))

    // Pre-warm the simulation for 60 ticks so nodes are already well distributed
    for (let k = 0; k < 60; k++) {
      runPhysicsStep(0.9 * (1 - k / 70), width, height)
    }

    // Synchronously calculate and apply optimal fit transform before first paint to prevent zoom flash
    const fitTransform = computeFitTransform(Array.from(newMap.values()), width, height)
    transformRef.current = fitTransform
    cameraAnimRef.current.active = false

    // Smooth subtle entrance fade-in (160ms) to make data switch look seamless
    fadeRef.current = {
      active: true,
      startTime: performance.now(),
      duration: 160,
    }

    reheat(0.8)
  }, [nodes, edges, reheat, runPhysicsStep])

  // Keep canvas responsive on container resize (e.g. sidebar toggle / dragging)
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let initialized = false
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          if (!initialized) {
            initialized = true
            resetView(undefined, false)
          }
        }
      }
    })

    resizeObserver.observe(container)
    return () => {
      resizeObserver.disconnect()
    }
  }, [resetView])

  // Main Animation Loop
  useEffect(() => {
    let animId: number

    const render = (_time: number) => {
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

      // --- 0. Camera Animation (Smooth Reset/Fit Transition) ---
      if (cameraAnimRef.current.active) {
        const { startTime, duration, startPanX, startPanY, startZoom, targetPanX, targetPanY, targetZoom } = cameraAnimRef.current
        const progress = Math.min(1, (_time - startTime) / duration)
        const ease = 1 - Math.pow(1 - progress, 3)
        transformRef.current = {
          panX: startPanX + (targetPanX - startPanX) * ease,
          panY: startPanY + (targetPanY - startPanY) * ease,
          zoom: startZoom + (targetZoom - startZoom) * ease,
        }
        if (progress >= 1) {
          cameraAnimRef.current.active = false
        }
      }

      // --- 0.1 Smooth Switch Fade-In ---
      let alphaMultiplier = 1
      if (fadeRef.current.active) {
        const p = Math.min(1, (_time - fadeRef.current.startTime) / fadeRef.current.duration)
        alphaMultiplier = Math.max(0, Math.min(1, p))
        if (p >= 1) {
          fadeRef.current.active = false
        }
      }
      ctx.globalAlpha = alphaMultiplier

      const nodeList = Array.from(simNodesRef.current.values())
      const edgeList = simEdgesRef.current
      const nodeMap = simNodesRef.current

      // --- 0.2 Evolution Animation Step ---
      if (evolutionRef.current.active) {
        const { sequence, startTime, totalDuration } = evolutionRef.current
        let allDone = true

        for (let i = 0; i < sequence.length; i++) {
          const item = sequence[i]
          const node = nodeMap.get(item.id)
          if (!node || node.spawnTime === undefined) continue

          if (_time >= node.spawnTime) {
            if (!node.isVisible) {
              node.isVisible = true
              alphaRef.current = Math.max(alphaRef.current, 0.45)
            }
            const elapsed = _time - node.spawnTime
            const spawnDuration = 600
            node.spawnProgress = Math.min(1, elapsed / spawnDuration)
            if (node.spawnProgress < 1) {
              allDone = false
            }
          } else {
            node.isVisible = false
            node.spawnProgress = 0
            allDone = false
          }
        }

        let visibleCount = 0
        nodeMap.forEach((n) => {
          if (n.isVisible) visibleCount++
        })

        setEvolutionProgress((prev) =>
          prev.current !== visibleCount ? { current: visibleCount, total: sequence.length } : prev
        )

        if (allDone && _time > startTime + totalDuration) {
          evolutionRef.current.active = false
          setIsEvolving(false)
        }
      }

      // --- 1. Physics Step ---
      const alpha = alphaRef.current
      if (!isPausedRef.current && alpha > 0.003) {
        runPhysicsStep(alpha, width, height)
        alphaRef.current *= 0.985
      }

      // --- 2. Canvas Rendering with Transform ---
      const { panX, panY, zoom } = transformRef.current
      ctx.save()
      ctx.translate(panX, panY)
      ctx.scale(zoom, zoom)

      const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

      // Subtle Minimal Grid Dots
      const gridSize = 48
      const startX = -panX / zoom - 50
      const startY = -panY / zoom - 50
      const endX = (width - panX) / zoom + 50
      const endY = (height - panY) / zoom + 50

      ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.04)' : 'rgba(100, 116, 139, 0.06)'
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

      // --- 2.1 Draw Edges (Pass 1: Clean background network with 3-tier visibility) ---
      edgeList.forEach((edge) => {
        const source = nodeMap.get(edge.from)
        const target = nodeMap.get(edge.to)
        if (!source || !target || source.isVisible === false || target.isVisible === false) return

        const pSource = source.spawnProgress ?? 1
        const pTarget = target.spawnProgress ?? 1
        const edgeProgress = Math.min(pSource, pTarget)

        const isHighlighted = highlightedEdgeIds.has(edge.id)
        const isDimmed = Boolean(targetFocusId && !isHighlighted)

        ctx.save()
        ctx.globalAlpha = Math.min(1, edgeProgress * 1.5)

        ctx.beginPath()
        ctx.moveTo(source.x, source.y)

        if (edgeProgress < 0.96) {
          // Dynamic progressive budding stroke from source to target
          const drawX = source.x + (target.x - source.x) * edgeProgress
          const drawY = source.y + (target.y - source.y) * edgeProgress
          ctx.lineTo(drawX, drawY)

          ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.92)' : 'rgba(2, 132, 199, 0.90)'
          ctx.lineWidth = 1.3
          ctx.stroke()

          // Sparkle tip on new edge
          ctx.beginPath()
          ctx.arc(drawX, drawY, 2.0, 0, Math.PI * 2)
          ctx.fillStyle = isDark ? '#38bdf8' : '#0284c7'
          ctx.fill()
        } else {
          ctx.lineTo(target.x, target.y)

          if (isHighlighted) {
            // Tier 1: Focus Highlighted Edge (Crisp 1.0px hairline)
            ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.95)' : 'rgba(2, 132, 199, 0.92)'
            ctx.lineWidth = 1.0
          } else if (isDimmed) {
            // Tier 3: Dimmed Background Edge (Faint secondary context)
            ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.10)'
            ctx.lineWidth = 0.5
          } else {
            // Tier 2: Default Edge (Soft, translucent gray network)
            ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(100, 116, 139, 0.28)'
            ctx.lineWidth = 0.75
          }
          ctx.stroke()
        }

        ctx.restore()
      })

      // Top Nodes for Level-of-Detail label density
      const topNodes = new Set(
        [...nodeList]
          .filter((n) => n.isVisible !== false)
          .sort((a, b) => (b.weight * 2 + b.degree) - (a.weight * 2 + a.degree))
          .slice(0, 18)
          .map((n) => n.id)
      )

      // --- 2.2 Draw Nodes & Typography (Pass 2: Clean solid colored discs on top of lines, pure Obsidian aesthetic) ---
      nodeList.forEach((node) => {
        if (node.isVisible === false) return

        const isSelected = selectedId === node.id
        const isHovered = activeHover?.id === node.id
        const isConnected = connectedNodeIds.has(node.id)
        const isDimmed = Boolean(targetFocusId && !isConnected)
        const isMajorNode = topNodes.has(node.id)

        const baseColor = nodeColors[node.type] || '#94a3b8'

        const p = node.spawnProgress !== undefined ? node.spawnProgress : 1
        const elasticScale = p >= 1 ? 1 : 0.15 + (0.85 + 0.4 * Math.sin(p * Math.PI)) * p
        const currentRadius = node.radius * elasticScale
        const nodeAlpha = Math.min(1, p * 1.5)

        ctx.save()
        ctx.translate(node.x, node.y)
        ctx.globalAlpha = nodeAlpha

        // 0. Spawn Ripple Wave effect when budding
        if (p < 0.95) {
          const rippleRadius = node.radius + (1 - p) * 16
          const rippleAlpha = (1 - p) * 0.7
          ctx.beginPath()
          ctx.arc(0, 0, rippleRadius, 0, Math.PI * 2)
          ctx.strokeStyle = `${baseColor}${Math.floor(rippleAlpha * 255).toString(16).padStart(2, '0')}`
          ctx.lineWidth = 1.3
          ctx.stroke()
        }

        // 1. External Focus / Hover Ring
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(0, 0, currentRadius + 2.6, 0, Math.PI * 2)
          ctx.strokeStyle = `${baseColor}dd`
          ctx.lineWidth = 1.3
          ctx.stroke()
        } else if (isHovered) {
          ctx.beginPath()
          ctx.arc(0, 0, currentRadius + 2.0, 0, Math.PI * 2)
          ctx.strokeStyle = `${baseColor}88`
          ctx.lineWidth = 1.1
          ctx.stroke()
        }

        // 2. Solid Pure Colored Disc (Clean solid circle covering line ends, zero center dot)
        ctx.beginPath()
        ctx.arc(0, 0, currentRadius, 0, Math.PI * 2)
        if (isDimmed) {
          ctx.fillStyle = isDark ? 'rgba(51, 65, 85, 0.25)' : 'rgba(203, 213, 225, 0.4)'
        } else {
          ctx.fillStyle = baseColor
        }
        ctx.fill()

        // 3. Obsidian Authentic Typography with Anti-Collision Text Halo
        const isHubNode = (node.degree || 0) >= 3 || (node.weight || 1) >= 2
        const shouldShowLabel =
          p > 0.5 &&
          (isHovered ||
            isSelected ||
            (targetFocusId && isConnected) ||
            (!targetFocusId &&
              (zoom >= 0.9 ||
                (zoom >= 0.62 && (isMajorNode || isHubNode)) ||
                (zoom >= 0.38 && isMajorNode))))

        if (shouldShowLabel) {
          const labelAlpha = Math.min(1, (p - 0.5) * 2)
          ctx.globalAlpha = nodeAlpha * labelAlpha

          const fontSize = isSelected ? 11.5 : isHovered ? 11 : isMajorNode ? 9.8 : 9
          const fontWeight = isSelected ? '700' : isHovered ? '600' : isMajorNode ? '550' : '450'
          ctx.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'

          const labelY = currentRadius + (isSelected || isHovered ? 4.5 : 3.8)
          const text = node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label

          // 3.1 Anti-Collision Text Halo (防止背后穿过的密集线段切碎文字笔画)
          ctx.lineJoin = 'round'
          ctx.miterLimit = 2
          if (isSelected || isHovered) {
            ctx.strokeStyle = isDark ? 'rgba(10, 15, 29, 0.95)' : 'rgba(255, 255, 255, 0.95)'
            ctx.lineWidth = 3.6
            ctx.strokeText(text, 0, labelY)
          } else {
            ctx.strokeStyle = isDark ? 'rgba(10, 15, 29, 0.75)' : 'rgba(255, 255, 255, 0.85)'
            ctx.lineWidth = 2.4
            ctx.strokeText(text, 0, labelY)
          }

          // 3.2 High-Contrast Text Fill (选中态为醒目主题蓝，悬浮态为曜石黑/纯白)
          if (isDark) {
            ctx.fillStyle = isSelected
              ? '#38bdf8' // 选中态：主题亮青蓝
              : isHovered
                ? '#ffffff' // 悬浮态：高亮纯白
                : isMajorNode
                  ? '#f1f5f9'
                  : !isDimmed
                    ? '#cbd5e1'
                    : 'rgba(148, 163, 184, 0.35)'
          } else {
            ctx.fillStyle = isSelected
              ? '#0284c7' // 选中态：主题宝蓝
              : isHovered
                ? '#090d16' // 悬浮态：深曜石黑
                : isMajorNode
                  ? '#1e293b'
                  : !isDimmed
                    ? '#334155'
                    : 'rgba(100, 116, 139, 0.4)'
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
          ctx.strokeStyle = '#10b981'
        } else {
          ctx.lineTo(cursor.worldX, cursor.worldY)
          ctx.strokeStyle = isDark ? '#38bdf8' : '#0284c7'
        }
        ctx.lineWidth = 2
        ctx.setLineDash([5, 4])
        ctx.stroke()
        ctx.setLineDash([])

        if (target) {
          ctx.beginPath()
          ctx.arc(target.x, target.y, target.radius + 6, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)'
          ctx.lineWidth = 2
          ctx.stroke()

          ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif'
          ctx.fillStyle = isDark ? '#34d399' : '#059669'
          ctx.textAlign = 'center'
          ctx.fillText(`松开建立关联: ${source.label} ↔ ${target.label}`, target.x, target.y - target.radius - 10)
        }
        ctx.restore()
      }

      // --- 4. Draw Merge Target Indicator (Drag over another node) ---
      if (dragRef.current.node && !dragRef.current.isLinking && mergeTargetNodeRef.current) {
        const source = dragRef.current.node
        const target = mergeTargetNodeRef.current

        ctx.save()
        ctx.beginPath()
        ctx.arc(target.x, target.y, target.radius + 7, 0, Math.PI * 2)
        ctx.strokeStyle = '#818cf8'
        ctx.lineWidth = 2
        ctx.stroke()

        ctx.font = '500 11px -apple-system, BlinkMacSystemFont, sans-serif'
        ctx.fillStyle = isDark ? '#a5b4fc' : '#4f46e5'
        ctx.textAlign = 'center'
        ctx.fillText(`松开合并实体: ${source.label} → ${target.label}`, target.x, target.y - target.radius - 10)
        ctx.restore()
      }

      ctx.restore() // Restore transform
      ctx.restore() // Restore dpr scale

      animId = requestAnimationFrame(render)
    }

    animId = requestAnimationFrame(render)

    return () => {
      cancelAnimationFrame(animId)
    }
  }, [runPhysicsStep, selectedElement, nodeColors])

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
      if (n.isVisible === false) continue
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
      if (!s || !t || s.isVisible === false || t.isVisible === false) continue
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
    cameraAnimRef.current.active = false
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
    cameraAnimRef.current.active = false
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
    cameraAnimRef.current.active = false
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
    cameraAnimRef.current.active = false
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
        className={`h-full w-full ${isLinkMode ? 'cursor-crosshair' : isMergeMode ? 'cursor-alias' : 'cursor-grab active:cursor-grabbing'
          }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Evolution Animation Status Indicator */}
      {isEvolving && (
        <div className="absolute top-2.5 right-3 flex items-center gap-2 rounded-full border border-sky-500/30 bg-cyber-bg-secondary/90 px-3 py-1 shadow-md backdrop-blur-md animate-in fade-in slide-in-from-top-1 z-10">
          <Wand2 className="h-3.5 w-3.5 text-sky-400 animate-spin" />
          <span className="text-[11px] font-medium text-cyber-text-primary">
            网络演化生长中 · {evolutionProgress.current} / {evolutionProgress.total}
          </span>
          <button
            onClick={skipEvolutionAnimation}
            className="text-[10px] text-sky-400 hover:text-sky-300 underline font-medium transition-colors ml-0.5 cursor-pointer"
          >
            跳过
          </button>
        </div>
      )}

      {/* Floating Control Toolbar (Obsidian style) */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/90 p-1 shadow-md backdrop-blur-md">
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 px-2 gap-1 text-xs transition-colors ${isMergeMode
            ? 'text-indigo-400 bg-indigo-500/15 border border-indigo-500/30 font-medium'
            : 'text-cyber-text-muted hover:text-indigo-300 hover:bg-indigo-500/10'
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
          className={`h-7 px-2 gap-1 text-xs transition-colors ${isLinkMode
            ? 'text-sky-400 bg-sky-500/15 border border-sky-500/30 font-medium'
            : 'text-cyber-text-muted hover:text-sky-300 hover:bg-sky-500/10'
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
          className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-secondary"
          onClick={handleZoomIn}
          title="放大 (滚轮向上)"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-secondary"
          onClick={handleZoomOut}
          title="缩小 (滚轮向下)"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-secondary"
          onClick={() => { resetView(undefined, true); reheat(0.8) }}
          title="居中适应画布"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 w-7 p-0 transition-all ${isEvolving
            ? 'text-sky-400 bg-sky-500/20 border border-sky-500/40'
            : 'text-cyber-text-muted hover:text-sky-300 hover:bg-cyber-bg-secondary'
            }`}
          onClick={isEvolving ? skipEvolutionAnimation : startEvolutionAnimation}
          title={isEvolving ? '点击跳过生长动画' : '演化生长回放 (Obsidian 延时生长动效)'}
        >
          <Wand2 className={`h-3.5 w-3.5 ${isEvolving ? 'animate-spin' : ''}`} />
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
      <div className="pointer-events-none absolute top-2.5 left-3 text-[11px] text-cyber-text-muted/80 flex items-center gap-2 bg-cyber-bg-primary/80 backdrop-blur-md px-2.5 py-1 rounded-md border border-cyber-border-subtle/60 shadow-xs">
        <span className="flex items-center gap-1"><Move className="h-3 w-3 text-sky-400" /> 拖拽探索节点</span>
        <span className="opacity-30">|</span>
        <span className="flex items-center gap-1"><Combine className="h-3 w-3 text-indigo-400" /> 按住 Alt 拖拽合并</span>
        <span className="opacity-30">|</span>
        <span className="flex items-center gap-1"><Link2 className="h-3 w-3 text-emerald-400" /> 按住 Shift 拖拽连线</span>
      </div>
    </div>
  )
}
