import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect, useMemo } from 'react'
import { dataApi } from '@/lib/api'
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Combine,
  Copy,
  Download,
  Edit3,
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
  Loader2,
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
import { MarkdownContent } from '@/components/agent/MarkdownContent'
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
        className="h-8 gap-1.5 px-3 text-xs border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white transition-colors shadow-sm font-medium"
      >
        <Download className="h-3.5 w-3.5" />
        <span>导出报告</span>
        <ChevronDown className={`h-3 w-3 opacity-60 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </Button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-40 w-64 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-800 p-1.5 shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95">
          {REPORT_FORMAT_OPTIONS.map((group, gIdx) => (
            <div key={group.category} className={gIdx > 0 ? 'mt-1.5 border-t border-slate-100 dark:border-slate-700/60 pt-1.5' : ''}>
              <div className="px-2 py-0.5 text-[10px] font-semibold tracking-wider text-slate-400 dark:text-slate-400 uppercase">
                {group.category}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {group.items.map((item) => (
                  <a
                    key={item.format}
                    href={`/api/reports/${artifactId}/download?format=${item.format}`}
                    download
                    onClick={() => setOpen(false)}
                    className="flex items-center justify-between rounded-lg px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/60 hover:text-slate-900 dark:hover:text-white transition-colors group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <item.icon className="h-3.5 w-3.5 shrink-0 text-slate-400 dark:text-slate-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                      <div className="min-w-0">
                        <span className="font-medium text-slate-800 dark:text-slate-200 group-hover:text-blue-600 dark:group-hover:text-blue-400">{item.label}</span>
                        <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-400">{item.hint}</span>
                      </div>
                    </div>
                    {item.highlight && (
                      <span className="shrink-0 rounded bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 px-1.5 py-0.5 text-[10px] font-medium">
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
export type Report = { artifactId: string; workflowId?: string; title: string; content?: string; citations?: any[]; createdAt: string; documentIds: string[]; graphId: string; seriesId: string; versionNumber: number; previousArtifactId?: string; isArchived?: boolean }
export type ReportComparison = { from: { versionNumber: number }; to: { versionNumber: number }; documents: { added: string[]; removed: string[]; updated: string[]; unchanged: number }; citations: { added: string[]; removed: string[] }; sections: { added: string[]; removed: string[]; changed: string[] }; contentChanged: boolean }
export type RelevanceAssessment = { assessmentId: string; phase: 'initial' | 'rewrite'; provider: string; query: string; resultCount: number; precisionAt10: number; status: 'good' | 'weak' | 'empty'; rewrittenQuery?: string }
export type Health = { connectorId: string; state: string; successRate: number; yieldRate: number; fieldCoverage: number; lastErrorMessage?: string }
export type Quality = { status: 'ready' | 'limited' | 'insufficient'; documentCount: number; qualifiedCount: number; warnings: string[]; metrics: { textCoverage: number; urlCoverage: number; commentCoverage: number } }
export type EntityRule = { ruleId: string; nodeType: string; operation: 'merge' | 'split' | 'ignore' | 'link'; sourceLabels: string[]; targetLabel: string; documentIds: string[]; createdAt: string }

const stateLabel: Record<string, string> = { healthy: '正常', degraded: '降级', blocked: '需处理验证', broken: '疑似结构变化', unknown: '暂无结论' }
const stateColor: Record<string, string> = { healthy: 'text-emerald-400', degraded: 'text-amber-400', blocked: 'text-orange-400', broken: 'text-rose-400', unknown: 'text-cyber-text-muted' }
const nodeColor: Record<string, string> = { subject: '#4a82b3', keyword: '#818cf8', platform: '#34d399', topic: '#e06a68' }

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
  co_occurs: '共现关联',
  competes_with: '竞品对手',
  belongs_to: '归属组织',
  produces: '生产研发',
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

  const docsSummaryQuery = useQuery({
    queryKey: ['analytics-summary', scope],
    queryFn: async () => {
      const res = await fetch(`/api/data/analytics/summary?${search}`)
      if (!res.ok) return null
      return res.json() as Promise<{ total_documents: number } | null>
    },
  })
  const totalDocs = docsSummaryQuery.data?.total_documents
  const isStale = Boolean(graph && totalDocs !== undefined && totalDocs !== (graph.documentCount || 0))

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

  const [activeTypeFilters, setActiveTypeFilters] = useState<Set<string>>(
    new Set(['subject', 'keyword', 'platform', 'topic'])
  )

  const toggleTypeFilter = (type: string) => {
    setActiveTypeFilters((prev) => {
      const next = new Set(prev)
      if (next.has(type)) {
        if (next.size > 1) {
          next.delete(type)
        } else {
          return new Set(['subject', 'keyword', 'platform', 'topic'])
        }
      } else {
        next.add(type)
      }
      return next
    })
  }

  const visibleNodes = useMemo(() => {
    return (graph?.nodes || [])
      .filter((node) => activeTypeFilters.has(node.type))
      .slice(0, 150)
      .map((node) => {
        if (node.type === 'platform') {
          return {
            ...node,
            label: platformLabel(platformLabels, node.label),
          }
        }
        return node
      })
  }, [graph?.nodes, platformLabels, activeTypeFilters])
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleEdges = useMemo(() => {
    return (graph?.edges || []).filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).slice(0, 300)
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
      {isStale && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-300 backdrop-blur-xs animate-in fade-in">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <span className="truncate">
              底层数据集已有更新（当前共有 <strong className="text-amber-200">{totalDocs}</strong> 篇文档，现保存快照基于 <strong className="text-amber-200">{graph?.documentCount || 0}</strong> 篇），建议重新构建图谱。
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 gap-1 border-amber-500/50 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30 text-[11px] font-medium"
            disabled={isRebuilding}
            onClick={rebuild}
          >
            <RefreshCw className={`h-3 w-3 ${isRebuilding ? 'animate-spin' : ''}`} />
            <span>重新构建图谱</span>
          </Button>
        </div>
      )}
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

          <div className="flex items-center gap-1.5 text-[10.5px] border-l border-cyber-border-subtle pl-3">
            {Object.entries({ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }).map(([type, label]) => {
              const isActive = activeTypeFilters.has(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleTypeFilter(type)}
                  className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all cursor-pointer ${
                    isActive
                      ? 'bg-cyber-bg-primary/80 border border-cyber-border-subtle/80 text-cyber-text-primary shadow-2xs font-medium'
                      : 'opacity-40 hover:opacity-75 text-cyber-text-muted border border-transparent'
                  }`}
                  title={`点击${isActive ? '隐藏' : '显示'}${label}类型实体`}
                >
                  <i className="h-2 w-2 rounded-full shrink-0" style={{ background: nodeColor[type] }} />
                  <span>{label}</span>
                </button>
              )
            })}
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
                      : (() => {
                          const fromNode = (graph?.nodes || []).find((n) => n.id === selectedElement.from)
                          const toNode = (graph?.nodes || []).find((n) => n.id === selectedElement.to)
                          const fromLabel = fromNode ? (fromNode.type === 'platform' ? platformLabel(platformLabels, fromNode.label) : fromNode.label) : ''
                          const toLabel = toNode ? (toNode.type === 'platform' ? platformLabel(platformLabels, toNode.label) : toNode.label) : ''
                          if (fromLabel && toLabel) {
                            return `${fromLabel} ↔ ${toLabel}`
                          }
                          return RELATION_LABELS[selectedElement.relation] || selectedElement.relation || '关联关系'
                        })()}
                  </h3>
                  {'type' in selectedElement ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: `${nodeColor[selectedElement.type] || '#4a82b3'}20`,
                        color: nodeColor[selectedElement.type] || '#334155',
                        border: `1px solid ${nodeColor[selectedElement.type] || '#4a82b3'}40`,
                      }}
                    >
                      {{ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }[selectedElement.type] || selectedElement.type}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-blue-500/10 dark:bg-blue-500/20 px-2 py-0.5 text-[10.5px] font-semibold text-blue-600 dark:text-blue-300 border border-blue-500/30">
                      <Link2 className="h-3 w-3" />
                      <span>{RELATION_LABELS[selectedElement.relation] || selectedElement.relation || '关联关系'}</span>
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
 * 格式化完整的 Markdown 研报正文（包含标题、正文、引用溯源资料与生成信息）
 * 确保“复制全文”与下载的 Markdown / Word / PDF 内容 100% 保持一致
 */
