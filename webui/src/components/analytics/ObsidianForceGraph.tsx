import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  Combine,
  Link2,
  Move,
  RotateCcw,
  Wand2,
  ZoomIn,
  ZoomOut,
  Search,
  Layers,
  X,
} from 'lucide-react'
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

export interface SimNode extends GraphNode {
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

export interface SimEdge extends Edge {
  particles: SimParticle[]
}

const GRAPH_RELATION_LABELS: Record<string, string> = {
  published_on: '发布于',
  matched_keyword: '命中词',
  co_occurs: '共现关联',
  mentions_topic: '提及主题',
  competes_with: '竞品对手',
  belongs_to: '归属组织',
  produces: '生产研发',
  endorses: '核心主打',
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

  const [isLinkMode, setIsLinkMode] = useState(false)
  const isLinkModeRef = useRef(false)
  isLinkModeRef.current = isLinkMode

  const [isMergeMode, setIsMergeMode] = useState(false)
  const isMergeModeRef = useRef(false)
  isMergeModeRef.current = isMergeMode

  // Subgraph Hop Depth: 1 = 1-hop focus, 2 = 2-hop spread, 0 = global topology
  const [hopDepth, setHopDepth] = useState<1 | 2 | 0>(1)
  const hopDepthRef = useRef<1 | 2 | 0>(1)
  hopDepthRef.current = hopDepth

  // Hover states for rich tooltips
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null)
  const hoveredNodeRef = useRef<SimNode | null>(null)
  hoveredNodeRef.current = hoveredNode

  const [hoveredEdge, setHoveredEdge] = useState<SimEdge | null>(null)
  const hoveredEdgeRef = useRef<SimEdge | null>(null)
  hoveredEdgeRef.current = hoveredEdge

  // Search feature state
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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
      if (!source || !target || source.isVisible === false || target.isVisible === false) continue

