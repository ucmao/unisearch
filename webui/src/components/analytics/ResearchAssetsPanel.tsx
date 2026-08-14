import { useQuery } from '@tanstack/react-query'
import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Combine,
  Download,
  ExternalLink,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  Filter,
  GitCompare,
  HelpCircle,
  History as HistoryIcon,
  Info,
  Link2,
  Network,
  RefreshCw,
  Shield,
  ShieldAlert,
  Sparkles,
  Split,
  Trash2,
  Undo2,
  X,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ObsidianForceGraph } from './ObsidianForceGraph'
import { usePlatformLabels, platformLabel } from '@/hooks/usePlatformCatalog'

const REPORT_FORMAT_OPTIONS = [
  {
    category: '正式文档与汇报',
    items: [
      { format: 'pdf', label: 'PDF 报告', ext: '.pdf', hint: '排版固定 · 正式归档/汇报', icon: FileText, highlight: true },
      { format: 'docx', label: 'Word 文档', ext: '.docx', hint: '可二次编辑 · 协同修订', icon: FileSpreadsheet, highlight: false },
      { format: 'html', label: 'HTML 网页', ext: '.html', hint: '单文件离线 · 浏览器即开', icon: FileCode, highlight: false },
    ],
  },
  {
    category: '数据与知识库',
    items: [
      { format: 'markdown', label: 'Markdown', ext: '.md', hint: 'Notion / Obsidian 笔记', icon: FileText, highlight: false },
      { format: 'json', label: 'JSON 数据', ext: '.json', hint: '结构化快照 · 溯源对接', icon: FileJson, highlight: false },
    ],
  },
] as const

