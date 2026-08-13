import { useQuery } from '@tanstack/react-query'
import { Activity, Download, FileText, Network, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Node = { id: string; type: string; label: string; weight: number; documentIds: string[] }
type Edge = { id: string; from: string; to: string; relation: string; weight: number }
type Graph = { id: string; documentCount: number; createdAt: string; nodes: Node[]; edges: Edge[] }
type Report = { artifactId: string; title: string; createdAt: string; documentIds: string[]; graphId: string }
type Health = { connectorId: string; state: string; successRate: number; yieldRate: number; fieldCoverage: number; lastErrorMessage?: string }

const stateLabel: Record<string, string> = { healthy: '正常', degraded: '降级', blocked: '需处理验证', broken: '疑似结构变化', unknown: '暂无结论' }
const stateColor: Record<string, string> = { healthy: 'text-emerald-400', degraded: 'text-amber-400', blocked: 'text-orange-400', broken: 'text-rose-400', unknown: 'text-cyber-text-muted' }
const nodeColor: Record<string, string> = { subject: '#22d3ee', keyword: '#a78bfa', platform: '#34d399', topic: '#fb923c' }

export function ResearchAssetsPanel({ scope }: { scope: { thread_id?: string; workflow_id?: string; run_id?: string } }) {
  const search = new URLSearchParams(Object.entries(scope).filter(([, value]) => value) as string[][]).toString()
  const graphQuery = useQuery({
    queryKey: ['research-graph', scope],
    queryFn: async () => (await fetch(`/api/graph?${search}`).then((res) => res.json())).graph as Graph,
  })
  const reportsQuery = useQuery({
    queryKey: ['research-reports', scope],
    queryFn: async () => (await fetch(`/api/reports?${search}`).then((res) => res.json())).items as Report[],
  })
  const healthQuery = useQuery({
    queryKey: ['connector-health'],
    queryFn: async () => (await fetch('/api/connectors/health').then((res) => res.json())).items as Health[],
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

  return (
    <div className="grid min-h-0 gap-4 overflow-auto p-1 lg:grid-cols-[1.5fr_1fr]">
      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4 lg:row-span-2">
        <div className="mb-3 flex items-center justify-between">
          <div><h3 className="flex items-center gap-2 text-sm font-semibold text-cyber-text-primary"><Network className="h-4 w-4 text-cyber-neon-cyan" />关系图谱</h3><p className="mt-1 text-[11px] text-cyber-text-muted">确定性字段投影，所有关系均可回溯原文</p></div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={rebuild}><RefreshCw className="h-3.5 w-3.5" />重建</Button>
        </div>
        {graph && visibleNodes.length ? (
          <>
            <div className="mb-2 flex gap-3 text-[10px] text-cyber-text-muted"><span>{graph.documentCount} 个文档</span><span>{graph.nodes.length} 个节点</span><span>{graph.edges.length} 条关系</span></div>
            <svg viewBox="0 0 100 100" className="aspect-[16/10] w-full rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/60">
              {visibleEdges.map((edge) => { const a = positions.get(edge.from); const b = positions.get(edge.to); return a && b ? <line key={edge.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#64748b" strokeOpacity="0.35" strokeWidth={Math.min(1.2, .25 + edge.weight * .12)} /> : null })}
              {visibleNodes.map((node) => { const p = positions.get(node.id)!; return <g key={node.id}><circle cx={p.x} cy={p.y} r={Math.min(4.2, 1.7 + Math.sqrt(node.weight) * .45)} fill={nodeColor[node.type] || '#94a3b8'} opacity=".9"><title>{node.label} · {node.weight} 个文档</title></circle><text x={p.x} y={p.y + 5.5} textAnchor="middle" fill="#cbd5e1" fontSize="2.5">{node.label.slice(0, 10)}</text></g> })}
            </svg>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-cyber-text-muted">{Object.entries({ subject: '主体', keyword: '关键词', platform: '平台', topic: '话题' }).map(([type, label]) => <span key={type} className="flex items-center gap-1"><i className="h-2 w-2 rounded-full" style={{ background: nodeColor[type] }} />{label}</span>)}</div>
          </>
        ) : <div className="grid h-72 place-items-center text-xs text-cyber-text-muted">当前范围暂无可投影关系</div>}
      </section>

      <section className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/35 p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-cyber-text-primary"><FileText className="h-4 w-4 text-cyber-neon-cyan" />报告制品</h3>
        <div className="space-y-2">
          {(reportsQuery.data || []).length ? reportsQuery.data!.map((report) => <div key={report.artifactId} className="rounded-lg border border-cyber-border-subtle bg-cyber-bg-primary/40 p-3"><p className="truncate text-xs font-medium text-cyber-text-primary">{report.title}</p><p className="mt-1 text-[10px] text-cyber-text-muted">固化 {report.documentIds.length} 个证据文档 · {new Date(report.createdAt).toLocaleString()}</p><div className="mt-2 flex gap-1.5">{(['html', 'markdown', 'json'] as const).map((format) => <a key={format} href={`/api/reports/${report.artifactId}/download?format=${format}`} download><Button size="sm" variant="outline" className="h-7 px-2 text-[10px]"><Download className="h-3 w-3" />{format.toUpperCase()}</Button></a>)}</div></div>) : <p className="py-6 text-center text-xs text-cyber-text-muted">完成一次 AI 分析后，会在这里生成可复现报告</p>}
        </div>
      </section>

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
