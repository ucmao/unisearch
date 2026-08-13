import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Activity, Combine, Download, ExternalLink, FileText, Filter, GitCompare, Network, RefreshCw, Split, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Node = { id: string; type: string; label: string; weight: number; documentIds: string[] }
type Edge = { id: string; from: string; to: string; relation: string; weight: number }
type Graph = { id: string; documentCount: number; createdAt: string; nodes: Node[]; edges: Edge[] }
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
  onFilter?: (node: Node) => void
  onOpenDocument?: (documentId: string) => void
}) {
  const [selectedElement, setSelectedElement] = useState<Node | Edge | null>(null)
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
  const visibleNodes = (graph?.nodes || []).slice(0, 28)
  const visibleIds = new Set(visibleNodes.map((node) => node.id))
  const visibleEdges = (graph?.edges || []).filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to)).slice(0, 70)
  const positions = new Map(visibleNodes.map((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(visibleNodes.length, 1) - Math.PI / 2
    const radius = 38 + (index % 3) * 12
    return [node.id, { x: 50 + Math.cos(angle) * radius, y: 50 + Math.sin(angle) * radius }]
  }))

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
    <div className="grid min-h-0 gap-4 overflow-auto p-1 lg:grid-cols-[1.5fr_1fr]">
      {qualityQuery.data ? <div className={`lg:col-span-2 rounded-xl border p-3 ${qualityQuery.data.status === 'ready' ? 'border-emerald-500/25 bg-emerald-500/5' : qualityQuery.data.status === 'limited' ? 'border-amber-500/25 bg-amber-500/5' : 'border-rose-500/25 bg-rose-500/5'}`}><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-cyber-text-primary">质量门禁：{qualityQuery.data.status === 'ready' ? '可生成完整报告' : qualityQuery.data.status === 'limited' ? '仅支持有限结论' : '样本不足'}</p><p className="mt-1 text-[10px] text-cyber-text-muted">合格文档 {qualityQuery.data.qualifiedCount}/{qualityQuery.data.documentCount} · 正文覆盖 {Math.round(qualityQuery.data.metrics.textCoverage * 100)}% · 来源覆盖 {Math.round(qualityQuery.data.metrics.urlCoverage * 100)}%</p></div><span className="max-w-md text-right text-[10px] text-cyber-text-muted">{qualityQuery.data.warnings.join('；')}</span></div></div> : null}
      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4 lg:row-span-2">
        <div className="mb-3 flex items-center justify-between">
          <div><h3 className="flex items-center gap-2 text-sm font-semibold text-cyber-text-primary"><Network className="h-4 w-4 text-cyber-neon-cyan" />关系图谱</h3><p className="mt-1 text-[11px] text-cyber-text-muted">确定性字段投影，所有关系均可回溯原文</p></div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={rebuild}><RefreshCw className="h-3.5 w-3.5" />重建</Button>
        </div>
        {graph && visibleNodes.length ? (
          <>
            <div className="mb-2 flex gap-3 text-[10px] text-cyber-text-muted"><span>{graph.documentCount} 个文档</span><span>{graph.nodes.length} 个节点</span><span>{graph.edges.length} 条关系</span></div>
            <svg viewBox="0 0 100 100" className="aspect-[16/10] w-full rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/60">
              {visibleEdges.map((edge) => { const a = positions.get(edge.from); const b = positions.get(edge.to); return a && b ? <g key={edge.id} className="cursor-pointer" onClick={() => setSelectedElement(edge)}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="3" /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selectedElement?.id === edge.id ? '#22d3ee' : '#64748b'} strokeOpacity={selectedElement?.id === edge.id ? 1 : .35} strokeWidth={Math.min(1.2, .25 + edge.weight * .12)}><title>{edge.relation} · {edge.weight} 条证据</title></line></g> : null })}
              {visibleNodes.map((node) => { const p = positions.get(node.id)!; return <g key={node.id} className="cursor-pointer" onClick={() => setSelectedElement(node)}><circle cx={p.x} cy={p.y} r={Math.min(4.2, 1.7 + Math.sqrt(node.weight) * .45)} fill={nodeColor[node.type] || '#94a3b8'} stroke={selectedElement?.id === node.id ? '#fff' : 'none'} strokeWidth=".7" opacity=".9"><title>{node.label} · {node.weight} 个文档</title></circle><text x={p.x} y={p.y + 5.5} textAnchor="middle" fill="#cbd5e1" fontSize="2.5" pointerEvents="none">{node.label.slice(0, 10)}</text></g> })}
            </svg>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-cyber-text-muted">{Object.entries({ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }).map(([type, label]) => <span key={type} className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: nodeColor[type] }} />{label}</span>)}</div>
            {selectedElement ? <div className="mt-3 rounded-lg border border-cyber-neon-cyan/25 bg-cyber-bg-primary/50 p-3">
              <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-cyber-text-primary">{'label' in selectedElement ? selectedElement.label : selectedElement.relation}</p><p className="text-[10px] text-cyber-text-muted">关联 {selectedElement.weight} 个证据文档</p></div><div className="flex gap-1">{'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => setMergeNodeIds((current) => current.includes(selectedElement.id) ? current.filter((id) => id !== selectedElement.id) : [...current, selectedElement.id])}><Combine className="h-3 w-3" />{mergeNodeIds.includes(selectedElement.id) ? '已选择' : '加入合并'}</Button> : null}{'label' in selectedElement && onFilter ? <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => onFilter(selectedElement)}><Filter className="h-3 w-3" />在结果中查看</Button> : null}</div></div>
              <div className="mt-2 max-h-40 space-y-1.5 overflow-auto">{(evidenceQuery.data?.documents || []).map((document) => <div key={document.documentId} className="flex items-start gap-2 rounded-md border border-cyber-border-subtle p-2 hover:border-cyber-neon-cyan/40">{'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) ? <input type="checkbox" className="mt-1" checked={splitDocumentIds.includes(document.documentId)} onChange={() => setSplitDocumentIds((current) => current.includes(document.documentId) ? current.filter((id) => id !== document.documentId) : [...current, document.documentId])} aria-label="选择文档用于拆分实体" /> : null}<button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpenDocument?.(document.documentId)}><span className="block truncate text-[11px] font-medium text-cyber-text-primary">{document.title || '无标题'}</span><span className="mt-1 line-clamp-2 text-[10px] leading-4 text-cyber-text-muted">{document.excerpt}</span></button>{document.sourceUrl ? <a href={document.sourceUrl} target="_blank" rel="noreferrer" title="打开原始来源"><ExternalLink className="h-3 w-3 text-cyber-neon-cyan" /></a> : null}</div>)}</div>
              {'label' in selectedElement && ['subject', 'topic'].includes(selectedElement.type) && splitDocumentIds.length ? <Button size="sm" variant="outline" className="mt-2 h-7 text-[10px]" onClick={splitEntity}><Split className="h-3 w-3" />将所选 {splitDocumentIds.length} 篇拆为新实体</Button> : null}
            </div> : null}
            {mergeNodeIds.length ? <div className="mt-2 flex items-center justify-between rounded-lg border border-violet-500/25 bg-violet-500/5 p-2 text-[10px]"><span>已选择 {mergeNodeIds.length} 个实体</span><Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={mergeNodeIds.length < 2} onClick={mergeEntities}><Combine className="h-3 w-3" />合并实体</Button></div> : null}
            {(rulesQuery.data || []).length ? <div className="mt-3"><p className="mb-1 text-[10px] font-medium text-cyber-text-muted">人工校正规则</p><div className="max-h-24 space-y-1 overflow-auto">{rulesQuery.data!.map((rule) => <div key={rule.ruleId} className="flex items-center justify-between rounded border border-cyber-border-subtle px-2 py-1 text-[10px]"><span className="truncate">{rule.operation === 'merge' ? `${rule.sourceLabels.join(' + ')} → ${rule.targetLabel}` : `${rule.documentIds.length} 篇证据 → ${rule.targetLabel}`}</span><button type="button" className="text-cyber-text-muted hover:text-rose-400" title="撤销此规则" onClick={() => removeRule(rule.ruleId)}><Undo2 className="h-3 w-3" /></button></div>)}</div></div> : null}
          </>
        ) : <div className="grid h-72 place-items-center text-xs text-cyber-text-muted">当前范围暂无可投影关系</div>}
      </section>

      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyber-text-primary"><FileText className="h-4 w-4 text-cyber-neon-cyan" />报告制品</h3>
        <div className="space-y-2">
          {(reportsQuery.data || []).length ? reportsQuery.data!.map((report) => <div key={report.artifactId} className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/40 p-3"><div className="flex items-center gap-2"><p className="min-w-0 flex-1 truncate text-xs font-medium text-cyber-text-primary">{report.title}</p><span className="rounded bg-cyber-neon-cyan/10 px-1.5 py-0.5 text-[9px] text-cyber-neon-cyan">V{report.versionNumber}</span></div><p className="mt-1 text-[10px] text-cyber-text-muted">固化 {report.documentIds.length} 个证据文档 · {new Date(report.createdAt).toLocaleString()}</p><div className="mt-2 flex flex-wrap gap-1.5">{(['pdf', 'docx', 'html', 'markdown', 'json'] as const).map((format) => <a key={format} href={`/api/reports/${report.artifactId}/download?format=${format}`} download><Button size="sm" variant="outline" className={`h-7 px-2 text-[10px] ${format === 'pdf' || format === 'docx' ? 'border-cyber-neon-cyan/35' : ''}`}><Download className="h-3 w-3" />{format.toUpperCase()}</Button></a>)}{report.previousArtifactId ? <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" onClick={() => compareReport(report.artifactId)}><GitCompare className="h-3 w-3" />对比 V{report.versionNumber - 1}</Button> : null}{report.workflowId ? <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]" disabled={incrementalWorkflowId === report.workflowId} onClick={() => createIncremental(report.workflowId!)}><RefreshCw className={`h-3 w-3 ${incrementalWorkflowId === report.workflowId ? 'animate-spin' : ''}`} />增量更新</Button> : null}</div></div>) : <p className="py-6 text-center text-xs text-cyber-text-muted">完成一次 AI 分析后，会在这里生成可复现报告</p>}
          {comparison ? <div className="rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/5 p-3 text-[10px] text-cyber-text-muted"><div className="flex items-center justify-between"><strong className="text-cyber-text-primary">V{comparison.from.versionNumber} → V{comparison.to.versionNumber}</strong><button type="button" onClick={() => setComparison(null)}>关闭</button></div><p className="mt-1">证据：新增 {comparison.documents.added.length}、更新 {comparison.documents.updated.length}、移除 {comparison.documents.removed.length}、沿用 {comparison.documents.unchanged}</p><p>章节：新增 {comparison.sections.added.length}、删除 {comparison.sections.removed.length}、变化 {comparison.sections.changed.length}</p>{comparison.sections.changed.length ? <p className="mt-1 line-clamp-2">变化章节：{comparison.sections.changed.join('、')}</p> : null}</div> : null}
        </div>
      </section>

      {(relevanceQuery.data || []).length ? <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4"><h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyber-text-primary"><GitCompare className="h-4 w-4 text-cyber-neon-cyan" />搜索相关性</h3><div className="max-h-52 space-y-2 overflow-auto">{relevanceQuery.data!.map((item) => <div key={item.assessmentId} className="rounded border border-cyber-border-subtle p-2 text-[10px]"><div className="flex items-center justify-between gap-2"><span className="truncate text-cyber-text-primary">{item.provider} · {item.query}</span><span className={item.status === 'good' ? 'text-emerald-400' : item.status === 'weak' ? 'text-amber-400' : 'text-rose-400'}>{item.status === 'good' ? '相关性良好' : item.status === 'weak' ? '已触发改写' : '无结果'}</span></div><p className="mt-1 text-cyber-text-muted">P@10 {Math.round(item.precisionAt10 * 100)}% · {item.resultCount} 条结果 · {item.phase === 'initial' ? '首轮' : '改写轮'}</p>{item.rewrittenQuery ? <p className="mt-1 text-cyber-neon-cyan">改写为：{item.rewrittenQuery}</p> : null}</div>)}</div></section> : null}

      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyber-text-primary"><Activity className="h-4 w-4 text-cyber-neon-cyan" />连接器健康度</h3>
        <div className="max-h-52 space-y-2 overflow-auto">
          {(healthQuery.data || []).map((item) => <div key={item.connectorId} className="flex items-start justify-between gap-3 border-b border-cyber-border-subtle/60 pb-2 text-xs"><div className="min-w-0"><p className="font-medium text-cyber-text-primary">{item.connectorId}</p><p className="truncate text-[10px] text-cyber-text-muted" title={item.lastErrorMessage}>{item.lastErrorMessage || `字段完整率 ${Math.round(item.fieldCoverage * 100)}%`}</p></div><span className={`shrink-0 text-[10px] ${stateColor[item.state] || stateColor.unknown}`}>{stateLabel[item.state] || item.state}</span></div>)}
          {!healthQuery.data?.length ? <p className="py-6 text-center text-xs text-cyber-text-muted">完成采集后开始积累健康度</p> : null}
        </div>
      </section>
    </div>
  )
}