export function ReportDownloadDropdown({ artifactId }: { artifactId: string }) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="relative inline-block" ref={menuRef}>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((prev) => !prev)}
        className="h-7 gap-1.5 px-2.5 text-[11px] border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/20 hover:border-cyber-neon-cyan/60 transition-colors"
      >
        <Download className="h-3 w-3" />
        <span>导出报告</span>
        <ChevronDown className={`h-3 w-3 opacity-70 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </Button>

      {open && (
        <div className="absolute left-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-cyber-border-subtle bg-cyber-bg-primary/95 p-1.5 shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95">
          {REPORT_FORMAT_OPTIONS.map((group, gIdx) => (
            <div key={group.category} className={gIdx > 0 ? 'mt-1.5 border-t border-cyber-border-subtle/60 pt-1.5' : ''}>
              <div className="px-2 py-0.5 text-[9px] font-semibold tracking-wider text-cyber-text-muted/70 uppercase">
                {group.category}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {group.items.map((item) => (
                  <a
                    key={item.format}
                    href={`/api/reports/${artifactId}/download?format=${item.format}`}
                    download
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-cyber-text-primary hover:bg-cyber-neon-cyan/10 hover:text-cyber-neon-cyan transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <item.icon className="h-3.5 w-3.5 shrink-0 text-cyber-text-muted group-hover:text-cyber-neon-cyan" />
                      <div className="min-w-0">
                        <span className="font-medium text-cyber-text-primary group-hover:text-cyber-neon-cyan">{item.label}</span>
                        <span className="ml-1.5 text-[10px] text-cyber-text-muted">{item.hint}</span>
                      </div>
                    </div>
                    {item.highlight && (
                      <span className="shrink-0 rounded bg-cyber-neon-cyan/20 px-1 py-0.5 text-[9px] text-cyber-neon-cyan font-medium">
                        推荐
                      </span>
                    )}
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export type GraphNode = { id: string; type: string; label: string; weight: number; documentIds: string[] }
export type Edge = { id: string; from: string; to: string; relation: string; weight: number }
export type Graph = {
  id: string
  documentCount: number
  snapshotDocumentCount?: number
  currentDocumentCount?: number
  isOutdated?: boolean
  newDocumentCount?: number
  createdAt: string
  nodes: GraphNode[]
  edges: Edge[]
}
export type Report = { artifactId: string; workflowId?: string; title: string; createdAt: string; documentIds: string[]; graphId: string; seriesId: string; versionNumber: number; previousArtifactId?: string }
export type ReportComparison = { from: { versionNumber: number }; to: { versionNumber: number }; documents: { added: string[]; removed: string[]; updated: string[]; unchanged: number }; citations: { added: string[]; removed: string[] }; sections: { added: string[]; removed: string[]; changed: string[] }; contentChanged: boolean }
export type RelevanceAssessment = { assessmentId: string; phase: 'initial' | 'rewrite'; provider: string; query: string; resultCount: number; precisionAt10: number; status: 'good' | 'weak' | 'empty'; rewrittenQuery?: string }
export type Health = { connectorId: string; state: string; successRate: number; yieldRate: number; fieldCoverage: number; lastErrorMessage?: string }
export type Quality = { status: 'ready' | 'limited' | 'insufficient'; documentCount: number; qualifiedCount: number; warnings: string[]; metrics: { textCoverage: number; urlCoverage: number; commentCoverage: number } }
export type EntityRule = { ruleId: string; nodeType: string; operation: 'merge' | 'split' | 'ignore' | 'link'; sourceLabels: string[]; targetLabel: string; documentIds: string[]; createdAt: string }

const stateLabel: Record<string, string> = { healthy: '正常', degraded: '降级', blocked: '需处理验证', broken: '疑似结构变化', unknown: '暂无结论' }
const stateColor: Record<string, string> = { healthy: 'text-emerald-400', degraded: 'text-amber-400', blocked: 'text-orange-400', broken: 'text-rose-400', unknown: 'text-cyber-text-muted' }
const nodeColor: Record<string, string> = { subject: '#22d3ee', keyword: '#a78bfa', platform: '#34d399', topic: '#fb923c' }

const RELATION_LABELS: Record<string, string> = {
  competitor: '竞品对抗',
  partner: '业务合作',
  mentions: '关联提及',
  subtopic: '上下级/子话题',
  related: '相关衍生',
  endorses: '核心主打',
  mentions_topic: '提及话题',
  published_on: '来源归属',
  matched_keyword: '关键词匹配',
  co_occurs: '通用关联',
}

function getRelationOptions(sourceType: string, targetType: string) {
  if (sourceType === 'subject' && targetType === 'subject') {
    return [
      { id: 'competitor', label: '竞品对抗', desc: '两主体在业务或市场上构成直接/间接竞争' },
      { id: 'partner', label: '业务合作', desc: '两主体存在战略协同、投资或供应链合作' },
      { id: 'mentions', label: '关联提及', desc: '两主体在同一语境下经常被相互讨论或对比' },
      { id: 'co_occurs', label: '通用关联', desc: '普通业务与数据共现关联' },
    ]
  }
  if (sourceType === 'topic' && targetType === 'topic') {
    return [
      { id: 'subtopic', label: '上下级/子话题', desc: '一话题从属于另一宏观概念（父子层级）' },
      { id: 'related', label: '相关衍生', desc: '两话题属于平行或交叉衍生概念' },
      { id: 'co_occurs', label: '通用关联', desc: '普通业务与数据共现关联' },
    ]
  }
  if ((sourceType === 'subject' && targetType === 'topic') || (sourceType === 'topic' && targetType === 'subject')) {
    return [
      { id: 'mentions_topic', label: '提及话题', desc: '主体在内容中深度探讨或涉足此话题' },
      { id: 'endorses', label: '核心主打', desc: '此话题是该主体的核心赛道或主打产品方向' },
      { id: 'co_occurs', label: '通用关联', desc: '普通业务与数据共现关联' },
    ]
  }
  return [
    { id: 'co_occurs', label: '通用关联', desc: '两实体在当前调研范围内具有关联性' },
  ]
}

/**
 * 知识图谱与实体治理视图 (KnowledgeGraphView)
 */
export function KnowledgeGraphView({
  scope,
  onFilter,
  onOpenDocument,
}: {
  scope: { thread_id?: string; workflow_id?: string; run_id?: string }
  onFilter?: (node: GraphNode) => void
  onOpenDocument?: (documentId: string) => void
}) {
  const platformLabels = usePlatformLabels()
  const [selectedElement, setSelectedElement] = useState<GraphNode | Edge | null>(null)
  const [mergeNodeIds, setMergeNodeIds] = useState<string[]>([])
  const [splitDocumentIds, setSplitDocumentIds] = useState<string[]>([])
  const [showMergeGuide, setShowMergeGuide] = useState(false)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
  const [isMergeModalOpen, setIsMergeModalOpen] = useState(false)
  const [mergeTargetName, setMergeTargetName] = useState('')
  const [isSubmittingMerge, setIsSubmittingMerge] = useState(false)
  const [isSplitModalOpen, setIsSplitModalOpen] = useState(false)
  const [splitTargetName, setSplitTargetName] = useState('')
  const [isSubmittingSplit, setIsSubmittingSplit] = useState(false)
  const [isSplitMode, setIsSplitMode] = useState(false)

  // 连线关系选择弹窗
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false)
  const [connectPair, setConnectPair] = useState<{ source: GraphNode; target: GraphNode } | null>(null)
  const [selectedRelation, setSelectedRelation] = useState('co_occurs')
  const [customRelationName, setCustomRelationName] = useState('')
  const [isSubmittingConnect, setIsSubmittingConnect] = useState(false)

  const [isIgnoreConfirmOpen, setIsIgnoreConfirmOpen] = useState(false)
  const [nodeToIgnore, setNodeToIgnore] = useState<{ id: string; label: string; type: string; weight: number; edgeCount: number } | null>(null)
  const [isSubmittingIgnore, setIsSubmittingIgnore] = useState(false)
  const [isRebuilding, setIsRebuilding] = useState(false)

  // 当任务范围 (Scope) 切换时，立即清空上一个图谱的选中实体与合并清单，防止悬空指针导致的白屏或渲染错乱
  useEffect(() => {
    setSelectedElement(null)
    setMergeNodeIds([])
    setSplitDocumentIds([])
    setIsSplitMode(false)
  }, [scope?.thread_id, scope?.workflow_id, scope?.run_id])

  const search = new URLSearchParams(Object.entries(scope).filter(([, value]) => value) as string[][]).toString()

  const graphQuery = useQuery({
    queryKey: ['research-graph', scope],
    queryFn: async () => {
      const res = await fetch(`/api/graph?${search}`)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || '获取图谱数据失败')
      }
      const data = await res.json()
      return (data.graph || null) as Graph | null
    },
  })

  const graph = graphQuery.data

  // 确保当图谱刷新后，如果选中的元素在新的图谱拓扑中不存在，自动清理选中态
  useEffect(() => {
    if (selectedElement && graph) {
      const existsInNodes = (graph.nodes || []).some((n) => n.id === selectedElement.id)
      const existsInEdges = (graph.edges || []).some((e) => e.id === selectedElement.id)
      if (!existsInNodes && !existsInEdges) {
        setSelectedElement(null)
      }
    }
  }, [graph, selectedElement])

  const evidenceQuery = useQuery({
    queryKey: ['graph-evidence', graph?.id, selectedElement?.id],
    queryFn: async () => {
      if (!graph?.id || !selectedElement?.id) return { documents: [] }
      const res = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/evidence/${encodeURIComponent(selectedElement.id)}`)
      if (!res.ok) return { documents: [] }
      const json = await res.json()
      return (json as { documents: Array<{ documentId: string; title: string; platform: string; excerpt: string; sourceUrl?: string }> })
    },
    enabled: Boolean(graph?.id && selectedElement?.id),
  })

  const rulesQuery = useQuery({
    queryKey: ['graph-entity-rules', graph?.id],
    queryFn: async () => {
      if (!graph?.id) return []
      const res = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entity-rules`)
      if (!res.ok) return []
      const json = await res.json()
      return (json.items || []) as EntityRule[]
    },
    enabled: Boolean(graph?.id),
  })

  const visibleNodes = useMemo(() => {
    return (graph?.nodes || []).slice(0, 60).map((node) => {
      if (node.type === 'platform') {
        return {
          ...node,
          label: platformLabel(platformLabels, node.label),
        }
      }
      return node
    })
  }, [graph?.nodes, platformLabels])
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleEdges = useMemo(() => {
    return (graph?.edges || []).filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).slice(0, 120)
  }, [graph?.edges, visibleIds])

  const rebuild = async () => {
    setIsRebuilding(true)
    try {
      await fetch('/api/graph/rebuild', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scope) })
      await graphQuery.refetch()
      toast.success('图谱拓扑已重新计算生成')
    } catch (err: any) {
      toast.error(err.message || '重建图谱失败')
    } finally {
      setIsRebuilding(false)
    }
  }

  const openMergeModal = () => {
    const selected = (graph?.nodes || []).filter((node) => mergeNodeIds.includes(node.id))
    const defaultName = selected[0]?.label || ''
    setMergeTargetName(defaultName)
    setIsMergeModalOpen(true)
  }

  const handleConfirmMerge = async () => {
    const targetLabel = mergeTargetName.trim()
    if (!targetLabel || !graph) return
    setIsSubmittingMerge(true)
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_ids: mergeNodeIds, target_label: targetLabel }),
      })
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '实体合并失败')
        return
      }
      toast.success(`已成功合并 ${mergeNodeIds.length} 个实体为「${targetLabel}」`)
      setMergeNodeIds([])
      setSelectedElement(null)
      setIsMergeModalOpen(false)
      await graphQuery.refetch()
      await rulesQuery.refetch()
    } catch (err: any) {
      toast.error(err.message || '实体合并失败')
    } finally {
      setIsSubmittingMerge(false)
    }
  }

  const openSplitModal = () => {
    if (!graph || !selectedElement || !('label' in selectedElement)) return
    setSplitTargetName('')
    setIsSplitModalOpen(true)
  }

  const handleConfirmSplit = async () => {
    const targetLabel = splitTargetName.trim()
    if (!targetLabel || !graph || !selectedElement || !('label' in selectedElement)) return
    setIsSubmittingSplit(true)
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/split`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: selectedElement.id, document_ids: splitDocumentIds, target_label: targetLabel }),
      })
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '实体拆分失败')
        return
      }
      toast.success(`已成功拆分出新概念实体「${targetLabel}」`)
      setSplitDocumentIds([])
      setSelectedElement(null)
      setIsSplitModalOpen(false)
      await graphQuery.refetch()
      await rulesQuery.refetch()
    } catch (err: any) {
      toast.error(err.message || '实体拆分失败')
    } finally {
      setIsSubmittingSplit(false)
    }
  }

  const removeRule = async (ruleId: string) => {
    if (!graph) return
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entity-rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' })
      if (!response.ok) {
        toast.error((await response.json()).detail || '撤销规则失败')
        return
      }
      toast.success('已撤销该条调整记录')
      await graphQuery.refetch()
      await rulesQuery.refetch()
    } catch (err: any) {
      toast.error(err.message || '撤销规则失败')
    }
  }

  const handleQuickMerge = (sourceNode: GraphNode, targetNode: GraphNode) => {
    if (sourceNode.type === 'platform' || targetNode.type === 'platform') {
      toast.error('平台节点为物理信源，受系统保护不可合并')
      return
    }
    if (sourceNode.type !== targetNode.type) {
      toast.error('只能合并同类型的实体节点')
      return
    }
    setMergeNodeIds([sourceNode.id, targetNode.id])
    setMergeTargetName(targetNode.label)
    setIsMergeModalOpen(true)
  }

  const handleQuickConnect = (sourceNode: GraphNode, targetNode: GraphNode) => {
    setConnectPair({ source: sourceNode, target: targetNode })
    const options = getRelationOptions(sourceNode.type, targetNode.type)
    setSelectedRelation(options[0]?.id || 'co_occurs')
    setCustomRelationName('')
    setIsConnectModalOpen(true)
  }

  const handleConfirmConnect = async () => {
    if (!graph || !connectPair) return
    const rel = (customRelationName.trim() || selectedRelation || 'co_occurs')
    setIsSubmittingConnect(true)
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_node_id: connectPair.source.id, to_node_id: connectPair.target.id, relation: rel }),
      })
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '建立连线失败')
        return
      }
      const relLabel = RELATION_LABELS[rel] || rel
      toast.success(`已建立「${connectPair.source.label}」↔「${connectPair.target.label}」的【${relLabel}】关联`)
      setIsConnectModalOpen(false)
      setConnectPair(null)
      await graphQuery.refetch()
      await rulesQuery.refetch()
    } catch (err: any) {
      toast.error(err.message || '建立连线失败')
    } finally {
      setIsSubmittingConnect(false)
    }
  }

  const handleIgnoreClick = (node: GraphNode) => {
    if (node.type === 'platform') {
      toast.error('平台为客观信源节点，受系统保护不可移出')
      return
    }
    const connectedEdges = (graph?.edges || []).filter((e) => e.from === node.id || e.to === node.id)
    setNodeToIgnore({
      ...node,
      edgeCount: connectedEdges.length,
    })
    setIsIgnoreConfirmOpen(true)
  }

  const handleConfirmIgnore = async () => {
    if (!graph || !nodeToIgnore) return
    setIsSubmittingIgnore(true)
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeToIgnore.id }),
      })
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '移出实体失败')
        return
      }
      toast.success(`已将实体「${nodeToIgnore.label}」从图谱中移出`)
      setSelectedElement(null)
      setMergeNodeIds((current) => current.filter((id) => id !== nodeToIgnore.id))
      setIsIgnoreConfirmOpen(false)
      setNodeToIgnore(null)
      await graphQuery.refetch()
      await rulesQuery.refetch()
    } catch (err: any) {
      toast.error(err.message || '移出实体失败')
    } finally {
      setIsSubmittingIgnore(false)
    }
  }

  const handleAddToMerge = (node: GraphNode) => {
    if (node.type === 'platform') {
      toast.error('平台节点为物理信源，受系统保护不可合并')
      return
    }
    if (mergeNodeIds.includes(node.id)) {
      setMergeNodeIds((current) => current.filter((id) => id !== node.id))
      return
    }
    const selectedNodes = (graph?.nodes || []).filter((n) => mergeNodeIds.includes(n.id))
    if (selectedNodes.length > 0 && selectedNodes[0].type !== node.type) {
      const typeMap: Record<string, string> = { subject: '主体', keyword: '关键词', topic: '话题' }
      toast.error(`只能合并同类型的实体（当前已选 ${typeMap[selectedNodes[0].type] || selectedNodes[0].type} 节点）`)
      return
    }
    setMergeNodeIds((current) => [...current, node.id])
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 sm:p-4">
      {/* 顶部操作指引与显性工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/40 px-3.5 py-2.5 backdrop-blur-xs">
        {/* 左侧：统计与图例 */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyber-text-primary">
            <Network className="h-4 w-4 text-cyber-neon-cyan" />
            <span>知识图谱与实体拓扑</span>
          </div>

          <div className="hidden sm:flex items-center gap-2.5 text-[11px] text-cyber-text-muted border-l border-cyber-border-subtle pl-3">
            <span><strong>{graph?.documentCount || 0}</strong> 文档</span>
            <span><strong>{graph?.nodes?.length || 0}</strong> 实体节点</span>
            <span><strong>{graph?.edges?.length || 0}</strong> 关联边</span>
          </div>

          <div className="flex items-center gap-2.5 text-[10.5px] text-cyber-text-muted border-l border-cyber-border-subtle pl-3">
            {Object.entries({ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }).map(([type, label]) => (
              <span key={type} className="flex items-center gap-1">
                <i className="h-2 w-2 rounded-full" style={{ background: nodeColor[type] }} />
                {label}
              </span>
            ))}
          </div>
        </div>

        {/* 右侧：操作按钮组 */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-secondary"
            onClick={() => setShowMergeGuide(true)}
            title="图谱快捷操作指引"
          >
            <HelpCircle className="h-4 w-4" />
          </Button>

          <Button
            size="sm"
            variant="outline"
            disabled={isRebuilding}
            className="h-7 gap-1.5 px-2.5 text-xs text-cyber-text-muted hover:text-cyber-text-primary border-cyber-border-subtle transition-all"
            onClick={rebuild}
            title="重新计算图谱节点与边关系"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRebuilding ? 'animate-spin text-cyber-neon-cyan' : ''}`} />
            <span>{isRebuilding ? '计算中...' : '重建图谱'}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className={`h-7 gap-1.5 px-2.5 text-xs border-cyber-border-subtle transition-colors ${
              (rulesQuery.data || []).length > 0
                ? 'text-cyber-text-primary bg-cyber-bg-secondary/60 hover:bg-cyber-bg-secondary font-medium'
                : 'text-cyber-text-muted hover:text-cyber-text-primary'
            }`}
            onClick={() => setIsHistoryModalOpen(true)}
            title="查看与撤销实体合并、连线、移出等历史操作"
          >
            <HistoryIcon className="h-3.5 w-3.5" />
            <span>操作历史</span>
            {(rulesQuery.data || []).length > 0 && (
              <span className="ml-0.5 rounded-full bg-cyber-neon-cyan/20 px-1.5 py-0.2 text-[10px] font-semibold text-cyber-neon-cyan border border-cyber-neon-cyan/40">
                {rulesQuery.data!.length}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* 快照版本对比与增量新文档提示条 */}
      {graph?.isOutdated && (graph?.newDocumentCount || 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/15 px-3.5 py-2 text-xs backdrop-blur-xs animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            </span>
            <div className="min-w-0 text-cyber-text-primary">
              <span className="font-semibold text-amber-700 dark:text-amber-300">发现新增采集数据：</span>
              <span className="text-cyber-text-secondary ml-1">
                检测到新增了 <strong className="text-amber-700 dark:text-amber-400 font-bold font-mono">{graph.newDocumentCount}</strong> 篇关联文档
                （当前快照基于 {graph.snapshotDocumentCount || graph.documentCount} 篇，最新共 {graph.currentDocumentCount} 篇）。
              </span>
            </div>
          </div>
          <Button
            size="sm"
            disabled={isRebuilding}
            onClick={rebuild}
            className="h-7 gap-1.5 px-3 text-xs bg-amber-500 hover:bg-amber-600 text-white dark:bg-amber-500/25 dark:text-amber-200 dark:border-amber-500/50 dark:hover:bg-amber-500/40 border border-amber-600/30 shrink-0 font-medium shadow-xs transition-all cursor-pointer"
          >
            <RefreshCw className={`h-3 w-3 ${isRebuilding ? 'animate-spin' : ''}`} />
            <span>{isRebuilding ? '正在更新拓扑...' : '一键更新图谱'}</span>
          </Button>
        </div>
      )}

      {/* 实体合并待办栏 (唯一的合并操作与清单入口) */}
      {mergeNodeIds.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/70 px-3 py-1.5 text-xs animate-in fade-in slide-in-from-top-1 w-full min-w-0 overflow-hidden gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <Combine className="h-4 w-4 text-cyber-text-primary shrink-0" />
            <span className="text-cyber-text-primary truncate min-w-0 flex-1">
              已选待合并 ({mergeNodeIds.length})：
              <strong className="ml-1 text-cyber-text-primary font-semibold truncate font-mono text-[11px]">
                {(graph?.nodes || [])
                  .filter((n) => mergeNodeIds.includes(n.id))
                  .map((n) => n.label)
                  .join('、')}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              className="text-cyber-text-muted hover:text-rose-500 text-xs px-2 py-0.5"
              onClick={() => setMergeNodeIds([])}
            >
              清空
            </button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-3 text-xs border-cyber-border-subtle bg-cyber-bg-primary text-cyber-text-primary hover:bg-cyber-bg-secondary font-medium"
              disabled={mergeNodeIds.length < 2}
              onClick={openMergeModal}
            >
              合并选中的实体
            </Button>
          </div>
        </div>
      )}

      {/* 主体画布与详情分栏 */}
      <div
        className={`grid flex-1 min-h-0 gap-3.5 ${
          selectedElement
            ? 'overflow-auto lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden'
            : 'grid-cols-1'
        }`}
      >
        {/* 左侧 / 全屏图谱画布 */}
        <section className="relative flex min-w-0 flex-col overflow-hidden">
          {graphQuery.isLoading ? (
            <div className="flex min-h-[380px] flex-1 flex-col items-center justify-center rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/20 p-8 text-center backdrop-blur-xs">
              <RefreshCw className="h-7 w-7 text-cyber-neon-cyan animate-spin mb-2.5" />
              <p className="text-xs text-cyber-text-muted">正在加载图谱拓扑数据...</p>
            </div>
          ) : graph && visibleNodes.length ? (
            <div className="flex flex-col flex-1 min-h-0 relative">
              <ObsidianForceGraph
                nodes={visibleNodes}
                edges={visibleEdges}
                selectedElement={selectedElement}
                onSelectElement={setSelectedElement}
                onMergeNodes={handleQuickMerge}
                onConnectNodes={handleQuickConnect}
                nodeColors={nodeColor}
              />
            </div>
          ) : (
            <div className="flex min-h-[380px] flex-1 flex-col items-center justify-center rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/20 p-8 text-center backdrop-blur-xs animate-in fade-in zoom-in-95">
              <div className="relative mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyber-neon-cyan/30 bg-cyber-neon-cyan/10 shadow-lg shadow-cyber-neon-cyan/5">
                <Network className="h-7 w-7 text-cyber-neon-cyan animate-pulse" />
              </div>

              <h4 className="text-sm font-semibold text-cyber-text-primary">
                {(rulesQuery.data || []).length > 0 && (graph?.currentDocumentCount || 0) > 0
                  ? '图谱实体已全部被规则过滤'
                  : (graph?.currentDocumentCount || graph?.documentCount || 0) > 0
                  ? '图谱关系拓扑待生成'
                  : '暂无关联采集数据'}
              </h4>

              <p className="mt-2 max-w-md text-xs text-cyber-text-secondary leading-relaxed">
                {(rulesQuery.data || []).length > 0 && (graph?.currentDocumentCount || 0) > 0
                  ? '历史实体治理操作（移出/合并规则）已过滤当前分析范围内的全部节点，可打开操作历史查看或撤销规则。'
                  : (graph?.currentDocumentCount || graph?.documentCount || 0) > 0
                  ? `当前分析范围内已就绪 ${graph?.currentDocumentCount || graph?.documentCount} 篇文档，点击下方按钮一键提取实体并构建物理力导向关系网络。`
                  : '当前任务范围尚未采集到有效证据文档，请先在工作台启动采集或导入数据。'}
              </p>

              <div className="mt-5 flex items-center gap-2.5">
                {(rulesQuery.data || []).length > 0 && (graph?.currentDocumentCount || 0) > 0 ? (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsHistoryModalOpen(true)}
                      className="h-8 gap-1.5 px-3.5 text-xs border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/20 font-medium"
                    >
                      <HistoryIcon className="h-3.5 w-3.5" />
                      <span>查看操作历史 ({rulesQuery.data!.length})</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isRebuilding}
                      onClick={rebuild}
                      className="h-8 gap-1.5 px-3 text-xs border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
                      <span>重新计算</span>
                    </Button>
                  </>
                ) : (graph?.currentDocumentCount || graph?.documentCount || 0) > 0 ? (
                  <Button
                    size="sm"
                    disabled={isRebuilding}
                    onClick={rebuild}
                    className="h-8 gap-2 px-4 text-xs bg-cyber-neon-cyan text-white hover:bg-cyber-neon-cyan-dim dark:bg-cyber-neon-cyan/25 dark:text-cyan-200 dark:border-cyber-neon-cyan/50 dark:hover:bg-cyber-neon-cyan/40 shadow-sm font-medium transition-all cursor-pointer"
                  >
                    <Sparkles className={`h-3.5 w-3.5 ${isRebuilding ? 'animate-spin text-white' : ''}`} />
                    <span>{isRebuilding ? '正在提取实体与拓扑...' : '立即生成关系图谱'}</span>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isRebuilding}
                    onClick={rebuild}
                    className="h-8 gap-1.5 px-3 text-xs border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${isRebuilding ? 'animate-spin' : ''}`} />
                    <span>重新检测数据</span>
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>

        {/* 右侧分栏详情抽屉 */}
        {selectedElement && (
          <section className="flex min-w-0 flex-col rounded-xl border border-cyber-neon-cyan/40 bg-cyber-bg-secondary/45 p-4 shadow-xl lg:h-full lg:min-h-0 lg:overflow-hidden animate-in fade-in slide-in-from-right-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-cyber-border-subtle pb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-semibold text-cyber-text-primary truncate">
                    {'label' in selectedElement
                      ? (selectedElement.type === 'platform' ? platformLabel(platformLabels, selectedElement.label) : selectedElement.label)
                      : selectedElement.relation}
                  </h3>
                  {'type' in selectedElement ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: `${nodeColor[selectedElement.type] || '#94a3b8'}20`,
                        color: nodeColor[selectedElement.type] || '#cbd5e1',
                        border: `1px solid ${nodeColor[selectedElement.type] || '#94a3b8'}40`,
                      }}
                    >
                      {{ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }[selectedElement.type] || selectedElement.type}
                    </span>
                  ) : (
                    <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] text-slate-300 border border-slate-500/40">
                      关联关系
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-cyber-text-muted">
                  共关联 <strong className="text-cyber-neon-cyan">{selectedElement.weight || 0}</strong> 篇证据文档 · 精准溯源
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {'label' in selectedElement ? (
                  selectedElement.type === 'platform' ? (
                    <span className="flex items-center gap-1 rounded bg-emerald-500/10 px-2 py-1 text-[10.5px] font-medium text-emerald-400 border border-emerald-500/30">
                      <Shield className="h-3 w-3" />
                      <span>客观信源保护</span>
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-cyber-text-muted hover:text-rose-400 hover:bg-rose-500/10"
                      onClick={() => handleIgnoreClick(selectedElement)}
                      title="将此无意义或噪点实体从图谱中移出"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      <span>移出</span>
                    </Button>
                  )
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-primary/60 shrink-0"
                  onClick={() => { setSelectedElement(null); setSplitDocumentIds([]); setIsSplitMode(false) }}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  <span>关闭</span>
                </Button>
              </div>
            </div>

            {/* 实体级操作区 (Entity Level Actions) */}
            {'label' in selectedElement ? (
              <div className="mt-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/40 p-2.5 space-y-2">
                <div className="text-[10.5px] font-semibold text-cyber-text-muted flex items-center justify-between">
                  <span>实体治理操作</span>
                  <span className="text-[10px] text-cyber-text-muted font-normal">
                    {selectedElement.type === 'platform' ? '物理信源受系统保护' : '透视 · 合并 · 拆分'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 w-full">
                  {onFilter ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs border-cyber-neon-cyan/40 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10 flex-1 min-w-0 justify-center"
                      onClick={() => onFilter(selectedElement)}
                      title="在数据透视表中查看此实体关联的全部数据"
                    >
                      <Filter className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">透视查看</span>
                    </Button>
                  ) : null}

                  {'label' in selectedElement && selectedElement.type !== 'platform' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className={`h-7 gap-1 px-2 text-xs flex-1 min-w-0 justify-center ${
                        mergeNodeIds.includes(selectedElement.id)
                          ? 'border-cyber-neon-cyan/60 bg-cyber-neon-cyan/15 text-cyber-neon-cyan font-medium'
                          : 'border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary'
                      }`}
                      onClick={() => handleAddToMerge(selectedElement)}
                      title="将此实体加入合并清单，与其他实体多对一合并"
                    >
                      <Combine className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{mergeNodeIds.includes(selectedElement.id) ? '已在合并池' : '加入合并'}</span>
                    </Button>
                  ) : null}

                  {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={(selectedElement.weight || 0) <= 1}
                      title={(selectedElement.weight || 0) <= 1 ? '当前实体仅关联 1 篇文档，无法拆分' : '从当前实体中勾选证据拆出新实体'}
                      className={`h-7 gap-1 px-2 text-xs flex-1 min-w-0 justify-center ${
                        isSplitMode
                          ? 'border-cyber-neon-cyan/60 bg-cyber-neon-cyan/20 text-cyber-neon-cyan font-semibold shadow-sm'
                          : 'border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary'
                      }`}
                      onClick={() => {
                        const next = !isSplitMode
                        setIsSplitMode(next)
                        if (!next) setSplitDocumentIds([])
                      }}
                    >
                      <Split className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{isSplitMode ? '退出拆分' : '拆分实体'}</span>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* 证据文档与细分拆分区 Header */}
            <div className="mt-3.5 flex items-center justify-between gap-2 px-0.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-cyber-text-primary">
                <FileText className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                <span>关联证据文档 ({evidenceQuery.data?.documents?.length || selectedElement.weight || 0})</span>
              </div>
            </div>

            {/* 拆分模式提示条 */}
            {isSplitMode && (
              <div className="mt-2 flex items-center justify-between rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1.5 text-[11px] animate-in fade-in">
                <span className="text-cyber-text-secondary font-medium">
                  <span className="text-cyan-600 dark:text-cyan-400 font-semibold mr-1">💡 拆分模式：</span>
                  请在下方勾选要拆出的证据文档
                </span>
                <div className="flex items-center gap-2">
                  {splitDocumentIds.length > 0 && (
                    <button
                      type="button"
                      className="text-[10.5px] text-cyan-600 dark:text-cyan-300 hover:text-cyan-700 dark:hover:text-cyan-200 underline underline-offset-2 font-medium"
                      onClick={() => setSplitDocumentIds([])}
                    >
                      清空已选 ({splitDocumentIds.length})
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-[10.5px] text-cyber-text-muted hover:text-cyber-text-primary"
                    onClick={() => { setIsSplitMode(false); setSplitDocumentIds([]) }}
                  >
                    取消
                  </button>
                </div>
              </div>
            )}

            {/* Documents Evidence List */}
            <div className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
              {evidenceQuery.isLoading ? (
                <div className="grid h-48 place-items-center text-xs text-cyber-text-muted">
                  <RefreshCw className="h-4 w-4 animate-spin mb-1 text-cyber-neon-cyan" />
                  <span>正在调取回溯证据...</span>
                </div>
              ) : (evidenceQuery.data?.documents || []).length ? (
                evidenceQuery.data!.documents.map((document) => (
                  <div
                    key={document.documentId}
                    className={`group rounded-lg border p-2.5 transition-colors ${
                      isSplitMode && splitDocumentIds.includes(document.documentId)
                        ? 'border-cyber-neon-cyan/60 bg-cyber-neon-cyan/10'
                        : 'border-cyber-border-subtle bg-cyber-bg-primary/50 hover:border-cyber-neon-cyan/40 hover:bg-cyber-bg-primary/80'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {isSplitMode ? (
                        <input
                          type="checkbox"
                          className="mt-1 h-3.5 w-3.5 rounded border-cyber-border-subtle text-cyber-neon-cyan focus:ring-0 cursor-pointer"
                          checked={splitDocumentIds.includes(document.documentId)}
                          onChange={() =>
                            setSplitDocumentIds((current) =>
                              current.includes(document.documentId)
                                ? current.filter((id) => id !== document.documentId)
                                : [...current, document.documentId]
                            )
                          }
                          aria-label="选择文档用于分离新节点"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="text-left font-medium text-xs text-cyber-text-primary hover:text-cyber-neon-cyan truncate"
                            onClick={() => onOpenDocument?.(document.documentId)}
                            title={document.title || '无标题'}
                          >
                            {document.title || '无标题'}
                          </button>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {document.platform ? (
                              <span className="rounded bg-cyber-bg-secondary px-1.5 py-0.5 text-[9px] text-cyber-text-muted border border-cyber-border-subtle">
                                {platformLabel(platformLabels, document.platform)}
                              </span>
                            ) : null}
                            {document.sourceUrl ? (
                              <a
                                href={document.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-cyber-text-muted hover:text-cyber-neon-cyan p-0.5"
                                title="在新窗口打开原始网页"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}
                          </div>
                        </div>
                        {document.excerpt ? (
                          <p className="mt-1.5 line-clamp-3 text-[11px] leading-relaxed text-cyber-text-muted">
                            {document.excerpt}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="grid h-40 place-items-center text-xs text-cyber-text-muted">
                  暂无匹配的证据文档
                </div>
              )}
            </div>

            {/* Footer split action */}
            {isSplitMode && splitDocumentIds.length > 0 ? (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 p-2.5 text-xs animate-in fade-in slide-in-from-bottom-2">
                <span className="text-[11px] text-cyber-text-primary">
                  已选 <strong>{splitDocumentIds.length}</strong> 篇文档
                </span>
                <Button
                  size="sm"
                  className="h-7 gap-1.5 px-3 text-xs bg-cyber-neon-cyan text-cyber-bg-primary hover:bg-cyber-neon-cyan/90 font-medium"
                  onClick={openSplitModal}
                >
                  <Split className="h-3.5 w-3.5" />
                  <span>分离为新概念实体</span>
                </Button>
              </div>
            ) : null}
          </section>
        )}
      </div>

      {/* 知识图谱操作指引弹窗 */}
      <Dialog open={showMergeGuide} onOpenChange={setShowMergeGuide}>
        <DialogContent className="max-w-sm border-cyber-border-subtle bg-cyber-bg-secondary/95 p-5 backdrop-blur-xl">
          <DialogHeader className="pb-1">
            <DialogTitle className="text-sm font-semibold text-cyber-text-primary">
              图谱快捷操作指引
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-1 text-xs text-cyber-text-muted">
            <div className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 p-3 space-y-2.5">
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-cyan-400 font-bold">•</span>
                <span><strong className="text-cyber-text-primary">浏览与拓扑探索</strong>：拖拽节点可探索力导向拓扑分布，滚轮缩放画布；点击任意节点或连线可在右侧打开证据回溯侧边栏。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-violet-400 font-bold">•</span>
                <span><strong className="text-cyber-text-primary">磁吸合并</strong>：按住 <kbd className="px-1 py-0.5 rounded bg-cyber-bg-secondary border border-cyber-border-subtle text-[10px] text-cyber-text-primary">Alt / Option</kbd> 拖拽节点靠近目标释放，或点击右下角工具栏「合并」模式。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-emerald-400 font-bold">•</span>
                <span><strong className="text-cyber-text-primary">快速连线</strong>：按住 <kbd className="px-1 py-0.5 rounded bg-cyber-bg-secondary border border-cyber-border-subtle text-[10px] text-cyber-text-primary">Shift</kbd> 拖拽拉出激光线连接两点，或点击右下角工具栏「连线」模式。</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 text-amber-400 font-bold">•</span>
                <span><strong className="text-cyber-text-primary">实体治理</strong>：在右侧详情栏中可将噪点实体「移出」图谱、加入待合并清单，或勾选证据文档「分离为新节点」。</span>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              size="sm"
              className="w-full bg-cyber-neon-cyan text-cyber-bg-primary hover:bg-cyber-neon-cyan/90 font-medium text-xs h-7"
              onClick={() => setShowMergeGuide(false)}
            >
              我知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 实体合并统一命名弹窗 */}
      <Dialog open={isMergeModalOpen} onOpenChange={setIsMergeModalOpen}>
        <DialogContent className="max-w-md w-full overflow-hidden border-cyber-border-subtle bg-cyber-bg-secondary/95 p-6 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50">
                <Combine className="h-5 w-5 text-cyber-neon-cyan" />
              </div>
              <div className="text-left min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-cyber-text-primary">
                  统一合并实体名称
                </DialogTitle>
                <DialogDescription className="text-xs text-cyber-text-muted mt-0.5">
                  将选中的 {mergeNodeIds.length} 个实体合并为一个标准实体
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 py-2 min-w-0 overflow-hidden">
            <div>
              <label className="text-xs text-cyber-text-muted font-medium block mb-1.5">
                选中的待合并实体 ({mergeNodeIds.length})：
              </label>
              <div className="flex flex-col gap-1.5 p-2 rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 max-h-36 overflow-y-auto w-full min-w-0">
                {(graph?.nodes || [])
                  .filter((n) => mergeNodeIds.includes(n.id))
                  .map((n) => (
                    <div
                      key={n.id}
                      className="flex items-center gap-2 rounded px-2.5 py-1 text-xs font-medium border border-cyber-border-subtle bg-cyber-bg-secondary text-cyber-text-primary w-full min-w-0 overflow-hidden"
                    >
                      <i className="h-2 w-2 rounded-full shrink-0" style={{ background: nodeColor[n.type] || '#94a3b8' }} />
                      <span className="truncate flex-1 min-w-0 font-mono text-[11px]" title={n.label}>
                        {n.label}
                      </span>
                      <span className="text-[10px] text-cyber-text-muted shrink-0">
                        ({ { subject: '主体', keyword: '关键词', topic: '话题', platform: '平台' }[n.type] || n.type })
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            <div>
              <label className="text-xs text-cyber-text-primary font-medium block mb-1.5">
                合并后的统一标准名称：
              </label>
              <Input
                value={mergeTargetName}
                onChange={(e) => setMergeTargetName(e.target.value)}
                placeholder="请输入统一实体名称..."
                className="h-9 text-xs w-full min-w-0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmMerge()
                }}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-cyber-border-subtle"
              onClick={() => setIsMergeModalOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-cyber-neon-cyan hover:bg-cyber-neon-cyan/90 text-cyber-bg-primary font-medium text-xs"
              onClick={handleConfirmMerge}
              disabled={!mergeTargetName.trim() || isSubmittingMerge}
            >
              {isSubmittingMerge ? '正在合并...' : '确认合并'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 实体拆分新概念弹窗 */}
      <Dialog open={isSplitModalOpen} onOpenChange={setIsSplitModalOpen}>
        <DialogContent className="max-w-md w-full overflow-hidden border-cyber-border-subtle bg-cyber-bg-secondary/95 p-6 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10">
                <Split className="h-5 w-5 text-cyber-neon-cyan" />
              </div>
              <div className="text-left min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-cyber-text-primary">
                  拆分新概念/实体
                </DialogTitle>
                <DialogDescription className="text-xs text-cyber-text-muted mt-0.5">
                  将已选中的 {splitDocumentIds.length} 篇证据文档从原实体中拆出
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 py-2 min-w-0 overflow-hidden">
            <div className="flex items-center gap-1.5 text-xs text-cyber-text-muted min-w-0 overflow-hidden">
              <span className="shrink-0">原实体节点：</span>
              <span className="font-semibold text-cyber-text-primary truncate min-w-0 font-mono text-[11px]" title={selectedElement && 'label' in selectedElement ? selectedElement.label : ''}>
                {selectedElement && 'label' in selectedElement ? selectedElement.label : ''}
              </span>
            </div>

            <div>
              <label className="text-xs text-cyber-text-primary font-medium block mb-1.5">
                拆分出的新概念/实体名称：
              </label>
              <Input
                value={splitTargetName}
                onChange={(e) => setSplitTargetName(e.target.value)}
                placeholder="请输入新概念/实体名称..."
                className="h-9 text-xs w-full min-w-0"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleConfirmSplit()
                }}
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-cyber-border-subtle"
              onClick={() => setIsSplitModalOpen(false)}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-cyber-neon-cyan hover:bg-cyber-neon-cyan/90 text-cyber-bg-primary font-medium text-xs"
              onClick={handleConfirmSplit}
              disabled={!splitTargetName.trim() || isSubmittingSplit}
            >
              {isSubmittingSplit ? '正在拆分...' : '确认拆分'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 建立实体关联关系弹窗 */}
      <Dialog open={isConnectModalOpen} onOpenChange={setIsConnectModalOpen}>
        <DialogContent className="max-w-md w-full overflow-hidden border-cyber-border-subtle bg-cyber-bg-secondary/95 p-6 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                <Link2 className="h-5 w-5 text-emerald-400" />
              </div>
              <div className="text-left min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-cyber-text-primary">
                  建立自定义关联连线
                </DialogTitle>
                <DialogDescription className="text-xs text-cyber-text-muted mt-0.5">
                  为两个图谱实体指定明确的业务语义关系
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {connectPair && (
            <div className="space-y-3.5 py-2 min-w-0 overflow-hidden">
              {/* 实体展示 */}
              <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 text-xs w-full min-w-0 overflow-hidden">
                <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                  <i className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: nodeColor[connectPair.source.type] || '#94a3b8' }} />
                  <span className="font-semibold text-cyber-text-primary truncate min-w-0 font-mono text-[11px]" title={connectPair.source.label}>{connectPair.source.label}</span>
                  <span className="text-[10px] text-cyber-text-muted shrink-0">({ { subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }[connectPair.source.type] || connectPair.source.type })</span>
                </div>
                <span className="text-cyber-neon-cyan font-bold shrink-0 px-1">↔</span>
                <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
                  <i className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: nodeColor[connectPair.target.type] || '#94a3b8' }} />
                  <span className="font-semibold text-cyber-text-primary truncate min-w-0 font-mono text-[11px]" title={connectPair.target.label}>{connectPair.target.label}</span>
                  <span className="text-[10px] text-cyber-text-muted shrink-0">({ { subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }[connectPair.target.type] || connectPair.target.type })</span>
                </div>
              </div>

              {/* 关系类型选择 */}
              <div>
                <label className="text-xs text-cyber-text-primary font-medium block mb-2">
                  选择推荐业务关系：
                </label>
                <div className="space-y-1.5">
                  {getRelationOptions(connectPair.source.type, connectPair.target.type).map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        selectedRelation === opt.id && !customRelationName.trim()
                          ? 'border-emerald-500/60 bg-emerald-500/10'
                          : 'border-cyber-border-subtle bg-cyber-bg-primary/40 hover:bg-cyber-bg-primary/70'
                      }`}
                      onClick={() => { setSelectedRelation(opt.id); setCustomRelationName('') }}
                    >
                      <input
                        type="radio"
                        name="relation-type"
                        className="mt-0.5 text-emerald-500 focus:ring-0 cursor-pointer"
                        checked={selectedRelation === opt.id && !customRelationName.trim()}
                        onChange={() => { setSelectedRelation(opt.id); setCustomRelationName('') }}
                      />
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="font-medium text-cyber-text-primary">{opt.label} <span className="text-[10px] text-cyber-text-muted font-normal">({opt.id})</span></div>
                        <div className="text-[11px] text-cyber-text-muted mt-0.5 leading-relaxed">{opt.desc}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 自定义关系输入 */}
              <div>
                <label className="text-xs text-cyber-text-muted font-medium block mb-1">
                  或输入自定义关系名称（选填）：
                </label>
                <Input
                  value={customRelationName}
                  onChange={(e) => setCustomRelationName(e.target.value)}
                  placeholder="例如：投资控股、供应链采购、替代品..."
                  className="h-8 text-xs w-full min-w-0"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-cyber-border-subtle"
              onClick={() => { setIsConnectModalOpen(false); setConnectPair(null) }}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-emerald-500 hover:bg-emerald-600 text-white font-medium text-xs"
              onClick={handleConfirmConnect}
              disabled={isSubmittingConnect}
            >
              {isSubmittingConnect ? '正在建立...' : '确认建立连线'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 移出实体二次确认与级联预警弹窗 */}
      <Dialog open={isIgnoreConfirmOpen} onOpenChange={setIsIgnoreConfirmOpen}>
        <DialogContent className="max-w-md w-full overflow-hidden border-cyber-border-subtle bg-cyber-bg-secondary/95 p-6 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10">
                <Trash2 className="h-5 w-5 text-rose-400" />
              </div>
              <div className="text-left min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-cyber-text-primary">
                  确认从图谱中移出该实体？
                </DialogTitle>
                <DialogDescription className="text-xs text-cyber-text-muted mt-0.5">
                  清洗噪点节点并重新计算图谱拓扑
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {nodeToIgnore && (
            <div className="space-y-3 py-2 text-xs min-w-0 overflow-hidden">
              <div className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 p-3 space-y-2 min-w-0 overflow-hidden">
                <div className="flex items-center justify-between gap-2 min-w-0 overflow-hidden">
                  <span className="text-cyber-text-muted shrink-0">待移出实体：</span>
                  <div className="flex items-center gap-1.5 min-w-0 flex-1 justify-end overflow-hidden">
                    <i className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: nodeColor[nodeToIgnore.type] || '#94a3b8' }} />
                    <span className="font-semibold text-cyber-text-primary truncate min-w-0 font-mono text-[11px]" title={nodeToIgnore.label}>{nodeToIgnore.label}</span>
                    <span className="text-[10px] text-cyber-text-muted shrink-0">({ { subject: '主体', keyword: '关键词', topic: '话题' }[nodeToIgnore.type] || nodeToIgnore.type })</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-cyber-text-muted">关联证据文档：</span>
                  <span className="font-medium text-cyber-text-primary">{nodeToIgnore.weight} 篇</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-cyber-text-muted">连带受影响的拓扑边：</span>
                  <span className="font-semibold text-amber-600 dark:text-amber-400">{nodeToIgnore.edgeCount} 条</span>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-lg border border-amber-500/25 bg-amber-500/10 text-xs text-cyber-text-secondary leading-relaxed">
                <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
                <div className="text-[11.5px] leading-relaxed text-cyber-text-secondary">
                  <strong className="text-amber-600 dark:text-amber-400 font-semibold mr-1">安全说明：</strong>
                  移出仅在当前任务视图中隐藏该节点及其相连边，底层的原始采集文档与数据库记录<strong className="text-cyber-text-primary font-semibold">不受任何破坏</strong>。你可在顶部「操作历史」中随时一键撤销并还原。
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-cyber-border-subtle"
              onClick={() => { setIsIgnoreConfirmOpen(false); setNodeToIgnore(null) }}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="bg-rose-500 hover:bg-rose-600 text-white font-medium text-xs"
              onClick={handleConfirmIgnore}
              disabled={isSubmittingIgnore}
            >
              {isSubmittingIgnore ? '正在移出...' : '确认移出'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 图谱治理操作历史与规则管理弹窗 */}
      <Dialog open={isHistoryModalOpen} onOpenChange={setIsHistoryModalOpen}>
        <DialogContent className="max-w-md border-cyber-border-subtle bg-cyber-bg-secondary/95 p-5 backdrop-blur-xl">
          <DialogHeader className="pb-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/60">
                  <HistoryIcon className="h-4 w-4 text-cyber-neon-cyan" />
                </div>
                <DialogTitle className="text-sm font-semibold text-cyber-text-primary">
                  图谱操作历史与规则管理
                </DialogTitle>
              </div>
            </div>
            <DialogDescription className="text-xs text-cyber-text-muted mt-1">
              管理已保存的实体合并、拆分、连线与移出规则，支持逐项撤销或一键重置。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {(rulesQuery.data || []).length > 0 ? (
              <>
                <div className="flex items-center justify-between text-xs px-0.5">
                  <span className="text-cyber-text-muted">
                    共生效 <strong>{rulesQuery.data!.length}</strong> 条自定义治理规则
                  </span>
                  <button
                    type="button"
                    className="text-xs text-rose-400 hover:text-rose-300 transition-colors"
                    onClick={async () => {
                      const rules = rulesQuery.data || []
                      for (const r of rules) {
                        await fetch(`/api/graph/${encodeURIComponent(graph!.id)}/entity-rules/${encodeURIComponent(r.ruleId)}`, { method: 'DELETE' })
                      }
                      toast.success('已清空全部规则，图谱已恢复原始默认状态')
                      await graphQuery.refetch()
                      await rulesQuery.refetch()
                    }}
                  >
                    清空全部并恢复初始
                  </button>
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {rulesQuery.data!.map((rule) => (
                    <div
                      key={rule.ruleId}
                      className="flex items-center justify-between gap-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 p-2.5 text-xs transition-colors hover:border-cyber-neon-cyan/40"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center gap-1.5 font-medium text-cyber-text-primary">
                          {rule.operation === 'merge' ? (
                            <span className="text-violet-400">🧩 实体合并</span>
                          ) : rule.operation === 'ignore' ? (
                            <span className="text-rose-400">🗑️ 移出噪点</span>
                          ) : rule.operation === 'link' ? (
                            <span className="text-emerald-400">🔗 手动连线</span>
                          ) : (
                            <span className="text-amber-400">✂️ 实体拆分</span>
                          )}
                          <span className="text-[10px] text-cyber-text-muted">
                            ({rule.nodeType})
                          </span>
                        </div>
                        <p className="text-[11px] text-cyber-text-muted truncate">
                          {rule.operation === 'merge'
                            ? `${rule.sourceLabels.join(' + ')} ➔ ${rule.targetLabel}`
                            : rule.operation === 'ignore'
                            ? `已移出「${rule.sourceLabels.join(', ')}」`
                            : rule.operation === 'link'
                            ? `${rule.sourceLabels.join(' ↔ ')} · 【${RELATION_LABELS[rule.targetLabel] || rule.targetLabel || '通用关联'}】`
                            : `${rule.documentIds.length} 篇文档 ➔ ${rule.targetLabel}`}
                        </p>
                      </div>

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-cyber-text-muted hover:text-rose-400 hover:bg-rose-500/10 shrink-0"
                        onClick={() => removeRule(rule.ruleId)}
                        title="撤销此条规则"
                      >
                        <Undo2 className="h-3.5 w-3.5 mr-1" />
                        <span>撤销</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="grid h-36 place-items-center rounded-lg border border-dashed border-cyber-border-subtle bg-cyber-bg-primary/30 text-xs text-cyber-text-muted">
                暂无自定义操作记录（支持在图谱中合并、连线、移出或拆分实体）
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs border-cyber-border-subtle h-7"
              onClick={() => setIsHistoryModalOpen(false)}
            >
              关闭
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/**
 * 研报制品与对比视图 (ResearchReportsView)
 */
export function ResearchReportsView({
  scope,
}: {
  scope: { thread_id?: string; workflow_id?: string; run_id?: string }
}) {
  const [comparison, setComparison] = useState<ReportComparison | null>(null)
  const [incrementalWorkflowId, setIncrementalWorkflowId] = useState<string | null>(null)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)
  const search = new URLSearchParams(Object.entries(scope).filter(([, value]) => value) as string[][]).toString()

  const reportsQuery = useQuery({
    queryKey: ['research-reports', scope],
    queryFn: async () => (await fetch(`/api/reports?${search}`).then((res) => res.json())).items as Report[],
  })

  const qualityQuery = useQuery({
    queryKey: ['quality-gate', scope],
    queryFn: async () => (await fetch(`/api/quality?${search}`).then((res) => res.json())).quality as Quality | null,
  })

  const relevanceWorkflowId = scope.workflow_id || reportsQuery.data?.[0]?.workflowId
  const relevanceQuery = useQuery({
    queryKey: ['search-relevance', relevanceWorkflowId],
    queryFn: async () => (await fetch(`/api/search-relevance?workflow_id=${encodeURIComponent(relevanceWorkflowId!)}`).then((res) => res.json())).items as RelevanceAssessment[],
    enabled: Boolean(relevanceWorkflowId),
  })

  const healthQuery = useQuery({
    queryKey: ['connector-health'],
    queryFn: async () => (await fetch('/api/connectors/health').then((res) => res.json())).items as Health[],
  })

  const compareReport = async (artifactId: string) => {
    try {
      const response = await fetch(`/api/reports/${encodeURIComponent(artifactId)}/compare`)
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '报告版本对比失败')
        return
      }
      setComparison(result as ReportComparison)
    } catch (err: any) {
      toast.error(err.message || '报告版本对比失败')
    }
  }

  const createIncremental = async (workflowId: string) => {
    if (!window.confirm('将以该报告对应任务为基线，只分析基线完成后新增的证据。立即开始吗？')) return
    setIncrementalWorkflowId(workflowId)
    try {
      const response = await fetch(`/api/agent/plans/${encodeURIComponent(workflowId)}/incremental`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute: true }),
      })
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '增量任务创建失败')
        return
      }
      toast.success('增量任务已创建并进入执行队列')
    } catch (err: any) {
      toast.error(err.message || '增量任务创建失败')
    } finally {
      setIncrementalWorkflowId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 sm:p-4">
      {/* 顶部：数据质量门禁概览卡片 */}
      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cyber-neon-cyan" />
            <h3 className="text-sm font-semibold text-cyber-text-primary">数据质量门禁</h3>
          </div>
          {qualityQuery.data && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium border flex items-center gap-1.5 ${
                qualityQuery.data.status === 'ready'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : qualityQuery.data.status === 'limited'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
              }`}
            >
              {qualityQuery.data.status === 'ready' ? (
                <><CheckCircle2 className="h-3.5 w-3.5" /><span>质量合格 · 可生成严谨研报</span></>
              ) : qualityQuery.data.status === 'limited' ? (
                <><AlertTriangle className="h-3.5 w-3.5" /><span>有限结论 · 建议补充采集</span></>
              ) : (
                <><XCircle className="h-3.5 w-3.5" /><span>样本不足</span></>
              )}
            </span>
          )}
        </div>

        {qualityQuery.data ? (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 p-3">
              <span className="text-[11px] text-cyber-text-muted">合格文档数</span>
              <p className="mt-1 text-base font-semibold text-cyber-text-primary">
                {qualityQuery.data.qualifiedCount} <span className="text-xs font-normal text-cyber-text-muted">/ {qualityQuery.data.documentCount}</span>
              </p>
            </div>
            <div className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 p-3">
              <span className="text-[11px] text-cyber-text-muted">正文覆盖率</span>
              <p className="mt-1 text-base font-semibold text-emerald-400">
                {Math.round(qualityQuery.data.metrics.textCoverage * 100)}%
              </p>
            </div>
            <div className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 p-3">
              <span className="text-[11px] text-cyber-text-muted">原始来源覆盖</span>
              <p className="mt-1 text-base font-semibold text-cyber-neon-cyan">
                {Math.round(qualityQuery.data.metrics.urlCoverage * 100)}%
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-cyber-text-muted">暂无质量门禁评估数据</p>
        )}

        {qualityQuery.data?.warnings && qualityQuery.data.warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-cyber-text-secondary flex items-start gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
            <div className="space-y-0.5 leading-relaxed">
              {qualityQuery.data.warnings.map((warning, idx) => (
                <p key={idx}>{warning}</p>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 研报制品列表 */}
      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4 flex-1">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-cyber-neon-cyan" />
            <h3 className="text-sm font-semibold text-cyber-text-primary">版本化研究报告</h3>
          </div>
          <span className="text-xs text-cyber-text-muted">
            已生成 {(reportsQuery.data || []).length} 份版本制品
          </span>
        </div>

        {/* 报告版本对比结果面板 */}
        {comparison && (
          <div className="mb-4 rounded-xl border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 p-3.5 text-xs">
            <div className="flex items-center justify-between border-b border-cyber-neon-cyan/20 pb-2">
              <strong className="text-cyber-text-primary text-sm flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-cyber-neon-cyan" />
                报告演进差异对比：V{comparison.from.versionNumber} ➔ V{comparison.to.versionNumber}
              </strong>
              <button
                type="button"
                className="text-cyber-text-muted hover:text-cyber-text-primary text-xs px-2 py-0.5"
                onClick={() => setComparison(null)}
              >
                关闭对比
              </button>
            </div>
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-cyber-text-secondary">
              <div>
                <span className="font-medium text-cyber-text-primary">证据文档变化：</span>
                <p className="mt-1">
                  新增 <strong className="text-emerald-400">{comparison.documents.added.length}</strong> 篇、更新 <strong className="text-amber-400">{comparison.documents.updated.length}</strong> 篇、移除 <strong className="text-rose-400">{comparison.documents.removed.length}</strong> 篇、沿用 {comparison.documents.unchanged} 篇
                </p>
              </div>
              <div>
                <span className="font-medium text-cyber-text-primary">章节结构变化：</span>
                <p className="mt-1">
                  新增 <strong className="text-emerald-400">{comparison.sections.added.length}</strong> 节、删除 <strong className="text-rose-400">{comparison.sections.removed.length}</strong> 节、内容修订 <strong className="text-cyber-neon-cyan">{comparison.sections.changed.length}</strong> 节
                </p>
              </div>
            </div>
            {comparison.sections.changed.length > 0 && (
              <p className="mt-2 text-[11px] text-cyber-text-muted truncate">
                发生修订的章节：{comparison.sections.changed.join('、')}
              </p>
            )}
          </div>
        )}

        <div className="space-y-3">
          {(reportsQuery.data || []).length > 0 ? (
            reportsQuery.data!.map((report) => (
              <div
                key={report.artifactId}
                className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-primary/50 p-4 transition-all hover:border-cyber-border-default"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-cyber-text-primary truncate">
                        {report.title}
                      </h4>
                      <span className="rounded-md bg-cyber-neon-cyan/15 px-2 py-0.5 text-xs font-semibold text-cyber-neon-cyan border border-cyber-neon-cyan/30">
                        V{report.versionNumber}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-cyber-text-muted">
                      固化引用 <strong className="text-cyber-text-primary">{report.documentIds.length}</strong> 个证据文档 · 生成于 {new Date(report.createdAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <ReportDownloadDropdown artifactId={report.artifactId} />
                    {report.previousArtifactId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 px-2.5 text-xs text-cyber-text-muted hover:text-cyber-text-primary border-cyber-border-subtle"
                        onClick={() => compareReport(report.artifactId)}
                      >
                        <GitCompare className="h-3 w-3" />
                        <span>对比 V{report.versionNumber - 1}</span>
                      </Button>
                    ) : null}
                    {report.workflowId ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 px-2.5 text-xs text-cyber-text-muted hover:text-cyber-text-primary border-cyber-border-subtle"
                        disabled={incrementalWorkflowId === report.workflowId}
                        onClick={() => createIncremental(report.workflowId!)}
                      >
                        <RefreshCw className={`h-3 w-3 ${incrementalWorkflowId === report.workflowId ? 'animate-spin' : ''}`} />
                        <span>增量研究更新</span>
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-12 text-center text-xs text-cyber-text-muted space-y-2">
              <FileText className="h-8 w-8 mx-auto opacity-40 text-cyber-neon-cyan" />
              <p>当前任务范围暂无生成的研报制品</p>
              <p className="text-[11px] opacity-75">在智能对话中完成一次深度研究任务后，会自动在此生成带严格证据链的版本化研报</p>
            </div>
          )}
        </div>
      </section>

      {/* 底部折叠面板：采集质量与搜索诊断 */}
      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/25 overflow-hidden">
        <button
          type="button"
          className="w-full flex items-center justify-between p-3.5 text-left text-xs font-semibold text-cyber-text-primary hover:bg-cyber-bg-tertiary/20 transition-colors"
          onClick={() => setDiagnosticsOpen((prev) => !prev)}
        >
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyber-neon-cyan" />
            <span>采集质量与搜索诊断监控 (选看)</span>
            <span className="text-[11px] font-normal text-cyber-text-muted">
              · 连接器健康度、搜索改写相关性
            </span>
          </div>
          {diagnosticsOpen ? <ChevronUp className="h-4 w-4 text-cyber-text-muted" /> : <ChevronDown className="h-4 w-4 text-cyber-text-muted" />}
        </button>

        {diagnosticsOpen && (
          <div className="p-4 border-t border-cyber-border-subtle grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 搜索相关性 */}
            <div>
              <h4 className="text-xs font-semibold text-cyber-text-primary mb-2 flex items-center gap-1.5">
                <GitCompare className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                <span>搜索关键词改写与评估</span>
              </h4>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {(relevanceQuery.data || []).length > 0 ? (
                  relevanceQuery.data!.map((item) => (
                    <div key={item.assessmentId} className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/40 p-2.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-cyber-text-primary font-medium">{item.provider} · {item.query}</span>
                        <span className={item.status === 'good' ? 'text-emerald-400' : item.status === 'weak' ? 'text-amber-400' : 'text-rose-400'}>
                          {item.status === 'good' ? '相关性良好' : item.status === 'weak' ? '已触发改写' : '无结果'}
                        </span>
                      </div>
                      <p className="mt-1 text-cyber-text-muted">P@10 {Math.round(item.precisionAt10 * 100)}% · {item.resultCount} 条结果 · {item.phase === 'initial' ? '首轮' : '改写轮'}</p>
                      {item.rewrittenQuery ? <p className="mt-1 text-cyber-neon-cyan font-medium">智能改写为：{item.rewrittenQuery}</p> : null}
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-cyber-text-muted py-4 text-center">暂无搜索相关性改写记录</p>
                )}
              </div>
            </div>

            {/* 连接器健康度 */}
            <div>
              <h4 className="text-xs font-semibold text-cyber-text-primary mb-2 flex items-center gap-1.5">
                <Activity className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                <span>平台连接器健康度</span>
              </h4>
              <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                {(healthQuery.data || []).length > 0 ? (
                  healthQuery.data!.map((item) => (
                    <div key={item.connectorId} className="flex items-start justify-between gap-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/40 p-2 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-cyber-text-primary">{item.connectorId}</p>
                        <p className="truncate text-[10px] text-cyber-text-muted" title={item.lastErrorMessage}>
                          {item.lastErrorMessage || `字段完整率 ${Math.round(item.fieldCoverage * 100)}%`}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-medium ${stateColor[item.state] || stateColor.unknown}`}>
                        {stateLabel[item.state] || item.state}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-cyber-text-muted py-4 text-center">完成采集后开始沉淀连接器健康度</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * 保持兼容的统一弹窗或聚合面板
 */
export function ResearchAssetsPanel({
  scope,
  onFilter,
  onOpenDocument,
}: {
  scope: { thread_id?: string; workflow_id?: string; run_id?: string }
  onFilter?: (node: GraphNode) => void
  onOpenDocument?: (documentId: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'graph' | 'reports'>('graph')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-cyber-border-subtle px-4 py-2 bg-cyber-bg-primary/80">
        <button
          type="button"
          onClick={() => setActiveTab('graph')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            activeTab === 'graph'
              ? 'bg-cyber-neon-cyan/20 text-cyber-neon-cyan font-semibold'
              : 'text-cyber-text-muted hover:text-cyber-text-primary'
          }`}
        >
          <Network className="h-3.5 w-3.5" />
          <span>关联图谱</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            activeTab === 'reports'
              ? 'bg-cyber-neon-cyan/20 text-cyber-neon-cyan font-semibold'
              : 'text-cyber-text-muted hover:text-cyber-text-primary'
          }`}
        >
          <FileText className="h-3.5 w-3.5" />
          <span>研究报告</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'graph' ? (
          <KnowledgeGraphView scope={scope} onFilter={onFilter} onOpenDocument={onOpenDocument} />
        ) : (
          <ResearchReportsView scope={scope} />
        )}
      </div>
    </div>
  )
}