function formatFullReportMarkdown(report: Report): string {
  const parts: string[] = []
  const content = (report.content || '').trim()
  if (!content.startsWith('# ')) {
    parts.push(`# ${report.title}\n`)
  }
  parts.push(content)

  if (report.citations && report.citations.length > 0) {
    parts.push('\n\n## 引用资料\n')
    report.citations.forEach((source: any, idx: number) => {
      const sid = source.id || `S${idx + 1}`
      const title = source.title || source.source || '参考来源'
      const url = source.sourceUrl || '#'
      parts.push(`- [${sid}] [${title}](${url})`)
    })
    parts.push('\n---\n')
    parts.push(`报告制品：${report.artifactId}`)
    parts.push(`生成时间：${new Date(report.createdAt).toLocaleString()}`)
  }

  return parts.join('\n')
}

/**
 * 研报正文白底居中阅读 Modal (ReportPreviewModal)
 * - 顶部栏采用清爽浅灰色 (bg-slate-50)，与纯白正文形成雅致微区分
 * - 顶栏右侧配置“复制全文”（含完整引用与来源链接）、“导出报告”（已修复对齐防止裁剪）与单有关闭 X 图标
 * - 正文底部预留 80px (pb-20) 充足呼吸空间并附加优雅的“正文完”结束符，符合顶级阅读器规范
 */
