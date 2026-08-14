import { useQuery } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
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
  Network,
  RefreshCw,
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

export const REPORT_FORMAT_OPTIONS = [
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
export type Graph = { id: string; documentCount: number; createdAt: string; nodes: GraphNode[]; edges: Edge[] }
export type Report = { artifactId: string; workflowId?: string; title: string; createdAt: string; documentIds: string[]; graphId: string; seriesId: string; versionNumber: number; previousArtifactId?: string }
export type ReportComparison = { from: { versionNumber: number }; to: { versionNumber: number }; documents: { added: string[]; removed: string[]; updated: string[]; unchanged: number }; citations: { added: string[]; removed: string[] }; sections: { added: string[]; removed: string[]; changed: string[] }; contentChanged: boolean }
export type RelevanceAssessment = { assessmentId: string; phase: 'initial' | 'rewrite'; provider: string; query: string; resultCount: number; precisionAt10: number; status: 'good' | 'weak' | 'empty'; rewrittenQuery?: string }
export type Health = { connectorId: string; state: string; successRate: number; yieldRate: number; fieldCoverage: number; lastErrorMessage?: string }
export type Quality = { status: 'ready' | 'limited' | 'insufficient'; documentCount: number; qualifiedCount: number; warnings: string[]; metrics: { textCoverage: number; urlCoverage: number; commentCoverage: number } }
export type EntityRule = { ruleId: string; nodeType: string; operation: 'merge' | 'split' | 'ignore' | 'link'; sourceLabels: string[]; targetLabel: string; documentIds: string[]; createdAt: string }

export const stateLabel: Record<string, string> = { healthy: '正常', degraded: '降级', blocked: '需处理验证', broken: '疑似结构变化', unknown: '暂无结论' }
export const stateColor: Record<string, string> = { healthy: 'text-emerald-400', degraded: 'text-amber-400', blocked: 'text-orange-400', broken: 'text-rose-400', unknown: 'text-cyber-text-muted' }
export const nodeColor: Record<string, string> = { subject: '#22d3ee', keyword: '#a78bfa', platform: '#34d399', topic: '#fb923c' }

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

  const search = new URLSearchParams(Object.entries(scope).filter(([, value]) => value) as string[][]).toString()

  const graphQuery = useQuery({
    queryKey: ['research-graph', scope],
    queryFn: async () => (await fetch(`/api/graph?${search}`).then((res) => res.json())).graph as Graph,
  })

  const evidenceQuery = useQuery({
    queryKey: ['graph-evidence', graphQuery.data?.id, selectedElement?.id],
    queryFn: async () => fetch(`/api/graph/${encodeURIComponent(graphQuery.data!.id)}/evidence/${encodeURIComponent(selectedElement!.id)}`).then((res) => res.json()) as Promise<{ documents: Array<{ documentId: string; title: string; platform: string; excerpt: string; sourceUrl?: string }> }>,
    enabled: Boolean(graphQuery.data?.id && selectedElement?.id),
  })

  const rulesQuery = useQuery({
    queryKey: ['graph-entity-rules', graphQuery.data?.id],
    queryFn: async () => (await fetch(`/api/graph/${encodeURIComponent(graphQuery.data!.id)}/entity-rules`).then((res) => res.json())).items as EntityRule[],
    enabled: Boolean(graphQuery.data?.id),
  })

  const graph = graphQuery.data
  const visibleNodes = (graph?.nodes || []).slice(0, 60)
  const visibleIds = new Set(visibleNodes.map((node) => node.id))
  const visibleEdges = (graph?.edges || []).filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).slice(0, 120)

  const rebuild = async () => {
    try {
      await fetch('/api/graph/rebuild', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scope) })
      await graphQuery.refetch()
      toast.success('图谱拓扑已重新计算生成')
    } catch (err: any) {
      toast.error(err.message || '重建图谱失败')
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
    setMergeNodeIds([sourceNode.id, targetNode.id])
    setMergeTargetName(targetNode.label)
    setIsMergeModalOpen(true)
  }

  const handleQuickConnect = async (sourceNode: GraphNode, targetNode: GraphNode) => {
    if (!graph) return
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from_node_id: sourceNode.id, to_node_id: targetNode.id, relation: 'co_occurs' }),
      })
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '建立连线失败')
        return
      }
      toast.success(`已建立「${sourceNode.label}」↔「${targetNode.label}」的关联连线`)
      await graphQuery.refetch()
      await rulesQuery.refetch()
    } catch (err: any) {
      toast.error(err.message || '建立连线失败')
    }
  }

  const handleIgnoreEntity = async (nodeId: string, nodeLabel: string) => {
    if (!graph) return
    try {
      const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      })
      const result = await response.json()
      if (!response.ok) {
        toast.error(result.detail || '移出实体失败')
        return
      }
      toast.success(`已将噪点实体「${nodeLabel}」从图谱中移出`)
      setSelectedElement(null)
      setMergeNodeIds((current) => current.filter((id) => id !== nodeId))
      await graphQuery.refetch()
      await rulesQuery.refetch()
    } catch (err: any) {
      toast.error(err.message || '移出实体失败')
    }
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
            <span><strong>{graph?.nodes.length || 0}</strong> 实体节点</span>
            <span><strong>{graph?.edges.length || 0}</strong> 关联边</span>
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
            className="h-7 gap-1.5 px-2.5 text-xs text-cyber-text-muted hover:text-cyber-text-primary border-cyber-border-subtle"
            onClick={rebuild}
            title="重新计算图谱节点与边关系"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>重建图谱</span>
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

      {/* 实体合并待办栏 (唯一的合并操作与清单入口) */}
      {mergeNodeIds.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/70 px-3 py-1.5 text-xs animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-2 min-w-0">
            <Combine className="h-4 w-4 text-cyber-text-primary shrink-0" />
            <span className="text-cyber-text-primary truncate">
              已选待合并 ({mergeNodeIds.length})：
              <strong className="ml-1 text-cyber-text-primary font-semibold">
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
          {graph && visibleNodes.length ? (
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
            <div className="grid h-72 place-items-center text-xs text-cyber-text-muted rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/25">
              当前任务范围暂无足够的关系数据以投影图谱
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
                    {'label' in selectedElement ? selectedElement.label : selectedElement.relation}
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
                  共关联 <strong className="text-cyber-neon-cyan">{selectedElement.weight}</strong> 篇证据文档 · 精准溯源
                </p>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {'label' in selectedElement ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-cyber-text-muted hover:text-rose-400 hover:bg-rose-500/10"
                    onClick={() => handleIgnoreEntity(selectedElement.id, selectedElement.label)}
                    title="将此无意义或噪点实体从图谱中移出"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    <span>移出</span>
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-primary/60 shrink-0"
                  onClick={() => { setSelectedElement(null); setSplitDocumentIds([]) }}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  <span>关闭</span>
                </Button>
              </div>
            </div>

            {/* Action Toolbar */}
            <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                {'label' in selectedElement && onFilter ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 px-2.5 text-[11px] border-cyber-neon-cyan/40 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10"
                    onClick={() => onFilter(selectedElement)}
                  >
                    <Filter className="h-3 w-3" />在数据透视表中查看
                  </Button>
                ) : null}
                {'label' in selectedElement ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className={`h-7 gap-1 px-2.5 text-[11px] ${
                      mergeNodeIds.includes(selectedElement.id)
                        ? 'border-cyber-border-subtle bg-cyber-bg-secondary text-cyber-text-primary font-medium'
                        : 'border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary'
                    }`}
                    onClick={() => setMergeNodeIds((current) => current.includes(selectedElement.id) ? current.filter((id) => id !== selectedElement.id) : [...current, selectedElement.id])}
                  >
                    <Combine className="h-3 w-3" />
                    {mergeNodeIds.includes(selectedElement.id) ? '已加入待合并' : '加入合并清单'}
                  </Button>
                ) : null}
              </div>

              {'label' in selectedElement ? (
                <span className="text-[10px] text-cyber-text-muted">
                  勾选证据可分离为新节点
                </span>
              ) : null}
            </div>

            {/* Documents Evidence List */}
            <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
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
                      splitDocumentIds.includes(document.documentId)
                        ? 'border-cyber-neon-cyan/60 bg-cyber-neon-cyan/10'
                        : 'border-cyber-border-subtle bg-cyber-bg-primary/50 hover:border-cyber-neon-cyan/40 hover:bg-cyber-bg-primary/80'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      {'label' in selectedElement ? (
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
                                {document.platform}
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
            {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) && splitDocumentIds.length > 0 ? (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 p-2 text-xs">
                <span className="text-[11px] text-cyber-text-primary">
                  已勾选 <strong>{splitDocumentIds.length}</strong> 篇文档
                </span>
                <Button size="sm" variant="outline" className="h-7 gap-1 px-3 text-[11px] border-cyber-neon-cyan text-cyber-neon-cyan bg-cyber-bg-primary hover:bg-cyber-neon-cyan/20" onClick={openSplitModal}>
                  <Split className="h-3 w-3" />
                  <span>分离为新概念节点</span>
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
        <DialogContent className="max-w-md border-cyber-border-subtle bg-cyber-bg-secondary/95 p-6 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50">
                <Combine className="h-5 w-5 text-cyber-neon-cyan" />
              </div>
              <div className="text-left">
                <DialogTitle className="text-base font-semibold text-cyber-text-primary">
                  统一合并实体名称
                </DialogTitle>
                <DialogDescription className="text-xs text-cyber-text-muted mt-0.5">
                  将选中的 {mergeNodeIds.length} 个实体合并为一个标准实体
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div>
              <label className="text-xs text-cyber-text-muted font-medium block mb-1.5">
                选中的待合并实体：
              </label>
              <div className="flex flex-wrap gap-1.5 p-2 rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 max-h-24 overflow-y-auto">
                {(graph?.nodes || [])
                  .filter((n) => mergeNodeIds.includes(n.id))
                  .map((n) => (
                    <span
                      key={n.id}
                      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium border border-cyber-border-subtle bg-cyber-bg-secondary text-cyber-text-primary"
                    >
                      {n.label}
                    </span>
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
                className="h-9 text-xs"
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
        <DialogContent className="max-w-md border-cyber-border-subtle bg-cyber-bg-secondary/95 p-6 backdrop-blur-xl">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10">
                <Split className="h-5 w-5 text-cyber-neon-cyan" />
              </div>
              <div className="text-left">
                <DialogTitle className="text-base font-semibold text-cyber-text-primary">
                  拆分新概念/实体
                </DialogTitle>
                <DialogDescription className="text-xs text-cyber-text-muted mt-0.5">
                  将已选中的 {splitDocumentIds.length} 篇证据文档从原实体中拆出
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="text-xs text-cyber-text-muted">
              原实体节点：
              <span className="font-semibold text-cyber-text-primary ml-1">
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
                className="h-9 text-xs"
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
                            ? `${rule.sourceLabels.join(' ↔ ')} (${rule.targetLabel || '语义共现'})`
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
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-300 flex items-start gap-2">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
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
