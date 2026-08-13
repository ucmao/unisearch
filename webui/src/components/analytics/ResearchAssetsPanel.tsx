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
  Info,
  Maximize2,
  Minimize2,
  Network,
  RefreshCw,
  Sparkles,
  Split,
  Undo2,
  X,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
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
export type EntityRule = { ruleId: string; nodeType: string; operation: 'merge' | 'split'; sourceLabels: string[]; targetLabel: string; documentIds: string[]; createdAt: string }

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
  const [isExpanded, setIsExpanded] = useState(false)
  const [mergeNodeIds, setMergeNodeIds] = useState<string[]>([])
  const [splitDocumentIds, setSplitDocumentIds] = useState<string[]>([])
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
    await fetch('/api/graph/rebuild', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(scope) })
    await graphQuery.refetch()
  }

  const mergeEntities = async () => {
    const selected = (graph?.nodes || []).filter((node) => mergeNodeIds.includes(node.id))
    const defaultName = selected[0]?.label || ''
    const targetLabel = window.prompt(`正在合并 ${selected.length} 个实体，请输入合并后的统一名称：`, defaultName)?.trim()
    if (!targetLabel || !graph) return
    const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_ids: mergeNodeIds, target_label: targetLabel }),
    })
    const result = await response.json()
    if (!response.ok) return window.alert(result.detail || '实体合并失败')
    setMergeNodeIds([])
    setSelectedElement(null)
    await graphQuery.refetch()
    await rulesQuery.refetch()
  }

  const splitEntity = async () => {
    if (!graph || !selectedElement || !('label' in selectedElement)) return
    const targetLabel = window.prompt(`已勾选 ${splitDocumentIds.length} 篇证据文档，请输入拆分出的新概念/实体名称：`)?.trim()
    if (!targetLabel) return
    const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entities/split`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node_id: selectedElement.id, document_ids: splitDocumentIds, target_label: targetLabel }),
    })
    const result = await response.json()
    if (!response.ok) return window.alert(result.detail || '实体拆分失败')
    setSplitDocumentIds([])
    setSelectedElement(null)
    await graphQuery.refetch()
    await rulesQuery.refetch()
  }

  const removeRule = async (ruleId: string) => {
    if (!graph) return
    const response = await fetch(`/api/graph/${encodeURIComponent(graph.id)}/entity-rules/${encodeURIComponent(ruleId)}`, { method: 'DELETE' })
    if (!response.ok) return window.alert((await response.json()).detail || '撤销规则失败')
    await graphQuery.refetch()
    await rulesQuery.refetch()
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
        <div className="flex items-center gap-2 flex-wrap">
          {mergeNodeIds.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-3 text-xs border-violet-500/60 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30 font-medium animate-pulse"
              onClick={mergeEntities}
              disabled={mergeNodeIds.length < 2}
            >
              <Combine className="h-3.5 w-3.5" />
              <span>合并选中的 {mergeNodeIds.length} 个实体</span>
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2.5 text-xs text-cyber-text-muted hover:text-cyber-text-primary border-cyber-border-subtle"
              onClick={() => {
                window.alert('💡 实体合并操作指引：\n1. 点击图谱中的某个实体节点；\n2. 在右侧详情中点击「加入合并清单」；\n3. 选中至少 2 个同义实体后，点击顶部的「合并实体」即可统一名称。')
              }}
              title="查看实体合并方法"
            >
              <Combine className="h-3.5 w-3.5" />
              <span>合并同义实体</span>
            </Button>
          )}

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
            className={`h-7 gap-1.5 px-2.5 text-xs transition-colors ${
              isExpanded
                ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/15 text-cyber-neon-cyan'
                : 'text-cyber-text-muted hover:text-cyber-text-primary border-cyber-border-subtle'
            }`}
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? '还原为分栏工作区' : '全景展开大画布'}
          >
            {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            <span>{isExpanded ? '还原分栏' : '全景展开'}</span>
          </Button>
        </div>
      </div>

      {/* 实体合并待办栏 (当有选中时显现) */}
      {mergeNodeIds.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-1.5 text-xs">
          <div className="flex items-center gap-2">
            <Combine className="h-4 w-4 text-violet-300" />
            <span className="text-violet-200">
              已选待合并实体 ({mergeNodeIds.length})：
              <strong>
                {(graph?.nodes || [])
                  .filter((n) => mergeNodeIds.includes(n.id))
                  .map((n) => n.label)
                  .join('、')}
              </strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="text-cyber-text-muted hover:text-rose-400 text-xs px-2 py-0.5"
              onClick={() => setMergeNodeIds([])}
            >
              清空所选
            </button>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2.5 text-[11px] border-violet-500/50 bg-violet-500/20 text-violet-200 hover:bg-violet-500/30"
              disabled={mergeNodeIds.length < 2}
              onClick={mergeEntities}
            >
              立即执行合并
            </Button>
          </div>
        </div>
      )}

      {/* 主体画布与详情分栏 */}
      <div
        className={`grid flex-1 min-h-0 gap-3.5 ${
          isExpanded
            ? 'grid-cols-1 overflow-hidden'
            : selectedElement
              ? 'overflow-auto lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden'
              : 'grid-cols-1'
        }`}
      >
        {/* 左侧 / 全屏图谱画布 */}
        <section className="relative flex min-w-0 flex-col rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/25 p-3 sm:p-4 overflow-hidden">
          {graph && visibleNodes.length ? (
            <div className="flex flex-col flex-1 min-h-0 relative">
              <div className="mb-2 flex items-center justify-between text-[11px] text-cyber-text-muted">
                <span>
                  💡 交互提示：点击任意节点可在右侧查看支持该实体的全部证据网页；拖拽节点可探索力导向拓扑。
                </span>
                {selectedElement && (
                  <span className="text-cyber-neon-cyan font-medium shrink-0 ml-2">
                    ● 当前聚焦：{'label' in selectedElement ? selectedElement.label : selectedElement.relation}
                  </span>
                )}
              </div>

              <div className="relative flex-1 min-h-[420px] my-1 rounded-lg overflow-hidden border border-cyber-border-subtle/50 bg-cyber-bg-primary/60">
                <ObsidianForceGraph
                  nodes={visibleNodes}
                  edges={visibleEdges}
                  selectedElement={selectedElement}
                  onSelectElement={setSelectedElement}
                  nodeColors={nodeColor}
                />

                {/* 全屏模式下的右侧浮动抽屉 */}
                {isExpanded && selectedElement && (
                  <div className="absolute right-3 top-3 bottom-3 w-96 z-40 flex flex-col rounded-xl border border-cyber-neon-cyan/40 bg-cyber-bg-secondary/95 p-4 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-right-6">
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
                          关联 <strong className="text-cyber-neon-cyan">{selectedElement.weight}</strong> 篇证据文档 · 精准溯源
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

                    <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {'label' in selectedElement && onFilter ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 px-2.5 text-[11px] border-cyber-neon-cyan/40 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10"
                            onClick={() => onFilter(selectedElement)}
                          >
                            <Filter className="h-3 w-3" />
                            <span>在数据透视表中查看</span>
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
                            {mergeNodeIds.includes(selectedElement.id) ? '已加入合并' : '加入合并清单'}
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {/* 文档列表 */}
                    <div className="mt-3 flex-1 min-h-0 space-y-2 overflow-y-auto pr-1">
                      {evidenceQuery.isLoading ? (
                        <div className="grid h-48 place-items-center text-xs text-cyber-text-muted">
                          <RefreshCw className="h-4 w-4 animate-spin mb-1 text-cyber-neon-cyan" />
                          <span>正在调取证据...</span>
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

                    {/* 拆分操作 */}
                    {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) && splitDocumentIds.length > 0 ? (
                      <div className="mt-2.5 flex items-center justify-between rounded-lg border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 p-2 text-xs">
                        <span className="text-[10px] text-cyber-text-primary">
                          已选 <strong>{splitDocumentIds.length}</strong> 篇文档
                        </span>
                        <Button size="sm" variant="outline" className="h-6 px-2.5 text-[10px] border-cyber-neon-cyan text-cyber-neon-cyan bg-cyber-bg-primary hover:bg-cyber-neon-cyan/20" onClick={splitEntity}>
                          <Split className="h-3 w-3 mr-1" />拆分新概念
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* 人工校正规则列表 */}
              {(rulesQuery.data || []).length > 0 && (
                <div className="mt-2 border-t border-cyber-border-subtle/50 pt-2">
                  <p className="mb-1 text-[11px] font-medium text-cyber-text-muted">已生效的人工治理规则 ({rulesQuery.data!.length})</p>
                  <div className="flex flex-wrap gap-2 max-h-16 overflow-y-auto">
                    {rulesQuery.data!.map((rule) => (
                      <div key={rule.ruleId} className="flex items-center gap-1.5 rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/50 px-2 py-0.5 text-[10px]">
                        <span className="text-cyber-text-primary">
                          {rule.operation === 'merge' ? `${rule.sourceLabels.join(' + ')} ➔ ${rule.targetLabel}` : `${rule.documentIds.length} 篇证据 ➔ ${rule.targetLabel}`}
                        </span>
                        <button type="button" className="text-cyber-text-muted hover:text-rose-400 p-0.5" title="撤销此规则" onClick={() => removeRule(rule.ruleId)}>
                          <Undo2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid h-72 place-items-center text-xs text-cyber-text-muted">
              当前任务范围暂无足够的关系数据以投影图谱
            </div>
          )}
        </section>

        {/* 右侧分栏详情抽屉 (非全景展开时) */}
        {!isExpanded && selectedElement && (
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
                  勾选证据文档可拆分实体
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
                  <span>拆分为新概念实体</span>
                </Button>
              </div>
            ) : null}
          </section>
        )}
      </div>
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
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ execute: true }),
      })
      const result = await response.json()
      if (!response.ok) return window.alert(result.detail || '增量任务创建失败')
      window.alert('增量任务已创建并进入执行队列')
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