function ReportPreviewModal({
  report,
  onOpenChange,
}: {
  report: Report | null
  onOpenChange: (open: boolean) => void
}) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopyContent = () => {
    if (!report?.content) return
    const fullMarkdown = formatFullReportMarkdown(report)
    navigator.clipboard.writeText(fullMarkdown)
    setIsCopied(true)
    toast.success('已复制完整报告（含引用来源与元数据）')
    setTimeout(() => setIsCopied(false), 2000)
  }

  return (
    <Dialog open={Boolean(report)} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        className="max-w-4xl w-[90vw] max-h-[86vh] flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 !bg-white bg-white !p-0 !gap-0 shadow-2xl text-slate-900"
      >
        {report ? (
          <>
            {/* 顶栏 Header - 浅灰背景 (bg-slate-50)，带有微弱边框与白底正文形成恰到好处的区分 */}
            <div className="px-6 sm:px-8 py-3.5 border-b border-slate-200/80 shrink-0 bg-slate-50 flex items-center justify-between gap-4">
              {/* 左侧：版本号徽章与元资料 */}
              <div className="flex items-center gap-2.5 min-w-0 flex-1 flex-wrap">
                <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-mono font-semibold bg-white text-slate-700 border border-slate-200 shadow-2xs leading-none">
                  v{report.versionNumber}
                </span>

                {report.isArchived ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100/70 text-amber-800 border border-amber-200/80">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    源数据已归档
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-emerald-100/70 text-emerald-800 border border-emerald-200/80">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    数据源完整
                  </span>
                )}

                <span className="text-slate-300 text-xs hidden sm:inline">|</span>

                <span className="text-xs text-slate-500 truncate">
                  固化引用 {report.documentIds?.length || 0} 个证据文档 · 生成于 {new Date(report.createdAt).toLocaleString()}
                </span>

                {/* 隐式 DialogTitle 保障 accessibility */}
                <DialogTitle className="sr-only">
                  {report.title}
                </DialogTitle>
              </div>

              {/* 右侧：复制全文、导出与单有关闭按钮 */}
              <div className="shrink-0 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyContent}
                  className="h-8 gap-1.5 px-3 text-xs font-medium text-slate-700 bg-white border-slate-200 hover:bg-slate-50 hover:text-slate-900 transition-all shadow-2xs rounded-lg"
                  title="一键复制完整报告 Markdown（含引用来源与元数据）"
                >
                  {isCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
                  <span>{isCopied ? '已复制完整内容' : '复制全文'}</span>
                </Button>

                <ReportDownloadDropdown artifactId={report.artifactId} />

                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition-colors"
                  title="关闭预览 (Esc)"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 纯白正文阅读区 - 预留 80px (pb-20) 底部舒适呼吸空间 */}
            <div className="flex-1 overflow-y-auto px-6 sm:px-14 pt-6 pb-20 !bg-white bg-white min-h-0">
              <div className="report-markdown-light text-slate-800 text-sm leading-relaxed">
                {report.content ? (
                  <>
                    <MarkdownContent
                      content={report.content}
                      sources={report.citations}
                    />
                    {/* 大厂规范：正文结尾标识与统计 */}
                    <div className="mt-12 pt-6 border-t border-slate-100 flex items-center justify-center text-xs text-slate-400 select-none">
                      <span>— 研报正文完 · 共 {report.content.length.toLocaleString()} 字 —</span>
                    </div>
                  </>
                ) : (
                  <div className="py-20 text-center text-slate-400 text-xs">
                    <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                    暂无报告正文内容
                  </div>
                )}
              </div>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
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
  const queryClient = useQueryClient()
  const [comparison, setComparison] = useState<ReportComparison | null>(null)
  const [incrementalWorkflowId, setIncrementalWorkflowId] = useState<string | null>(null)
  const [confirmIncrementalReport, setConfirmIncrementalReport] = useState<Report | null>(null)
  const [isSubmittingIncremental, setIsSubmittingIncremental] = useState(false)
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false)

  // 单个与批量删除状态
  const [reportToDelete, setReportToDelete] = useState<Report | null>(null)
  const [isDeletingReport, setIsDeletingReport] = useState(false)
  const [isBatchMode, setIsBatchMode] = useState(false)
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([])
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)
  const [isBatchConfirmOpen, setIsBatchConfirmOpen] = useState(false)

  // 标题修改与正文预览状态
  const [editingArtifactId, setEditingArtifactId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [isSubmittingTitle, setIsSubmittingTitle] = useState(false)
  const [previewReport, setPreviewReport] = useState<Report | null>(null)
  const [showQualityWarningsModal, setShowQualityWarningsModal] = useState(false)

  const handleSaveTitle = async (artifactId: string) => {
    if (!editingTitle.trim()) {
      toast.error('报告标题不能为空')
      return
    }
    setIsSubmittingTitle(true)
    try {
      await dataApi.updateReportTitle(artifactId, editingTitle.trim())
      await queryClient.invalidateQueries({ queryKey: ['research-reports'] })
      toast.success('已更新报告标题')
      setEditingArtifactId(null)
    } catch (err: any) {
      toast.error(err.message || '更新标题失败')
    } finally {
      setIsSubmittingTitle(false)
    }
  }

  const search = new URLSearchParams(Object.entries(scope).filter(([, value]) => value) as string[][]).toString()

  const handleDeleteSingleReport = async () => {
    if (!reportToDelete) return
    setIsDeletingReport(true)
    try {
      await dataApi.deleteReport(reportToDelete.artifactId)
      await queryClient.invalidateQueries({ queryKey: ['research-reports'] })
      toast.success(`已成功删除研报《${reportToDelete.title}》`)
      setReportToDelete(null)
    } catch (err: any) {
      toast.error(err.message || '删除研报失败')
    } finally {
      setIsDeletingReport(false)
    }
  }

  const handleDeleteBatchReports = async () => {
    if (!selectedReportIds.length) return
    setIsBatchDeleting(true)
    try {
      await dataApi.deleteReports(selectedReportIds)
      await queryClient.invalidateQueries({ queryKey: ['research-reports'] })
      toast.success(`已成功删除 ${selectedReportIds.length} 份研报`)
      setSelectedReportIds([])
      setIsBatchConfirmOpen(false)
    } catch (err: any) {
      toast.error(err.message || '批量删除研报失败')
    } finally {
      setIsBatchDeleting(false)
    }
  }

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

  const executeIncremental = async (workflowId: string) => {
    setIsSubmittingIncremental(true)
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
      setConfirmIncrementalReport(null)
    } catch (err: any) {
      toast.error(err.message || '增量任务创建失败')
    } finally {
      setIsSubmittingIncremental(false)
      setIncrementalWorkflowId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-3 sm:p-4">
      {/* 顶部：数据质量门禁概览卡片 */}
      <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 shadow-sm backdrop-blur-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">数据质量门禁</h3>
            {qualityQuery.data?.warnings && qualityQuery.data.warnings.length > 0 && (
              <button
                type="button"
                onClick={() => setShowQualityWarningsModal(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200/80 dark:text-amber-300 dark:bg-amber-950/40 dark:border-amber-800/60 transition-colors"
                title="点击查看采集与数据质量说明"
              >
                <Info className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                <span>{qualityQuery.data.warnings.length} 条数据提示</span>
              </button>
            )}
          </div>
          {qualityQuery.data && (
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium border flex items-center gap-1.5 ${
                qualityQuery.data.status === 'ready'
                  ? 'border-slate-200 bg-slate-100 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  : qualityQuery.data.status === 'limited'
                  ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                  : 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
              }`}
            >
              {qualityQuery.data.status === 'ready' ? (
                <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /><span>质量合格 · 可生成严谨研报</span></>
              ) : qualityQuery.data.status === 'limited' ? (
                <><AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /><span>有限结论 · 建议补充采集</span></>
              ) : (
                <><XCircle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" /><span>样本不足</span></>
              )}
            </span>
          )}
        </div>

        {qualityQuery.data ? (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 p-3">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">合格文档数</span>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                {qualityQuery.data.qualifiedCount} <span className="text-xs font-normal text-slate-400 dark:text-slate-500">/ {qualityQuery.data.documentCount}</span>
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 p-3">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">正文覆盖率</span>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                {Math.round(qualityQuery.data.metrics.textCoverage * 100)}%
              </p>
            </div>
            <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-850/60 p-3">
              <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">原始来源覆盖</span>
              <p className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                {Math.round(qualityQuery.data.metrics.urlCoverage * 100)}%
              </p>
            </div>
          </div>
        ) : (
          <p className="mt-2 text-xs text-slate-400">暂无质量门禁评估数据</p>
        )}
      </section>

      {/* 研报制品列表 */}
      <section className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/60 p-4 flex-1 shadow-sm backdrop-blur-sm">
        <div className="mb-3.5 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">版本化研究报告</h3>
            <span className="text-xs text-slate-400 dark:text-slate-500">
              (已生成 {(reportsQuery.data || []).length} 份版本制品)
            </span>
          </div>

          <div className="flex items-center gap-2">
            {isBatchMode ? (
              <div className="flex items-center gap-2 animate-in fade-in">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                  onClick={() => {
                    const allIds = (reportsQuery.data || []).map((r) => r.artifactId)
                    if (selectedReportIds.length === allIds.length) {
                      setSelectedReportIds([])
                    } else {
                      setSelectedReportIds(allIds)
                    }
                  }}
                >
                  {selectedReportIds.length === (reportsQuery.data || []).length ? '取消全选' : '全选'}
                </Button>
                {selectedReportIds.length > 0 && (
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 px-2.5 text-xs bg-rose-500 text-white hover:bg-rose-600 font-medium"
                    onClick={() => setIsBatchConfirmOpen(true)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>批量删除 ({selectedReportIds.length})</span>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                  onClick={() => {
                    setIsBatchMode(false)
                    setSelectedReportIds([])
                  }}
                >
                  退出批量
                </Button>
              </div>
            ) : (
              (reportsQuery.data || []).length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 px-2.5 text-xs border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => setIsBatchMode(true)}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span>批量管理</span>
                </Button>
              )
            )}
          </div>
        </div>

        {/* 报告版本对比结果面板 */}
        {comparison && (
          <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30 p-3.5 text-xs">
            <div className="flex items-center justify-between border-b border-blue-100 dark:border-blue-900/40 pb-2">
              <strong className="text-slate-900 dark:text-white text-sm flex items-center gap-2">
                <GitCompare className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <span className="inline-flex items-center gap-1.5">
                  报告演进差异对比：
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-medium bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 leading-none">
                    v{comparison.from.versionNumber}
                  </span>
                  <span className="text-slate-400 text-xs">➔</span>
                  <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-medium bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 leading-none">
                    v{comparison.to.versionNumber}
                  </span>
                </span>
              </strong>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-2 py-0.5"
                onClick={() => setComparison(null)}
              >
                关闭对比
              </button>
            </div>
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-600 dark:text-slate-300">
              <div>
                <span className="font-medium text-slate-900 dark:text-white">证据文档变化：</span>
                <p className="mt-1">
                  新增 <strong className="text-emerald-600 dark:text-emerald-400">{comparison.documents.added.length}</strong> 篇、更新 <strong className="text-amber-600 dark:text-amber-400">{comparison.documents.updated.length}</strong> 篇、移除 <strong className="text-rose-600 dark:text-rose-400">{comparison.documents.removed.length}</strong> 篇、沿用 {comparison.documents.unchanged} 篇
                </p>
              </div>
              <div>
                <span className="font-medium text-slate-900 dark:text-white">章节结构变化：</span>
                <p className="mt-1">
                  新增 <strong className="text-emerald-600 dark:text-emerald-400">{comparison.sections.added.length}</strong> 节、删除 <strong className="text-rose-600 dark:text-rose-400">{comparison.sections.removed.length}</strong> 节、内容修订 <strong className="text-blue-600 dark:text-blue-400">{comparison.sections.changed.length}</strong> 节
                </p>
              </div>
            </div>
            {comparison.sections.changed.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-400 truncate">
                发生修订的章节：{comparison.sections.changed.join('、')}
              </p>
            )}
          </div>
        )}

        <div className="space-y-2.5">
          {(reportsQuery.data || []).length > 0 ? (
            reportsQuery.data!.map((report) => (
              <div
                key={report.artifactId}
                className={`rounded-xl border p-3.5 sm:p-4 transition-all ${
                  isBatchMode && selectedReportIds.includes(report.artifactId)
                    ? 'border-blue-500/50 bg-blue-50/30 dark:bg-blue-950/20'
                    : 'border-slate-200/80 dark:border-slate-800/80 bg-white/80 dark:bg-slate-850/80 hover:border-slate-300 dark:hover:border-slate-700 shadow-sm'
                }`}
              >
                <div className="flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
                  <div className="flex items-center gap-3 min-w-0">
                    {isBatchMode && (
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-0 cursor-pointer"
                        checked={selectedReportIds.includes(report.artifactId)}
                        onChange={() => {
                          setSelectedReportIds((current) =>
                            current.includes(report.artifactId)
                              ? current.filter((id) => id !== report.artifactId)
                              : [...current, report.artifactId]
                          )
                        }}
                      />
                    )}
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {editingArtifactId === report.artifactId ? (
                          <div className="flex items-center gap-1.5 min-w-0">
                            <input
                              type="text"
                              className="h-7 rounded border border-blue-500/60 bg-white dark:bg-slate-900 px-2 text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-[260px] sm:max-w-[380px]"
                              value={editingTitle}
                              onChange={(e) => setEditingTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  handleSaveTitle(report.artifactId)
                                } else if (e.key === 'Escape') {
                                  setEditingArtifactId(null)
                                }
                              }}
                              autoFocus
                              disabled={isSubmittingTitle}
                            />
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50"
                              onClick={() => handleSaveTitle(report.artifactId)}
                              disabled={isSubmittingTitle}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-slate-600"
                              onClick={() => setEditingArtifactId(null)}
                              disabled={isSubmittingTitle}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 group/title min-w-0">
                            <h4
                              className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                              title="点击在线预览研报正文"
                              onClick={() => setPreviewReport(report)}
                            >
                              {report.title}
                            </h4>

                            {/* V1, V2 标识紧跟在标题后面 */}
                            <span className="shrink-0 inline-flex items-center rounded px-1.5 py-0.25 text-[10px] font-mono font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 leading-none">
                              v{report.versionNumber}
                            </span>

                            <button
                              type="button"
                              className="opacity-0 group-hover/title:opacity-100 transition-opacity p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                              title="修改报告标题"
                              onClick={() => {
                                setEditingArtifactId(report.artifactId)
                                setEditingTitle(report.title)
                              }}
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}

                        {/* 去掉绿色“数据源完整”标签，仅在归档模式时显示细型无压迫提示 */}
                        {report.isArchived && (
                          <span
                            className="inline-flex items-center gap-1 rounded px-1.5 py-0.25 text-[10px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/70 dark:border-amber-800/50"
                            title="原始抓取任务及文档已被清理，报告处于归档快照模式"
                          >
                            源数据已归档
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                        <span>固化引用 <strong className="font-semibold text-slate-800 dark:text-slate-200">{report.documentIds.length}</strong> 个文档</span>
                        <span>·</span>
                        <span>生成于 {new Date(report.createdAt).toLocaleString()}</span>
                      </p>
                    </div>
                  </div>

                  {/* 右侧操作按钮 */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {/* 导出 */}
                    <ReportDownloadDropdown artifactId={report.artifactId} />

                    {/* 功能辅助按钮 */}
                    {report.previousArtifactId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-2.5 text-xs border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => compareReport(report.artifactId)}
                      >
                        <GitCompare className="h-3.5 w-3.5" />
                        <span>对比 v{report.versionNumber - 1}</span>
                      </Button>
                    )}
                    {report.workflowId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 gap-1.5 px-2.5 text-xs border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        disabled={incrementalWorkflowId === report.workflowId}
                        onClick={() => setConfirmIncrementalReport(report)}
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${incrementalWorkflowId === report.workflowId ? 'animate-spin' : ''}`} />
                        <span>增量更新</span>
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                      onClick={() => setReportToDelete(report)}
                      title="删除此研报"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="py-12 text-center text-xs text-slate-400 space-y-2">
              <FileText className="h-8 w-8 mx-auto opacity-30 text-slate-500" />
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

      {/* 增量研究更新二次确认弹窗 */}
      <Dialog
        open={!!confirmIncrementalReport}
        onOpenChange={(open) => {
          if (!open && !isSubmittingIncremental) {
            setConfirmIncrementalReport(null)
          }
        }}
      >
        <DialogContent className="max-w-md border-cyber-border-subtle bg-cyber-bg-secondary/95 p-6 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10 text-cyber-neon-cyan shadow-[0_0_16px_rgba(34,211,238,0.15)]">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div className="text-left min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-cyber-text-primary">
                  发起增量研究更新
                </DialogTitle>
                <DialogDescription className="text-xs text-cyber-text-muted mt-0.5">
                  基于历史基线研报进行差异化递增分析
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="my-2 rounded-xl border border-cyber-border-subtle bg-cyber-bg-primary/50 p-3.5 space-y-2.5 text-xs">
            <div className="flex items-center justify-between text-cyber-text-muted">
              <span>基线研报：</span>
              <span className="font-medium text-cyber-text-primary truncate max-w-[220px]" title={confirmIncrementalReport?.title}>
                {confirmIncrementalReport?.title}
              </span>
            </div>
            <div className="flex items-center justify-between text-cyber-text-muted">
              <span>基线版本：</span>
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-mono font-medium bg-cyber-neon-cyan/10 text-cyber-neon-cyan border border-cyber-neon-cyan/25">
                v{confirmIncrementalReport?.versionNumber}
              </span>
            </div>
            <div className="border-t border-cyber-border-subtle/60 pt-2.5 text-cyber-text-secondary leading-relaxed">
              系统将以该报告对应任务为基线，仅分析基线完成之后<span className="text-cyber-neon-cyan font-medium">新增的证据文档与关联线索</span>，自动增量生成新版本研究报告。
            </div>
          </div>

          <DialogFooter className="gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="text-xs border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary"
              onClick={() => setConfirmIncrementalReport(null)}
              disabled={isSubmittingIncremental}
            >
              取消
            </Button>
            <Button
              size="sm"
              className="gap-1.5 bg-cyber-neon-cyan text-cyber-bg-primary hover:bg-cyber-neon-cyan/90 font-medium text-xs shadow-[0_0_12px_rgba(34,211,238,0.25)]"
              disabled={isSubmittingIncremental}
              onClick={() => {
                if (confirmIncrementalReport?.workflowId) {
                  executeIncremental(confirmIncrementalReport.workflowId)
                }
              }}
            >
              {isSubmittingIncremental ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在启动...</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>立即开始</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 单个研报删除确认弹窗 */}
      <Dialog open={Boolean(reportToDelete)} onOpenChange={(open) => { if (!open) setReportToDelete(null) }}>
        <DialogContent className="max-w-sm border-cyber-border-subtle bg-cyber-bg-secondary/95 p-5 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-cyber-text-primary flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-rose-400" />
              确认删除研报
            </DialogTitle>
            <DialogDescription className="text-xs text-cyber-text-muted mt-2 leading-relaxed">
              确定要删除研报《<span className="text-cyber-text-primary font-medium">{reportToDelete?.title}</span>》（v{reportToDelete?.versionNumber}）吗？删除后该报告文件无法找回，但不会影响底座抓取的数据源。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-8 text-xs text-cyber-text-muted hover:text-cyber-text-primary" onClick={() => setReportToDelete(null)} disabled={isDeletingReport}>
              取消
            </Button>
            <Button size="sm" className="h-8 text-xs bg-rose-500 text-white hover:bg-rose-600 font-medium" onClick={handleDeleteSingleReport} disabled={isDeletingReport}>
              {isDeletingReport ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 批量删除研报确认弹窗 */}
      <Dialog open={isBatchConfirmOpen} onOpenChange={setIsBatchConfirmOpen}>
        <DialogContent className="max-w-sm border-cyber-border-subtle bg-cyber-bg-secondary/95 p-5 backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold text-cyber-text-primary flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-rose-400" />
              确认批量删除研报
            </DialogTitle>
            <DialogDescription className="text-xs text-cyber-text-muted mt-2 leading-relaxed">
              确定要删除选中的 <strong className="text-rose-400">{selectedReportIds.length}</strong> 份研报制品吗？此操作不可逆，但不影响关联的数据抓取记录。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button size="sm" variant="ghost" className="h-8 text-xs text-cyber-text-muted hover:text-cyber-text-primary" onClick={() => setIsBatchConfirmOpen(false)} disabled={isBatchDeleting}>
              取消
            </Button>
            <Button size="sm" className="h-8 text-xs bg-rose-500 text-white hover:bg-rose-600 font-medium" onClick={handleDeleteBatchReports} disabled={isBatchDeleting}>
              {isBatchDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              确认批量删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 研报正文白底居中阅读 Modal */}
      <ReportPreviewModal
        report={previewReport}
        onOpenChange={(open) => { if (!open) setPreviewReport(null) }}
      />

      {/* 数据质量警告说明 Dialog */}
      <Dialog open={showQualityWarningsModal} onOpenChange={setShowQualityWarningsModal}>
        <DialogContent className="max-w-md border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Info className="h-4 w-4 text-amber-500" />
              数据质量与采集说明
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              以下为本任务在数据采集与校验过程中产生的提示信息：
            </DialogDescription>
          </DialogHeader>

          <div className="mt-3 space-y-2 max-h-60 overflow-y-auto pr-1">
            {qualityQuery.data?.warnings?.map((warning, idx) => (
              <div key={idx} className="rounded-lg border border-amber-200/80 bg-amber-50/60 dark:border-amber-900/50 dark:bg-amber-950/30 p-2.5 text-xs text-amber-900 dark:text-amber-200 leading-relaxed flex items-start gap-2">
                <span className="font-semibold text-amber-600 dark:text-amber-400">•</span>
                <span>{warning}</span>
              </div>
            ))}
          </div>

          <DialogFooter className="mt-4">
            <Button
              size="sm"
              variant="outline"
              className="text-xs border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
              onClick={() => setShowQualityWarningsModal(false)}
            >
              知道了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
