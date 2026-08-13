import { useQuery } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import {
  Activity,
  ChevronDown,
  Combine,
  Download,
  ExternalLink,
  FileCode,
  FileJson,
  FileSpreadsheet,
  FileText,
  Filter,
  GitCompare,
  Maximize2,
  Minimize2,
  Network,
  RefreshCw,
  Split,
  Undo2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ObsidianForceGraph } from './ObsidianForceGraph'

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

function ReportDownloadDropdown({ artifactId }: { artifactId: string }) {
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

type GraphNode = { id: string; type: string; label: string; weight: number; documentIds: string[] }
type Edge = { id: string; from: string; to: string; relation: string; weight: number }
type Graph = { id: string; documentCount: number; createdAt: string; nodes: GraphNode[]; edges: Edge[] }
type Report = { artifactId: string; workflowId?: string; title: string; createdAt: string; documentIds: string[]; graphId: string; seriesId: string; versionNumber: number; previousArtifactId?: string }
type ReportComparison = { from: { versionNumber: number }; to: { versionNumber: number }; documents: { added: string[]; removed: string[]; updated: string[]; unchanged: number }; citations: { added: string[]; removed: string[] }; sections: { added: string[]; removed: string[]; changed: string[] }; contentChanged: boolean }
type RelevanceAssessment = { assessmentId: string; phase: 'initial' | 'rewrite'; provider: string; query: string; resultCount: number; precisionAt10: number; status: 'good' | 'weak' | 'empty'; rewrittenQuery?: string }
type Health = { connectorId: string; state: string; successRate: number; yieldRate: number; fieldCoverage: number; lastErrorMessage?: string }
type Quality = { status: 'ready' | 'limited' | 'insufficient'; documentCount: number; qualifiedCount: number; warnings: string[]; metrics: { textCoverage: number; urlCoverage: number; commentCoverage: number } }
type EntityRule = { ruleId: string; nodeType: string; operation: 'merge' | 'split'; sourceLabels: string[]; targetLabel: string; documentIds: string[]; createdAt: string }

const stateLabel: Record<string, string> = { healthy: '正常', degraded: '降级', blocked: '需处理验证', broken: '疑似结构变化', unknown: '暂无结论' }
const stateColor: Record<string, string> = { healthy: 'text-emerald-400', degraded: 'text-amber-400', blocked: 'text-orange-400', broken: 'text-rose-400', unknown: 'text-cyber-text-muted' }
const nodeColor: Record<string, string> = { subject: '#22d3ee', keyword: '#a78bfa', platform: '#34d399', topic: '#fb923c' }

export function ResearchAssetsPanel({
  scope,
  onFilter,
  onOpenDocument,
}: {
  scope: { thread_id?: string; workflow_id?: string; run_id?: string }
  onFilter?: (node: GraphNode) => void
  onOpenDocument?: (documentId: string) => void
}) {
  const [selectedElement, setSelectedElement] = useState<GraphNode | Edge | null>(null)
  const [isExpanded, setIsExpanded] = useState(false)
  const [mergeNodeIds, setMergeNodeIds] = useState<string[]>([])
  const [splitDocumentIds, setSplitDocumentIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<ReportComparison | null>(null)
  const [incrementalWorkflowId, setIncrementalWorkflowId] = useState<string | null>(null)
  const search = new URLSearchParams(Object.entries(scope).filter(([, value]) => value) as string[][]).toString()
  const graphQuery = useQuery({
    queryKey: ['research-graph', scope],
    queryFn: async () => (await fetch(`/api/graph?${search}`).then((res) => res.json())).graph as Graph,
  })
  const reportsQuery = useQuery({
    queryKey: ['research-reports', scope],
    queryFn: async () => (await fetch(`/api/reports?${search}`).then((res) => res.json())).items as Report[],
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
  const qualityQuery = useQuery({
    queryKey: ['quality-gate', scope],
    queryFn: async () => (await fetch(`/api/quality?${search}`).then((res) => res.json())).quality as Quality | null,
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
  const visibleNodes = (graph?.nodes || []).slice(0, 50)
  const visibleIds = new Set(visibleNodes.map((node) => node.id))
  const visibleEdges = (graph?.edges || []).filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).slice(0, 100)

  const rebuild = async () => {
    await fetch('/api/graph/rebuild', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scope) })
    await graphQuery.refetch()
  }

  const mergeEntities = async () => {
    const selected = (graph?.nodes || []).filter((node) => mergeNodeIds.includes(node.id))
    const targetLabel = window.prompt('合并后的实体名称', selected[0]?.label || '')?.trim()
    if (!targetLabel || !graph) return
    const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ node_ids: mergeNodeIds, target_label: targetLabel }) })
    const result = await response.json()
    if (!response.ok) return window.alert(result.detail || '实体合并失败')
    setMergeNodeIds([]); setSelectedElement(null); await graphQuery.refetch(); await rulesQuery.refetch()
  }

  const splitEntity = async () => {
    if (!graph || !selectedElement || !('label' in selectedElement)) return
    const targetLabel = window.prompt('拆分出的新实体名称')?.trim()
    if (!targetLabel) return
    const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/split`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ node_id: selectedElement.id, document_ids: splitDocumentIds, target_label: targetLabel }) })
    const result = await response.json()
    if (!response.ok) return window.alert(result.detail || '实体拆分失败')
    setSplitDocumentIds([]); setSelectedElement(null); await graphQuery.refetch(); await rulesQuery.refetch()
  }

  const removeRule = async (ruleId: string) => {
    if (!graph) return
    const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entity-rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' })
    if (!response.ok) return window.alert((await response.json()).detail || '撤销规则失败')
    await graphQuery.refetch(); await rulesQuery.refetch()
  }

  const compareReport = async (artifactId: string) => {
    const response = await fetch(`/api/reports/${encodeURIComponent(artifactId)}/compare`)
    const result = await response.json()
    if (!response.ok) return window.alert(result.detail || '报告版本对比失败')
    setComparison(result as ReportComparison)
  }

  const createIncremental = async (workflowId: string) => {
    if (!window.confirm('将以该报告对应任务为基线，只分析基线完成后新增的证据。立即开始吗？')) return
    setIncrementalWorkflowId(workflowId)
    try {
      const response = await fetch(`/api/agent/plans/${encodeURIComponent(workflowId)}/incremental`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ execute: true }),
      })
      const result = await response.json()
      if (!response.ok) return window.alert(result.detail || '增量任务创建失败')
      window.alert('增量任务已创建并进入执行队列')
    } finally { setIncrementalWorkflowId(null) }
  }

  return (
    <div
      className={`grid h-full min-h-0 gap-4 p-1 ${
        isExpanded
          ? 'grid-cols-1 overflow-hidden'
          : selectedElement
            ? 'overflow-auto lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden'
            : 'overflow-auto lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]'
      }`}
    >
      {/* LEFT COLUMN / FULL EXPANDED CANVAS: Relation Graph */}
      <section
        className={`relative flex min-w-0 flex-col rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4 ${
          isExpanded
            ? 'h-[74vh] min-h-[580px]'
            : selectedElement
              ? 'min-h-[500px] lg:h-full lg:min-h-0 lg:overflow-hidden'
              : 'min-h-[500px] lg:row-span-3'
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-cyber-text-primary">
              <Network className="h-4 w-4 text-cyber-neon-cyan" />关系图谱
            </h3>
            <p className="mt-1 text-[11px] text-cyber-text-muted">确定性字段投影，所有关系均可回溯原文</p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className={`h-8 gap-1.5 text-xs transition-colors ${
                isExpanded
                  ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/15 text-cyber-neon-cyan'
                  : 'text-cyber-text-muted hover:text-cyber-text-primary'
              }`}
              onClick={() => setIsExpanded((prev) => !prev)}
              title={isExpanded ? '还原为 6:4 分栏' : '全景展开大画布'}
            >
              {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span>{isExpanded ? '还原分栏' : '全景展开'}</span>
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={rebuild}>
              <RefreshCw className="h-3.5 w-3.5" />重建
            </Button>
          </div>
        </div>

        {graph && visibleNodes.length ? (
          <div className="flex flex-col flex-1 min-h-0 relative">
            <div className="mb-2 flex items-center justify-between text-[10px] text-cyber-text-muted">
              <div className="flex gap-3">
                <span>{graph.documentCount} 个文档</span>
                <span>{graph.nodes.length} 个节点</span>
                <span>{graph.edges.length} 条关系</span>
              </div>
              {selectedElement && (
                <span className="text-cyber-neon-cyan font-medium">
                  ● 当前聚焦：{'label' in selectedElement ? selectedElement.label : selectedElement.relation}
                </span>
              )}
            </div>

            <div className="relative flex-1 min-h-[380px] my-1">
              <ObsidianForceGraph
                nodes={visibleNodes}
                edges={visibleEdges}
                selectedElement={selectedElement}
                onSelectElement={setSelectedElement}
                nodeColors={nodeColor}
              />

              {/* In Full-Screen Expanded Mode: Floating Glass Inspector Drawer when element selected */}
              {isExpanded && selectedElement && (
                <div className="absolute right-3 top-3 bottom-3 w-96 z-40 flex flex-col rounded-xl border border-cyber-neon-cyan/40 bg-cyber-bg-secondary/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-right-6">
                  {/* Floating inspector header */}
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
                        关联 <strong className="text-cyber-neon-cyan">{selectedElement.weight}</strong> 篇证据文档
                      </p>
                    </div>

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

                  {/* Toolbar */}
                  <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap text-xs">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {'label' in selectedElement && onFilter ? (
                        <Button size="sm" variant="outline" className="h-7 gap-1 px-2 text-[10px] border-cyber-neon-cyan/40 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10" onClick={() => onFilter(selectedElement)}>
                          <Filter className="h-3 w-3" />应用到主结果并查看
                        </Button>
                      ) : null}
                      {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className={`h-7 gap-1 px-2 text-[10px] ${mergeNodeIds.includes(selectedElement.id) ? 'border-violet-500 bg-violet-500/20 text-violet-300' : 'border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary'}`}
                          onClick={() => setMergeNodeIds((current) => current.includes(selectedElement.id) ? current.filter((id) => id !== selectedElement.id) : [...current, selectedElement.id])}
                        >
                          <Combine className="h-3 w-3" />
                          {mergeNodeIds.includes(selectedElement.id) ? '已待合并' : '加入合并'}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {/* Documents list */}
                  <div className="mt-3 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                    {evidenceQuery.isLoading ? (
                      <div className="grid h-48 place-items-center text-xs text-cyber-text-muted">
                        <RefreshCw className="h-4 w-4 animate-spin mb-1 text-cyber-neon-cyan" />
                        <span>调取证据中...</span>
                      </div>
                    ) : (evidenceQuery.data?.documents || []).length ? (
                      evidenceQuery.data!.documents.map((document) => (
                        <div
                          key={document.documentId}
                          className={`group rounded-lg border p-2 transition-colors ${
                            splitDocumentIds.includes(document.documentId)
                              ? 'border-cyber-neon-cyan/60 bg-cyber-neon-cyan/10'
                              : 'border-cyber-border-subtle bg-cyber-bg-primary/50 hover:border-cyber-neon-cyan/40'
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? (
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
                              />
                            ) : null}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center justify-between gap-1.5">
                                <button
                                  type="button"
                                  className="text-left font-medium text-[11px] text-cyber-text-primary hover:text-cyber-neon-cyan truncate"
                                  onClick={() => onOpenDocument?.(document.documentId)}
                                >
                                  {document.title || '无标题'}
                                </button>
                                {document.sourceUrl ? (
                                  <a href={document.sourceUrl} target="_blank" rel="noreferrer" className="text-cyber-text-muted hover:text-cyber-neon-cyan">
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : null}
                              </div>
                              {document.excerpt ? (
                                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-cyber-text-muted">
                                  {document.excerpt}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="grid h-32 place-items-center text-xs text-cyber-text-muted">
                        暂无匹配文档
                      </div>
                    )}
                  </div>

                  {/* Split Action */}
                  {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) && splitDocumentIds.length > 0 ? (
                    <div className="mt-2.5 flex items-center justify-between rounded-lg border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 p-2 text-xs">
                      <span className="text-[10px] text-cyber-text-primary">
                        已选 <strong>{splitDocumentIds.length}</strong> 篇
                      </span>
                      <Button size="sm" variant="outline" className="h-6 px-2.5 text-[10px] border-cyber-neon-cyan text-cyber-neon-cyan bg-cyber-bg-primary hover:bg-cyber-neon-cyan/20" onClick={splitEntity}>
                        <Split className="h-3 w-3 mr-1" />拆分
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-cyber-text-muted">
              <div className="flex flex-wrap gap-3">
                {Object.entries({ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }).map(([type, label]) => (
                  <span key={type} className="flex items-center gap-1">
                    <i className="h-2 w-2 rounded-full" style={{ background: nodeColor[type] }} />
                    {label}
                  </span>
                ))}
              </div>
              {!selectedElement && (
                <span className="text-[10px] text-cyber-neon-cyan/75">
                  💡 点击节点在右侧查看关联证据
                </span>
              )}
            </div>

            {mergeNodeIds.length ? (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/10 p-2.5 text-[11px]">
                <span className="text-violet-300 font-medium">已选择 {mergeNodeIds.length} 个实体待合并</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" className="h-6 text-[10px] text-cyber-text-muted hover:text-rose-400" onClick={() => setMergeNodeIds([])}>
                    清空
                  </Button>
                  <Button size="sm" variant="outline" className="h-6 px-2.5 text-[10px] border-violet-500/40 text-violet-300 hover:bg-violet-500/20" disabled={mergeNodeIds.length < 2} onClick={mergeEntities}>
                    <Combine className="h-3 w-3 mr-1" />执行合并
                  </Button>
                </div>
              </div>
            ) : null}

            {(rulesQuery.data || []).length ? (
              <div className="mt-3 border-t border-cyber-border-subtle/50 pt-2">
                <p className="mb-1 text-[10px] font-medium text-cyber-text-muted">人工校正规则 ({rulesQuery.data!.length})</p>
                <div className="max-h-20 space-y-1 overflow-auto">
                  {rulesQuery.data!.map((rule) => (
                    <div key={rule.ruleId} className="flex items-center justify-between rounded border border-cyber-border-subtle px-2 py-1 text-[10px]">
                      <span className="truncate">{rule.operation === 'merge' ? `${rule.sourceLabels.join(' + ')} → ${rule.targetLabel}` : `${rule.documentIds.length} 篇证据 → ${rule.targetLabel}`}</span>
                      <button type="button" className="text-cyber-text-muted hover:text-rose-400" title="撤销此规则" onClick={() => removeRule(rule.ruleId)}>
                        <Undo2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="grid h-72 place-items-center text-xs text-cyber-text-muted">当前范围暂无可投影关系</div>
        )}
      </section>

      {/* RIGHT COLUMN: Hidden in Expanded mode */}
      {!isExpanded && (
        selectedElement ? (
          /* DETAIL INSPECTOR */
          <section className="flex min-w-0 flex-col rounded-xl border border-cyber-neon-cyan/40 bg-cyber-bg-secondary/45 p-4 shadow-xl lg:h-full lg:min-h-0 lg:overflow-hidden">
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
                  关联 <strong className="text-cyber-neon-cyan">{selectedElement.weight}</strong> 篇证据文档 · 原文精准回溯
                </p>
              </div>

              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-primary/60 shrink-0"
                onClick={() => { setSelectedElement(null); setSplitDocumentIds([]) }}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                <span>关闭详情</span>
              </Button>
            </div>

            {/* Action Toolbar */}
            <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap text-xs">
              <div className="flex items-center gap-1.5 flex-wrap">
                {'label' in selectedElement && onFilter ? (
                  <Button size="sm" variant="outline" className="h-7 gap-1 px-2.5 text-[11px] border-cyber-neon-cyan/40 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10" onClick={() => onFilter(selectedElement)}>
                    <Filter className="h-3 w-3" />应用到主结果并查看
                  </Button>
                ) : null}
                {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className={`h-7 gap-1 px-2.5 text-[11px] ${mergeNodeIds.includes(selectedElement.id) ? 'border-violet-500 bg-violet-500/20 text-violet-300' : 'border-cyber-border-subtle text-cyber-text-muted hover:text-cyber-text-primary'}`}
                    onClick={() => setMergeNodeIds((current) => current.includes(selectedElement.id) ? current.filter((id) => id !== selectedElement.id) : [...current, selectedElement.id])}
                  >
                    <Combine className="h-3 w-3" />
                    {mergeNodeIds.includes(selectedElement.id) ? '已加入待合并' : '加入合并清单'}
                  </Button>
                ) : null}
              </div>

              {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? (
                <span className="text-[10px] text-cyber-text-muted">
                  勾选文档可拆分实体
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
                      {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? (
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
                          aria-label="选择文档用于拆分实体"
                        />
                      ) : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            className="text-left font-medium text-xs text-cyber-text-primary hover:text-cyber-neon-cyan transition-colors truncate"
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
                <Button size="sm" variant="outline" className="h-7 gap-1 px-3 text-[11px] border-cyber-neon-cyan text-cyber-neon-cyan bg-cyber-bg-primary hover:bg-cyber-neon-cyan/20" onClick={splitEntity}>
                  <Split className="h-3 w-3" />
                  <span>拆分为新实体</span>
                </Button>
              </div>
            ) : null}
          </section>
        ) : (
          <>
            <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4">
              <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
                <h3 className="flex items-center gap-2 text-sm font-semibold text-cyber-text-primary">
                  <FileText className="h-4 w-4 text-cyber-neon-cyan" />报告制品
                </h3>
                {qualityQuery.data && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium border ${
                      qualityQuery.data.status === 'ready'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                        : qualityQuery.data.status === 'limited'
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                        : 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    质量门禁：{qualityQuery.data.status === 'ready' ? '可生成完整报告' : qualityQuery.data.status === 'limited' ? '有限结论' : '样本不足'}
                  </span>
                )}
              </div>

              {qualityQuery.data && (
                <div
                  className={`mb-3 rounded-lg border p-2 text-[10px] ${
                    qualityQuery.data.status === 'ready'
                      ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                      : qualityQuery.data.status === 'limited'
                      ? 'border-amber-500/20 bg-amber-500/5 text-amber-300'
                      : 'border-rose-500/20 bg-rose-500/5 text-rose-300'
                  }`}
                >
                  <p className="font-medium">
                    合格文档 {qualityQuery.data.qualifiedCount}/{qualityQuery.data.documentCount} · 正文覆盖 {Math.round(qualityQuery.data.metrics.textCoverage * 100)}% · 来源覆盖 {Math.round(qualityQuery.data.metrics.urlCoverage * 100)}%
                  </p>
                  {qualityQuery.data.warnings.length > 0 && (
                    <p className="mt-0.5 text-cyber-text-muted">
                      {qualityQuery.data.warnings.join('；')}
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {(reportsQuery.data || []).length ? reportsQuery.data!.map((report) => (
                  <div key={report.artifactId} className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/40 p-3">
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-xs font-medium text-cyber-text-primary">{report.title}</p>
                      <span className="rounded bg-cyber-neon-cyan/10 px-1.5 py-0.5 text-[9px] text-cyber-neon-cyan">V{report.versionNumber}</span>
                    </div>
                    <p className="mt-1 text-[10px] text-cyber-text-muted">
                      固化 {report.documentIds.length} 个证据文档 · {new Date(report.createdAt).toLocaleString()}
                    </p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <ReportDownloadDropdown artifactId={report.artifactId} />
                      {report.previousArtifactId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2.5 text-[10px] text-cyber-text-muted hover:text-cyber-text-primary"
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
                          className="h-7 gap-1 px-2.5 text-[10px] text-cyber-text-muted hover:text-cyber-text-primary"
                          disabled={incrementalWorkflowId === report.workflowId}
                          onClick={() => createIncremental(report.workflowId!)}
                        >
                          <RefreshCw className={`h-3 w-3 ${incrementalWorkflowId === report.workflowId ? 'animate-spin' : ''}`} />
                          <span>增量更新</span>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )) : <p className="py-6 text-center text-xs text-cyber-text-muted">完成一次 AI 分析后，会在这里生成可复现报告</p>}
                {comparison ? <div className="rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/5 p-3 text-[10px] text-cyber-text-muted"><div className="flex items-center justify-between"><strong className="text-cyber-text-primary">V{comparison.from.versionNumber} → V{comparison.to.versionNumber}</strong><button type="button" onClick={() => setComparison(null)}>关闭</button></div><p className="mt-1">证据：新增 {comparison.documents.added.length}、更新 {comparison.documents.updated.length}、移除 {comparison.documents.removed.length}、沿用 {comparison.documents.unchanged}</p><p>章节：新增 {comparison.sections.added.length}、删除 {comparison.sections.removed.length}、变化 {comparison.sections.changed.length}</p>{comparison.sections.changed.length ? <p className="mt-1 line-clamp-2">变化章节：{comparison.sections.changed.join('、')}</p> : null}</div> : null}
              </div>
            </section>

            {(relevanceQuery.data || []).length ? (
              <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyber-text-primary">
                  <GitCompare className="h-4 w-4 text-cyber-neon-cyan" />搜索相关性
                </h3>
                <div className="max-h-52 space-y-2 overflow-auto">
                  {relevanceQuery.data!.map((item) => (
                    <div key={item.assessmentId} className="rounded border border-cyber-border-subtle p-2 text-[10px]">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-cyber-text-primary">{item.provider} · {item.query}</span>
                        <span className={item.status === 'good' ? 'text-emerald-400' : item.status === 'weak' ? 'text-amber-400' : 'text-rose-400'}>
                          {item.status === 'good' ? '相关性良好' : item.status === 'weak' ? '已触发改写' : '无结果'}
                        </span>
                      </div>
                      <p className="mt-1 text-cyber-text-muted">P@10 {Math.round(item.precisionAt10 * 100)}% · {item.resultCount} 条结果 · {item.phase === 'initial' ? '首轮' : '改写轮'}</p>
                      {item.rewrittenQuery ? <p className="mt-1 text-cyber-neon-cyan">改写为：{item.rewrittenQuery}</p> : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyber-text-primary">
                <Activity className="h-4 w-4 text-cyber-neon-cyan" />连接器健康度
              </h3>
              <div className="max-h-52 space-y-2 overflow-auto">
                {(healthQuery.data || []).map((item) => (
                  <div key={item.connectorId} className="flex items-start justify-between gap-3 border-b border-cyber-border-subtle/60 pb-2 text-xs">
                    <div className="min-w-0">
                      <p className="font-medium text-cyber-text-primary">{item.connectorId}</p>
                      <p className="truncate text-[10px] text-cyber-text-muted" title={item.lastErrorMessage}>
                        {item.lastErrorMessage || `字段完整率 ${Math.round(item.fieldCoverage * 100)}%`}
                      </p>
                    </div>
                    <span className={`shrink-0 text-[10px] ${stateColor[item.state] || stateColor.unknown}`}>
                      {stateLabel[item.state] || item.state}
                    </span>
                  </div>
                ))}
                {!healthQuery.data?.length ? <p className="py-6 text-center text-xs text-cyber-text-muted">完成采集后开始积累健康度</p> : null}
              </div>
            </section>
          </>
        )
      )}
    </div>
  )
}