      const dx = target.x - source.x
      const dy = target.y - source.y
      const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1)

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

  // Center/Reset View
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

  // Focus Smoothly on Specific Node
  const focusOnNode = useCallback((node: SimNode) => {
    const canvas = canvasRef.current
    const width = canvas?.clientWidth || 550
    const height = canvas?.clientHeight || 450
    const targetZoom = 1.35

    cameraAnimRef.current = {
      active: true,
      startTime: performance.now(),
      duration: 350,
      startPanX: transformRef.current.panX,
      startPanY: transformRef.current.panY,
      startZoom: transformRef.current.zoom,
      targetPanX: width / 2 - node.x * targetZoom,
      targetPanY: height / 2 - node.y * targetZoom,
      targetZoom: targetZoom,
    }
    onSelectElement(node)
    setIsSearchOpen(false)
  }, [onSelectElement])

  // Skip Evolution Animation
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

  // Start Evolution Growth Animation
  const startEvolutionAnimation = useCallback(() => {
    const canvas = canvasRef.current
    const width = canvas?.clientWidth || 550
    const height = canvas?.clientHeight || 450
    const centerX = width / 2
    const centerY = height / 2

    const currentNodes = simNodesRef.current
    const midShotZoom = 0.94

    cameraAnimRef.current.active = false
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

    // Pre-warm the simulation for 60 ticks
    for (let k = 0; k < 60; k++) {
      runPhysicsStep(0.9 * (1 - k / 70), width, height)
    }

    const fitTransform = computeFitTransform(Array.from(newMap.values()), width, height)
    transformRef.current = fitTransform
    cameraAnimRef.current.active = false

    fadeRef.current = {
      active: true,
      startTime: performance.now(),
      duration: 160,
    }

    reheat(0.8)
  }, [nodes, edges, reheat, runPhysicsStep])

  // Keep canvas responsive on resize
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

  // Main Canvas Animation Loop
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

      // --- 0. Camera Animation ---
      if (cameraAnimRef.current.active) {
        const { startTime, duration, startPanX, startPanY, startZoom, targetPanX, targetPanY, targetZoom } =
          cameraAnimRef.current
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
      if (alpha > 0.003) {
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
      const activeHoverEdge = hoveredEdgeRef.current
      const selectedNodeId = selectedElement && 'label' in selectedElement ? selectedElement.id : null
      const selectedEdgeId = selectedElement && 'from' in selectedElement ? selectedElement.id : null
      const currentHop = hopDepthRef.current

      // Build 1-hop and 2-hop neighbor adjacency
      const neighbor1HopMap = new Map<string, Set<string>>()
      edgeList.forEach((e) => {
        if (!neighbor1HopMap.has(e.from)) neighbor1HopMap.set(e.from, new Set())
        if (!neighbor1HopMap.has(e.to)) neighbor1HopMap.set(e.to, new Set())
        neighbor1HopMap.get(e.from)!.add(e.to)
        neighbor1HopMap.get(e.to)!.add(e.from)
      })

      const focusNodeIds = new Set<string>()
      const highlightedEdgeIds = new Set<string>()

      // 1. Process Selected Element (Always keep selected element in focus)
      if (selectedNodeId) {
        focusNodeIds.add(selectedNodeId)
        const oneHop = neighbor1HopMap.get(selectedNodeId) || new Set()
        oneHop.forEach((id) => focusNodeIds.add(id))

        if (currentHop === 2) {
          oneHop.forEach((nbrId) => {
            const twoHop = neighbor1HopMap.get(nbrId) || new Set()
            twoHop.forEach((id) => focusNodeIds.add(id))
          })
        }

        edgeList.forEach((e) => {
          if (currentHop === 1) {
            if (e.from === selectedNodeId || e.to === selectedNodeId) {
              highlightedEdgeIds.add(e.id)
            }
          } else if (currentHop === 2) {
            if (focusNodeIds.has(e.from) && focusNodeIds.has(e.to)) {
              highlightedEdgeIds.add(e.id)
            }
          } else if (currentHop === 0) {
            highlightedEdgeIds.add(e.id)
          }
        })
      } else if (selectedEdgeId) {
        const targetEdge = edgeList.find((e) => e.id === selectedEdgeId)
        if (targetEdge) {
          focusNodeIds.add(targetEdge.from)
          focusNodeIds.add(targetEdge.to)
          highlightedEdgeIds.add(targetEdge.id)
        }
      }

      // 2. Process Hovered Element (Add to focus so preview is seamless without clearing selected nodes)
      if (activeHover) {
        focusNodeIds.add(activeHover.id)
        const oneHop = neighbor1HopMap.get(activeHover.id) || new Set()
        oneHop.forEach((id) => focusNodeIds.add(id))

        edgeList.forEach((e) => {
          if (e.from === activeHover.id || e.to === activeHover.id) {
            highlightedEdgeIds.add(e.id)
          }
        })
      } else if (activeHoverEdge) {
        focusNodeIds.add(activeHoverEdge.from)
        focusNodeIds.add(activeHoverEdge.to)
        highlightedEdgeIds.add(activeHoverEdge.id)
      }

      const hasActiveFocus = focusNodeIds.size > 0

      // Detect bidirectional / multi-edges for Bezier curve offset
      const pairCountMap = new Map<string, number>()
      edgeList.forEach((e) => {
        const key = [e.from, e.to].sort().join(':::')
        pairCountMap.set(key, (pairCountMap.get(key) || 0) + 1)
      })

      // --- 2.1 Draw Edges (Pass 1: Clean network with curved bidirectional & directional arrows) ---
      edgeList.forEach((edge) => {
        const source = nodeMap.get(edge.from)
        const target = nodeMap.get(edge.to)
        if (!source || !target || source.isVisible === false || target.isVisible === false) return

        const pSource = source.spawnProgress ?? 1
        const pTarget = target.spawnProgress ?? 1
        const edgeProgress = Math.min(pSource, pTarget)

        const isHoveredSpecificEdge = activeHoverEdge?.id === edge.id
        const isHighlighted = highlightedEdgeIds.has(edge.id)
        const isDimmed = Boolean(hasActiveFocus && !isHighlighted)

        // Compute Bezier midpoint if multi/bidirectional edge
        const pairKey = [edge.from, edge.to].sort().join(':::')
        const isMulti = (pairCountMap.get(pairKey) || 0) > 1

        let midX = (source.x + target.x) / 2
        let midY = (source.y + target.y) / 2
        let isCurved = false

        if (isMulti) {
          const dx = target.x - source.x
          const dy = target.y - source.y
          const dist = Math.hypot(dx, dy)
          if (dist > 1) {
            const nx = -dy / dist
            const ny = dx / dist
            const curveOffset = edge.from < edge.to ? 20 : -20
            midX += nx * curveOffset
            midY += ny * curveOffset
            isCurved = true
          }
        }

        ctx.save()
        ctx.globalAlpha = Math.min(1, edgeProgress * 1.5)

        ctx.beginPath()
        ctx.moveTo(source.x, source.y)

        if (edgeProgress < 0.96) {
          const drawX = source.x + (target.x - source.x) * edgeProgress
          const drawY = source.y + (target.y - source.y) * edgeProgress
          ctx.lineTo(drawX, drawY)

          ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.92)' : 'rgba(2, 132, 199, 0.90)'
          ctx.lineWidth = 1.0
          ctx.stroke()
        } else {
          if (isCurved) {
            ctx.quadraticCurveTo(midX, midY, target.x, target.y)
          } else {
            ctx.lineTo(target.x, target.y)
          }

          if (isHighlighted) {
            ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.95)' : 'rgba(2, 132, 199, 0.92)'
            ctx.lineWidth = 1.2
          } else if (isDimmed) {
            ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(100, 116, 139, 0.08)'
            ctx.lineWidth = 0.5
          } else {
            ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.25)' : 'rgba(100, 116, 139, 0.28)'
            ctx.lineWidth = 0.75
          }
          ctx.stroke()

          // Draw directional arrow & predicate label when highlighted
          if (isHighlighted && edgeProgress >= 0.96) {
            const tangentAngle = isCurved
              ? Math.atan2(target.y - midY, target.x - midX)
              : Math.atan2(target.y - source.y, target.x - source.x)

            const tipDist = target.radius + 3.0
            const tipX = target.x - Math.cos(tangentAngle) * tipDist
            const tipY = target.y - Math.sin(tangentAngle) * tipDist

            const arrowLen = 5.0
            const arrowWidth = 2.8
            const leftX = tipX - Math.cos(tangentAngle) * arrowLen + Math.sin(tangentAngle) * arrowWidth
            const leftY = tipY - Math.sin(tangentAngle) * arrowLen - Math.cos(tangentAngle) * arrowWidth
            const rightX = tipX - Math.cos(tangentAngle) * arrowLen - Math.sin(tangentAngle) * arrowWidth
            const rightY = tipY - Math.sin(tangentAngle) * arrowLen + Math.cos(tangentAngle) * arrowWidth

            ctx.beginPath()
            ctx.moveTo(tipX, tipY)
            ctx.lineTo(leftX, leftY)
            ctx.lineTo(rightX, rightY)
            ctx.closePath()
            ctx.fillStyle = isDark ? '#38bdf8' : '#0284c7'
            ctx.fill()

            // Draw predicate pill badge ONLY for:
            // 1. Actively hovered edge
            // 2. Or directly clicked/selected edge
            // 3. Or when the active subgraph is very small (<= 2 edges)
            const shouldShowPredicateBadge =
              isHoveredSpecificEdge ||
              selectedEdgeId === edge.id ||
              (highlightedEdgeIds.size <= 2 && highlightedEdgeIds.has(edge.id))

            if (shouldShowPredicateBadge) {
              const badgeX = isCurved
                ? 0.25 * source.x + 0.5 * midX + 0.25 * target.x
                : (source.x + target.x) / 2
              const badgeY = isCurved
                ? 0.25 * source.y + 0.5 * midY + 0.25 * target.y
                : (source.y + target.y) / 2

              const relName = GRAPH_RELATION_LABELS[edge.relation] || edge.relation || '关联'
              ctx.font = '550 9.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
              const textMetrics = ctx.measureText(relName)
              const textW = textMetrics.width
              const pillW = textW + 10
              const pillH = 15
              const pillX = badgeX - pillW / 2
              const pillY = badgeY - pillH / 2

              ctx.beginPath()
              ctx.roundRect(pillX, pillY, pillW, pillH, 4)
              ctx.fillStyle = isDark ? 'rgba(15, 23, 42, 0.94)' : 'rgba(255, 255, 255, 0.95)'
              ctx.fill()
              ctx.strokeStyle = isDark ? 'rgba(56, 189, 248, 0.5)' : 'rgba(2, 132, 199, 0.4)'
              ctx.lineWidth = 1.0
              ctx.stroke()

              ctx.fillStyle = isDark ? '#38bdf8' : '#0284c7'
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(relName, badgeX, badgeY)
            }
          }
        }

        ctx.restore()
      })

      // Top Core Nodes for LOD (Adaptive top 12%, min 4, max 16)
      const allVisibleNodes = nodeList.filter((n) => n.isVisible !== false)
      const hubNodeIds = new Set(
        [...allVisibleNodes]
          .sort((a, b) => b.degree * 2.5 + (b.weight || 1) - (a.degree * 2.5 + (a.weight || 1)))
          .slice(0, Math.min(16, Math.max(4, Math.ceil(allVisibleNodes.length * 0.12))))
          .map((n) => n.id)
      )

      // --- 2.2 Draw Nodes & Typography (Pass 2: Clean solid discs with LOD typography) ---
      nodeList.forEach((node) => {
        if (node.isVisible === false) return

        const isSelectedNode = selectedNodeId === node.id
        const selectedEdgeObj = selectedEdgeId ? edgeList.find((e) => e.id === selectedEdgeId) : null
        const isSelectedEdgeEndpoint = Boolean(
          selectedEdgeObj && (selectedEdgeObj.from === node.id || selectedEdgeObj.to === node.id)
        )
        const isHovered = activeHover?.id === node.id
        const isInFocus = focusNodeIds.has(node.id)
        const isDimmed = Boolean(hasActiveFocus && !isInFocus)
        const isMajorHub = hubNodeIds.has(node.id)

        const baseColor = nodeColors[node.type] || '#94a3b8'

        const p = node.spawnProgress !== undefined ? node.spawnProgress : 1
        const elasticScale = p >= 1 ? 1 : 0.15 + (0.85 + 0.4 * Math.sin(p * Math.PI)) * p
        const currentRadius = node.radius * elasticScale
        const nodeAlpha = Math.min(1, p * 1.5)

        ctx.save()
        ctx.translate(node.x, node.y)
        ctx.globalAlpha = isDimmed ? nodeAlpha * 0.18 : nodeAlpha

        // Focus / Selection Outer Glow Ring
        if (isSelectedNode || isSelectedEdgeEndpoint) {
          ctx.beginPath()
          ctx.arc(0, 0, currentRadius + 3.5, 0, Math.PI * 2)
          ctx.strokeStyle = isDark ? '#38bdf8' : '#0284c7'
          ctx.lineWidth = 1.8
          ctx.stroke()
        } else if (isHovered) {
          ctx.beginPath()
          ctx.arc(0, 0, currentRadius + 2.5, 0, Math.PI * 2)
          ctx.strokeStyle = `${baseColor}cc`
          ctx.lineWidth = 1.4
          ctx.stroke()
        }

        // Solid Pure Colored Disc
        ctx.beginPath()
        ctx.arc(0, 0, currentRadius, 0, Math.PI * 2)
        if (isDimmed) {
          ctx.fillStyle = isDark ? 'rgba(51, 65, 85, 0.3)' : 'rgba(203, 213, 225, 0.4)'
        } else {
          ctx.fillStyle = baseColor
        }
        ctx.fill()

        // --- Node LOD Typography Strategy ---
        let shouldShowLabel = false
        if (p > 0.4) {
          if (hasActiveFocus) {
            shouldShowLabel = isInFocus
          } else {
            if (isMajorHub && zoom >= 0.35) {
              shouldShowLabel = true
            } else if (zoom >= 1.15 && (node.degree >= 2 || (node.weight || 1) >= 2)) {
              shouldShowLabel = true
            } else if (zoom >= 1.6) {
              shouldShowLabel = true
            }
          }
        }

        if (shouldShowLabel) {
          const labelAlpha = Math.min(1, (p - 0.4) * 2)
          ctx.globalAlpha = (isDimmed ? 0.2 : 1) * labelAlpha

          const fontSize = isSelectedNode || isSelectedEdgeEndpoint ? 11.5 : isHovered ? 11 : isMajorHub ? 10 : 9.2
          const fontWeight = isSelectedNode || isSelectedEdgeEndpoint ? '700' : isHovered ? '600' : isMajorHub ? '600' : '450'
          ctx.font = `${fontWeight} ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'

          const labelY = currentRadius + (isSelectedNode || isSelectedEdgeEndpoint || isHovered ? 4.5 : 3.8)
          const text = node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label

          // Anti-Collision Text Halo
          ctx.lineJoin = 'round'
          ctx.miterLimit = 2
          ctx.strokeStyle = isDark ? 'rgba(10, 15, 29, 0.95)' : 'rgba(255, 255, 255, 0.95)'
          ctx.lineWidth = isSelectedNode || isSelectedEdgeEndpoint || isHovered ? 3.6 : 2.5
          ctx.strokeText(text, 0, labelY)

          // High-Contrast Text Fill
          if (isDark) {
            ctx.fillStyle = isSelectedNode || isSelectedEdgeEndpoint
              ? '#38bdf8'
              : isHovered
              ? '#ffffff'
              : isMajorHub
              ? '#f1f5f9'
              : '#cbd5e1'
          } else {
            ctx.fillStyle = isSelectedNode || isSelectedEdgeEndpoint
              ? '#0284c7'
              : isHovered
              ? '#090d16'
              : isMajorHub
              ? '#1e293b'
              : '#334155'
          }

          ctx.fillText(text, 0, labelY)
        }

        ctx.restore()
      })

      // --- 3. Draw Link in Progress ---
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

      // --- 4. Draw Merge Target Indicator ---
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

      ctx.restore()
      ctx.restore()

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
    const nodesList = Array.from(simNodesRef.current.values())
    for (let i = nodesList.length - 1; i >= 0; i--) {
      const n = nodesList[i]
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

  const findEdgeAt = (worldX: number, worldY: number, maxDist = 12): SimEdge | null => {
    const edgesList = simEdgesRef.current
    const nodeMap = simNodesRef.current
    for (const edge of edgesList) {
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

      const target = findNodeAt(worldX, worldY, drag.node.id, 32)
      if (target && target.type === drag.node.type && drag.node.type !== 'platform') {
        target.vx = 0
        target.vy = 0
        mergeTargetNodeRef.current = target
      } else {
        mergeTargetNodeRef.current = null
      }
    } else if (drag.node) {
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
      const hoveredN = findNodeAt(worldX, worldY, undefined, 14)
      setHoveredNode(hoveredN)
      if (!hoveredN) {
        const hoveredE = findEdgeAt(worldX, worldY, 12)
        if (hoveredE) {
          const selectedId = selectedElement && 'id' in selectedElement ? selectedElement.id : null
          if (selectedId) {
            // When a node is selected, only allow hovering edges connected to it
            const isRelevant = hoveredE.from === selectedId || hoveredE.to === selectedId
            setHoveredEdge(isRelevant ? hoveredE : null)
          } else {
            setHoveredEdge(hoveredE)
          }
        } else {
          setHoveredEdge(null)
        }
      } else {
        setHoveredEdge(null)
      }
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
      if (drag.node) {
        onSelectElement(drag.node)
      } else {
        const clickedNode = findNodeAt(worldX, worldY, undefined, 20)
        if (clickedNode) {
          onSelectElement(clickedNode)
        } else if (distMoved < 8) {
          const clickedEdge = findEdgeAt(worldX, worldY, 12)
          if (clickedEdge) {
            onSelectElement(clickedEdge)
          } else {
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

  // Filter nodes for the search popup
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const query = searchQuery.toLowerCase().trim()
    const all = Array.from(simNodesRef.current.values()).filter((n) => n.isVisible !== false)
    return all
      .filter((n) => n.label.toLowerCase().includes(query))
      .sort((a, b) => b.degree * 2 + (b.weight || 1) - (a.degree * 2 + (a.weight || 1)))
      .slice(0, 8)
  }, [searchQuery])

  const selectedNode = selectedElement && 'label' in selectedElement ? (selectedElement as GraphNode) : null

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full min-h-[360px] overflow-hidden rounded-xl border border-cyber-border-subtle bg-cyber-bg-primary/70 select-none group"
    >
      <canvas
        ref={canvasRef}
        className={`h-full w-full ${
          isLinkMode ? 'cursor-crosshair' : isMergeMode ? 'cursor-alias' : 'cursor-grab active:cursor-grabbing'
        }`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => {
          setHoveredNode(null)
          setHoveredEdge(null)
        }}
        onWheel={handleWheel}
      />

      {/* Subgraph Hop Depth Controller (When a node is selected) */}
      {selectedNode && (
        <div className="absolute top-2.5 right-3 flex items-center gap-1 rounded-lg border border-sky-500/30 bg-cyber-bg-secondary/95 px-2 py-1 shadow-md backdrop-blur-md z-10 animate-in fade-in slide-in-from-top-1">
          <Layers className="h-3.5 w-3.5 text-sky-400 mr-1" />
          <span className="text-[10.5px] text-cyber-text-muted mr-1">子图聚焦:</span>
          <button
            onClick={() => setHopDepth(1)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer ${
              hopDepth === 1
                ? 'bg-sky-500 text-white shadow-xs'
                : 'text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-primary/60'
            }`}
            title="仅聚焦显示选中实体直接相连的 1 跳邻居"
          >
            1跳
          </button>
          <button
            onClick={() => setHopDepth(2)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer ${
              hopDepth === 2
                ? 'bg-sky-500 text-white shadow-xs'
                : 'text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-primary/60'
            }`}
            title="扩散展示选中实体的 2 跳扩展关系网络"
          >
            2跳
          </button>
          <button
            onClick={() => setHopDepth(0)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-all cursor-pointer ${
              hopDepth === 0
                ? 'bg-sky-500 text-white shadow-xs'
                : 'text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-primary/60'
            }`}
            title="查看完整图谱全景"
          >
            全图
          </button>
        </div>
      )}

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

      {/* Floating Control Toolbar */}
      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/90 p-1 shadow-md backdrop-blur-md z-10">
        {/* Quick Search Trigger */}
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 w-7 p-0 transition-colors ${
            isSearchOpen ? 'text-sky-400 bg-sky-500/15' : 'text-cyber-text-muted hover:text-cyber-text-primary'
          }`}
          onClick={() => setIsSearchOpen((prev) => !prev)}
          title="搜索图谱实体"
        >
          <Search className="h-3.5 w-3.5" />
        </Button>
        <div className="h-4 w-px bg-cyber-border-subtle mx-0.5" />
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 px-2 gap-1 text-xs transition-colors ${
            isMergeMode
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
          className={`h-7 px-2 gap-1 text-xs transition-colors ${
            isLinkMode
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
          onClick={() => {
            resetView(undefined, true)
            reheat(0.8)
          }}
          title="居中适应画布"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={`h-7 w-7 p-0 transition-all ${
            isEvolving
              ? 'text-sky-400 bg-sky-500/20 border border-sky-500/40'
              : 'text-cyber-text-muted hover:text-sky-300 hover:bg-cyber-bg-secondary'
          }`}
          onClick={isEvolving ? skipEvolutionAnimation : startEvolutionAnimation}
          title={isEvolving ? '点击跳过生长动画' : '演化生长回放 (Obsidian 延时生长动效)'}
        >
          <Wand2 className={`h-3.5 w-3.5 ${isEvolving ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Quick Search Popover */}
      {isSearchOpen && (
        <div className="absolute bottom-12 right-3 w-72 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/95 p-2.5 shadow-2xl backdrop-blur-xl z-20 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center gap-1.5 border-b border-cyber-border-subtle/80 pb-2">
            <Search className="h-3.5 w-3.5 text-cyber-text-muted ml-1" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索实体节点名称..."
              className="flex-1 bg-transparent text-xs text-cyber-text-primary outline-none placeholder:text-cyber-text-muted/60"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="text-cyber-text-muted hover:text-cyber-text-primary p-0.5"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="mt-1.5 max-h-48 overflow-y-auto space-y-1">
            {searchResults.length > 0 ? (
              searchResults.map((node) => (
                <button
                  key={node.id}
                  onClick={() => focusOnNode(node)}
                  className="flex items-center justify-between w-full rounded-md px-2 py-1.5 text-left text-xs hover:bg-cyber-bg-primary/80 transition-colors group/item cursor-pointer"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: nodeColors[node.type] || '#94a3b8' }}
                    />
                    <span className="text-cyber-text-primary font-medium truncate">{node.label}</span>
                  </div>
                  <span className="text-[10px] text-cyber-text-muted font-mono shrink-0 ml-2">
                    {node.degree} 连接
                  </span>
                </button>
              ))
            ) : searchQuery.trim() ? (
              <div className="p-3 text-center text-xs text-cyber-text-muted">未找到匹配的实体</div>
            ) : (
              <div className="p-2 text-center text-[11px] text-cyber-text-muted/70">
                输入实体关键词快速对焦与查看关联
              </div>
            )}
          </div>
        </div>
      )}

      {/* Sleek Single-Line Status / Hint Bar (Unobstructed Canvas) */}
      <div className="pointer-events-none absolute top-2.5 left-3 text-[11px] text-cyber-text-muted/85 flex items-center gap-2 bg-cyber-bg-primary/85 backdrop-blur-md px-3 py-1.5 rounded-lg border border-cyber-border-subtle/70 shadow-xs z-10 transition-all">
        {hoveredNode ? (
          <div className="flex items-center gap-2 animate-in fade-in">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{ background: nodeColors[hoveredNode.type] || '#94a3b8' }}
            />
            <span className="font-semibold text-cyber-text-primary">{hoveredNode.label}</span>
            <span className="opacity-30">|</span>
            <span
              className="text-[10px] px-1 py-0.2 rounded font-medium"
              style={{
                backgroundColor: `${nodeColors[hoveredNode.type] || '#94a3b8'}20`,
                color: nodeColors[hoveredNode.type] || '#94a3b8',
              }}
            >
              {{ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }[hoveredNode.type] ||
                hoveredNode.type}
            </span>
            <span className="opacity-30">|</span>
            <span className="text-cyber-text-secondary font-mono text-[10.5px]">
              {hoveredNode.degree || 0} 连接 · {hoveredNode.weight || 0} 证据
            </span>
          </div>
        ) : hoveredEdge ? (
          <div className="flex items-center gap-1.5 animate-in fade-in text-xs">
            <span className="font-medium text-cyber-text-primary">
              {simNodesRef.current.get(hoveredEdge.from)?.label || hoveredEdge.from}
            </span>
            <span className="text-sky-400 font-semibold text-[10.5px] px-1 bg-sky-500/10 rounded">
              {GRAPH_RELATION_LABELS[hoveredEdge.relation] || hoveredEdge.relation}
            </span>
            <span className="font-medium text-cyber-text-primary">
              {simNodesRef.current.get(hoveredEdge.to)?.label || hoveredEdge.to}
            </span>
            <span className="opacity-30">|</span>
            <span className="text-cyber-text-muted font-mono text-[10.5px]">
              {hoveredEdge.weight || 1} 篇证据
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-cyber-text-muted/75">
            <span className="flex items-center gap-1">
              <Move className="h-3 w-3 text-sky-400" /> 拖拽探索
            </span>
            <span className="opacity-30">|</span>
            <span className="flex items-center gap-1">
              <Combine className="h-3 w-3 text-indigo-400" /> Alt 拖拽合并
            </span>
            <span className="opacity-30">|</span>
            <span className="flex items-center gap-1">
              <Link2 className="h-3 w-3 text-emerald-400" /> Shift 拖拽连线
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
