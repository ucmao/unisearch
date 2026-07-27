import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import {
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  ExternalLink,
  FileSearch,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2,
  Users,
} from 'lucide-react'
import { dataApi, type AnalyticsGroup, type CanonicalDocument } from '@/lib/api'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ExportFormat = 'csv' | 'json' | 'markdown'

const BASE_COLUMNS = [
  ['title', '标题 / 摘要'],
  ['platform', '平台'],
  ['kind', '类型'],
  ['subject', '主体'],
  ['keyword', '关键词'],
  ['publishedAt', '发布时间'],
] as const

const DEFAULT_COLUMNS = new Set(BASE_COLUMNS.map(([key]) => key))

const kindLabels: Record<string, string> = {
  post: '帖子', article: '文章', video: '视频', image: '图片', comment: '评论',
  profile: '账号', search_result: '搜索结果', ai_answer: 'AI 回答', job: '招聘', complaint: '投诉',
}

const subjectTypeLabels: Record<string, string> = {
  creator: '创作者', publisher: '发布方', company: '公司', merchant: '商家',
  ai_platform: 'AI 平台', forum: '社区', unknown: '未知主体',
}

const metricLabels: Record<string, string> = {
  likes: '点赞', saves: '收藏', comments: '评论', shares: '分享', views: '浏览/播放',
  replies: '回复', voteups: '赞同', coins: '投币', danmaku: '弹幕',
}

const attributeLabels: Record<string, string> = {
  salary: '薪资', city: '城市', experience: '经验', education: '学历', status: '状态',
  amount: '金额', request: '诉求', domain: '域名', forumName: '社区', questionId: '问题 ID',
  mediaType: '媒体类型', tags: '标签', reasoningContent: '推理内容',
}

function formatNumber(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDate(value?: string | number) {
  if (value === undefined || value === null || value === '') return '—'
  const numeric = typeof value === 'number' ? value : Number(value)
  const date = Number.isFinite(numeric)
    ? new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000)
    : new Date(String(value))
  if (Number.isNaN(date.getTime())) return String(value)
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function formatRunTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

function displayValue(value: unknown, maxLength = 80): string {
  if (value === undefined || value === null || value === '') return '—'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text
}

function StatCard({ label, value, hint, icon: Icon }: {
  label: string
  value: number
  hint: string
  icon: typeof FileSearch
}) {
  return (
    <div className="glass-panel float-panel rounded-lg p-4 flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-cyber-text-muted font-mono">{label}</p>
        <p className="mt-1 text-2xl font-semibold text-cyber-text-primary">{formatNumber(value)}</p>
        <p className="mt-1 text-[11px] text-cyber-text-muted">{hint}</p>
      </div>
      <div className="rounded-md border border-cyber-neon-cyan/30 bg-cyber-neon-cyan/10 p-2 text-cyber-neon-cyan">
        <Icon className="h-4 w-4" />
      </div>
    </div>
  )
}

function MetricBars({ rows, metricKey, onSelect }: {
  rows: AnalyticsGroup[]
  metricKey: string
  onSelect: (keyword: string) => void
}) {
  const values = rows.map((row) => row.metrics[metricKey] || 0)
  const maximum = Math.max(1, ...values)
  return (
    <div className="space-y-2">
      {rows.slice(0, 10).map((row) => {
        const value = row.metrics[metricKey] || 0
        return (
          <button key={row.keyword} type="button" onClick={() => onSelect(row.keyword || 'all')} className="grid w-full grid-cols-[120px_1fr_72px] items-center gap-3 rounded px-2 py-2 text-left hover:bg-cyber-bg-tertiary/70">
            <span className="truncate text-xs text-cyber-text-primary">{row.keyword || '未标记'}</span>
            <span className="h-4 overflow-hidden rounded-sm bg-cyber-bg-tertiary"><span className="block h-full bg-cyber-neon-cyan/70" style={{ width: `${Math.max(2, value / maximum * 100)}%` }} /></span>
            <span className="text-right font-mono text-xs text-cyber-text-secondary">{formatNumber(value)}</span>
          </button>
        )
      })}
    </div>
  )
}

function DocumentDrawer({ document, platformLabel, onOpenChange }: {
  document: CanonicalDocument | null
  platformLabel: string
  onOpenChange: (open: boolean) => void
}) {
  const visibleAttributes = document
    ? Object.fromEntries(Object.entries(document.attributes).filter(([key]) => key !== 'reasoningContent'))
    : {}
  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent className="left-auto right-0 top-0 flex h-dvh w-[min(720px,94vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
        <DialogHeader className="shrink-0 border-b border-cyber-border-subtle p-5 pr-12">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{platformLabel}</Badge>
            <Badge variant="secondary">{kindLabels[document?.kind || ''] || document?.kind}</Badge>
            {document?.keyword ? <Badge variant="outline">{document.keyword}</Badge> : null}
          </div>
          <DialogTitle className="pt-2 text-left text-lg leading-snug text-cyber-text-primary">{document?.title || '无标题文档'}</DialogTitle>
          <DialogDescription className="text-left">{document?.summary || '无摘要'}</DialogDescription>
        </DialogHeader>
        {document ? (
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5">
            <section className="grid gap-3 sm:grid-cols-2">
              <Detail label="Document ID" value={document.documentId} mono />
              <Detail label="来源内容 ID" value={document.sourceItemId} mono />
              <Detail label="主体" value={document.subject.name || document.subject.id} />
              <Detail label="主体类型" value={subjectTypeLabels[document.subject.type] || document.subject.type} />
              <Detail label="发布时间" value={formatDate(document.publishedAt)} />
              <Detail label="采集时间" value={formatDate(document.fetchedAt)} />
              <Detail label="父级来源 ID" value={document.parentSourceItemId} mono />
              <Detail label="原始平台" value={document.originalPlatform} />
            </section>

            {Object.keys(document.metrics).length ? <RecordSection title="指标" record={document.metrics} labels={metricLabels} numeric /> : null}
            {Object.keys(visibleAttributes).length ? <RecordSection title="扩展属性" record={visibleAttributes} labels={attributeLabels} /> : null}

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyber-text-muted">正文</h3>
              <div className="whitespace-pre-wrap break-words rounded-md border border-cyber-border-subtle bg-cyber-bg-secondary/40 p-4 text-sm leading-7 text-cyber-text-primary">{document.markdown || '—'}</div>
            </section>

            {document.assets.length ? (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyber-text-muted">媒体资源</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {document.assets.map((asset) => <a key={asset.assetId} href={asset.url} target="_blank" rel="noreferrer" className="truncate rounded border border-cyber-border-subtle p-3 text-xs text-cyber-neon-cyan hover:bg-cyber-neon-cyan/5">{asset.kind} · {asset.url}</a>)}
                </div>
              </section>
            ) : null}

            {document.citations.length ? (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyber-text-muted">引用</h3>
                <div className="space-y-2">{document.citations.map((citation) => <a key={citation.url} href={citation.url} target="_blank" rel="noreferrer" className="block rounded border border-cyber-border-subtle p-3 text-xs text-cyber-neon-cyan hover:bg-cyber-neon-cyan/5">{citation.title || citation.source || citation.url}</a>)}</div>
              </section>
            ) : null}

            {document.sourceUrl ? <Button asChild variant="outline"><a href={document.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink />打开来源</a></Button> : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function Detail({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return <div className="min-w-0 rounded border border-cyber-border-subtle p-3"><p className="text-[10px] uppercase tracking-wider text-cyber-text-muted">{label}</p><p className={`mt-1 break-words text-xs text-cyber-text-secondary ${mono ? 'font-mono' : ''}`}>{displayValue(value, 300)}</p></div>
}

function RecordSection({ title, record, labels, numeric = false }: {
  title: string
  record: Record<string, unknown>
  labels: Record<string, string>
  numeric?: boolean
}) {
  return <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyber-text-muted">{title}</h3><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(record).map(([key, value]) => <Detail key={key} label={labels[key] || key} value={numeric && typeof value === 'number' ? formatNumber(value) : value} />)}</div></section>
}

export function ResultWorkbench({ initialScope = 'all' }: { initialScope?: string }) {
  const queryClient = useQueryClient()
  const statuses = useCrawlerStore((state) => state.statuses)
  const crawlerStatus = Object.values(statuses).some((status) => status === 'running') ? 'running' : 'idle'
  const previousCrawlerStatus = useRef(crawlerStatus)
  const initializedDynamicColumns = useRef(false)
  const [scope, setScope] = useState(initialScope)
  const [platform, setPlatform] = useState('all')
  const [kind, setKind] = useState('all')
  const [keyword, setKeyword] = useState('all')
  const [subjectType, setSubjectType] = useState('all')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('fetched_at')
  const [page, setPage] = useState(1)
  const [selectedDocument, setSelectedDocument] = useState<CanonicalDocument | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_COLUMNS))
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileScopeOpen, setMobileScopeOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')

  const tasksQuery = useQuery({
    queryKey: ['analytics-tasks'],
    queryFn: async () => (await dataApi.getAnalyticsTasks()).data,
    refetchInterval: crawlerStatus === 'running' ? 3000 : false,
  })
  const tasks = tasksQuery.data?.items || []
  const selectedRunId = scope.startsWith('run:') ? scope.slice(4) : undefined
  const selectedWorkflowId = scope.startsWith('plan:') ? scope.slice(5) : undefined
  const selectedThreadId = scope.startsWith('thread:') ? scope.slice(7) : undefined
  const filters = { run_id: selectedRunId, workflow_id: selectedWorkflowId, thread_id: selectedThreadId, platform, kind, keyword, subject_type: subjectType, query }

  const summaryQuery = useQuery({
    queryKey: ['analytics-summary', filters],
    queryFn: async () => (await dataApi.getAnalyticsSummary(filters)).data,
  })
  const documentsQuery = useQuery({
    queryKey: ['analytics-documents', filters, sortBy, page],
    queryFn: async () => (await dataApi.getAnalyticsDocuments({ ...filters, sort_by: sortBy, sort_order: 'desc', page, page_size: 20 })).data,
  })
  const summary = summaryQuery.data
  const documents = documentsQuery.data
  const platformLabels = useMemo(() => new Map(summary?.filters.platforms || []), [summary])

  const dynamicColumns = useMemo(() => [
    ...(summary?.filters.metric_keys || []).map((key) => ({ key: `metric:${key}`, label: metricLabels[key] || key, group: '指标' })),
    ...(summary?.filters.attribute_keys || [])
      .filter((key) => key !== 'reasoningContent')
      .map((key) => ({ key: `attribute:${key}`, label: attributeLabels[key] || key, group: '扩展属性' })),
  ], [summary])

  useEffect(() => setScope(initialScope), [initialScope])
  useEffect(() => { setPage(1); setSelectedDocument(null) }, [scope, platform, kind, keyword, subjectType, query, sortBy])
  useEffect(() => {
    if (initializedDynamicColumns.current || !dynamicColumns.length) return
    initializedDynamicColumns.current = true
    setVisibleColumns((current) => new Set([...current, ...dynamicColumns.slice(0, 6).map((column) => column.key)]))
  }, [dynamicColumns])
  useEffect(() => {
    const wasRunning = previousCrawlerStatus.current === 'running'
    if (wasRunning && crawlerStatus === 'idle') {
      queryClient.invalidateQueries({ queryKey: ['analytics-tasks'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-documents'] })
    }
    previousCrawlerStatus.current = crawlerStatus
  }, [crawlerStatus, queryClient])

  const toggleColumn = (key: string, checked: boolean) => setVisibleColumns((current) => {
    const next = new Set(current)
    if (checked) next.add(key); else next.delete(key)
    return next
  })

  const deleteScope = async (type: 'task' | 'round' | 'run', id: string) => {
    try {
      if (type === 'task') await dataApi.deleteAnalyticsTask(id)
      else if (type === 'round') await dataApi.deleteAnalyticsRound(id)
      else await dataApi.deleteAnalyticsRun(id)
      if (scope.endsWith(id)) setScope('all')
      await queryClient.invalidateQueries({ queryKey: ['analytics-tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['analytics-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['analytics-documents'] })
      toast.success('已删除所选数据')
    } catch (error) {
      toast.error(axios.isAxiosError(error) ? error.response?.data?.detail || error.message : '删除失败')
    }
  }

  const scopeTitle = selectedRunId
    ? `执行 ${selectedRunId.slice(0, 8)}`
    : selectedWorkflowId ? '当前采集轮次' : selectedThreadId ? '当前 AI 任务' : '全部任务的最新文档'

  const renderScopeTree = (mobile = false) => (
    <div className="space-y-2">
      <button type="button" onClick={() => { setScope('all'); if (mobile) setMobileScopeOpen(false) }} className={`w-full rounded border p-3 text-left ${scope === 'all' ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10' : 'border-cyber-border-subtle hover:bg-cyber-bg-tertiary/60'}`}><span className="block text-xs font-medium">全部任务</span><span className="text-[10px] text-cyber-text-muted">每个文档展示最新采集快照</span></button>
      {tasks.map((task) => (
        <div key={task.thread_id} className="rounded border border-cyber-border-subtle p-2">
          <div className="flex items-center gap-1"><button type="button" onClick={() => { setScope(`thread:${task.thread_id}`); if (mobile) setMobileScopeOpen(false) }} className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-xs hover:bg-cyber-bg-tertiary">{task.task_title || task.thread_id}</button><DeleteConfirmDialog title="删除整个任务及其采集数据？" description="该操作会物理删除任务下所有执行、文档来源和日志。" onConfirm={() => deleteScope('task', task.thread_id)} trigger={<Button variant="ghost" size="icon" className="h-7 w-7"><Trash2 className="h-3 w-3" /></Button>} /></div>
          <div className="ml-2 space-y-1 border-l border-cyber-border-subtle pl-2">{task.rounds.map((round) => <div key={round.plan_id}><div className="flex items-center gap-1"><button type="button" onClick={() => { setScope(`plan:${round.plan_id}`); if (mobile) setMobileScopeOpen(false) }} className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-[11px] text-cyber-text-secondary hover:bg-cyber-bg-tertiary">{round.round_title || round.plan_id}</button><DeleteConfirmDialog title="删除该采集轮次？" description="该轮次下的执行和文档来源将被物理删除。" onConfirm={() => deleteScope('round', round.plan_id)} trigger={<Button variant="ghost" size="icon" className="h-6 w-6"><Trash2 className="h-3 w-3" /></Button>} /></div><div className="ml-2">{round.runs.map((run) => <button key={run.run_id} type="button" onClick={() => { setScope(`run:${run.run_id}`); if (mobile) setMobileScopeOpen(false) }} className={`flex w-full items-center justify-between rounded px-2 py-1 text-[10px] ${scope === `run:${run.run_id}` ? 'bg-cyber-neon-cyan/10 text-cyber-neon-cyan' : 'text-cyber-text-muted hover:bg-cyber-bg-tertiary'}`}><span>{run.platform_label}</span><span>{formatRunTime(run.started_at)}</span></button>)}</div></div>)}</div>
        </div>
      ))}
    </div>
  )

  const selectedColumns = [
    ...BASE_COLUMNS.map(([key, label]) => ({ key, label, group: '通用字段' })),
    ...dynamicColumns,
  ].filter((column) => visibleColumns.has(column.key))

  const cell = (document: CanonicalDocument, key: string) => {
    if (key === 'title') return <div className="max-w-[360px]"><p className="truncate font-medium text-cyber-text-primary">{document.title || '无标题'}</p><p className="mt-1 line-clamp-2 text-[11px] text-cyber-text-muted">{document.summary || document.markdown || '—'}</p></div>
    if (key === 'platform') return <Badge variant="outline">{platformLabels.get(document.platform) || document.platform}</Badge>
    if (key === 'kind') return kindLabels[document.kind] || document.kind
    if (key === 'subject') return <div><p className="text-cyber-text-secondary">{document.subject.name || document.subject.id || '—'}</p><p className="text-[10px] text-cyber-text-muted">{subjectTypeLabels[document.subject.type] || document.subject.type}</p></div>
    if (key === 'keyword') return document.keyword || '—'
    if (key === 'publishedAt') return <span className="whitespace-nowrap">{formatDate(document.publishedAt)}</span>
    if (key.startsWith('metric:')) { const value = document.metrics[key.slice(7)]; return typeof value === 'number' ? <span className="font-mono">{formatNumber(value)}</span> : '—' }
    if (key.startsWith('attribute:')) return displayValue(document.attributes[key.slice(10)])
    return '—'
  }

  const exportUrl = dataApi.getAnalyticsExportUrl({ ...filters, sort_by: sortBy, format: exportFormat })
  const chartMetric = summary?.filters.metric_keys[0]

  return (
    <div className="flex h-full min-h-0 bg-cyber-bg-primary">
      <aside className={`hidden shrink-0 flex-col border-r border-cyber-border-subtle bg-cyber-bg-secondary/45 md:flex ${sidebarCollapsed ? 'w-14' : 'w-72'}`}>
        <div className="flex items-center justify-between border-b border-cyber-border-subtle p-3"><span className={`text-xs font-semibold ${sidebarCollapsed ? 'hidden' : ''}`}>任务范围</span><Button variant="ghost" size="icon" onClick={() => setSidebarCollapsed((value) => !value)}>{sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}</Button></div>
        {!sidebarCollapsed ? <div className="min-h-0 flex-1 overflow-y-auto p-3">{renderScopeTree()}</div> : null}
      </aside>

      <main className="min-w-0 flex-1 overflow-auto p-4">
        <div className="mx-auto max-w-[1800px] space-y-4">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div><h1 className="flex items-center gap-2 text-lg font-semibold"><BarChart3 className="h-5 w-5 text-cyber-neon-cyan" />Canonical Document 工作台</h1><p className="mt-1 text-xs text-cyber-text-muted">跨 Connector 的通用字段、动态指标与扩展属性</p><p className="mt-1 text-[11px] text-cyber-text-secondary">当前范围：{scopeTitle}</p></div>
            <div className="flex items-center gap-2"><Button variant="outline" size="sm" className="md:hidden" onClick={() => setMobileScopeOpen(true)}><History />任务范围</Button><Select value={exportFormat} onValueChange={(value) => setExportFormat(value as ExportFormat)}><SelectTrigger className="h-9 w-28 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="csv">CSV</SelectItem><SelectItem value="json">JSON</SelectItem><SelectItem value="markdown">Markdown</SelectItem></SelectContent></Select><Button variant="outline" size="sm" asChild><a href={exportUrl}><Download />统一导出</a></Button></div>
          </header>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label="文档总数" value={summary?.totals.document_count || 0} hint="包含正文与评论" icon={FileSearch} /><StatCard label="主体数" value={summary?.totals.subject_count || 0} hint="按主体 ID / 名称去重" icon={Users} /><StatCard label="正文" value={summary?.totals.content_count || 0} hint="非评论文档" icon={BarChart3} /><StatCard label="评论" value={summary?.totals.comment_count || 0} hint="保留父级关系" icon={BarChart3} /></div>

          {chartMetric && summary?.by_keyword.length ? <section className="glass-panel rounded-lg p-4"><div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-semibold">关键词对比</h2><p className="text-[11px] text-cyber-text-muted">按 {metricLabels[chartMetric] || chartMetric} 聚合；缺失指标不按 0 补齐</p></div></div><MetricBars rows={summary.by_keyword} metricKey={chartMetric} onSelect={setKeyword} /></section> : null}

          <section className="glass-panel rounded-lg p-4">
            <div className="mb-3 grid gap-3 xl:grid-cols-[repeat(4,minmax(130px,1fr))_minmax(220px,1.5fr)_auto]">
              <Select value={platform} onValueChange={setPlatform}><SelectTrigger><SelectValue placeholder="平台" /></SelectTrigger><SelectContent><SelectItem value="all">全部平台</SelectItem>{summary?.filters.platforms.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
              <Select value={kind} onValueChange={setKind}><SelectTrigger><SelectValue placeholder="类型" /></SelectTrigger><SelectContent><SelectItem value="all">全部类型</SelectItem>{summary?.filters.kinds.map((value) => <SelectItem key={value} value={value}>{kindLabels[value] || value}</SelectItem>)}</SelectContent></Select>
              <Select value={keyword} onValueChange={setKeyword}><SelectTrigger><SelectValue placeholder="关键词" /></SelectTrigger><SelectContent><SelectItem value="all">全部关键词</SelectItem>{summary?.filters.keywords.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
              <Select value={subjectType} onValueChange={setSubjectType}><SelectTrigger><SelectValue placeholder="主体类型" /></SelectTrigger><SelectContent><SelectItem value="all">全部主体</SelectItem>{summary?.filters.subject_types.map((value) => <SelectItem key={value} value={value}>{subjectTypeLabels[value] || value}</SelectItem>)}</SelectContent></Select>
              <form className="relative" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()) }}><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyber-text-muted" /><Input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索标题、摘要、正文、主体或来源 ID" className="pl-9" /></form>
              <Button variant="outline" onClick={() => setColumnDialogOpen(true)}><Columns3 />列设置</Button>
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-[11px] text-cyber-text-muted">排序：</span><Select value={sortBy} onValueChange={setSortBy}><SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fetched_at">最近采集</SelectItem><SelectItem value="published_at">发布时间</SelectItem><SelectItem value="rank">结果排名</SelectItem>{summary?.filters.metric_keys.map((key) => <SelectItem key={key} value={`metrics.${key}`}>{metricLabels[key] || key}</SelectItem>)}</SelectContent></Select></div>

            <div className="overflow-x-auto rounded border border-cyber-border-subtle"><table className="w-full min-w-[960px] border-collapse text-xs"><thead className="bg-cyber-bg-tertiary/80 text-cyber-text-muted"><tr>{selectedColumns.map((column) => <th key={column.key} className="whitespace-nowrap px-3 py-2 text-left font-medium">{column.label}</th>)}<th className="px-3 py-2 text-center font-medium">来源</th></tr></thead><tbody>{documents?.items.map((document) => <tr key={`${document.documentId}:${document.provenance.runId || 'latest'}`} onClick={() => setSelectedDocument(document)} className="cursor-pointer border-t border-cyber-border-subtle hover:bg-cyber-neon-cyan/5">{selectedColumns.map((column) => <td key={column.key} className="max-w-[280px] px-3 py-2.5 align-top text-cyber-text-secondary">{cell(document, column.key)}</td>)}<td className="px-3 py-2.5 text-center">{document.sourceUrl ? <a href={document.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex text-cyber-neon-cyan"><ExternalLink className="h-4 w-4" /></a> : '—'}</td></tr>)}</tbody></table>{!documentsQuery.isLoading && !documents?.items.length ? <div className="py-16 text-center text-xs text-cyber-text-muted">没有符合当前条件的 Canonical Document</div> : null}</div>
            <div className="mt-3 flex items-center justify-between text-xs text-cyber-text-muted"><span>共 {documents?.total || 0} 条 · 第 {documents?.page || 1} / {Math.max(documents?.pages || 1, 1)} 页</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft />上一页</Button><Button variant="outline" size="sm" disabled={!documents || page >= documents.pages} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></Button></div></div>
          </section>
        </div>
      </main>

      <Dialog open={columnDialogOpen} onOpenChange={setColumnDialogOpen}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>动态列设置</DialogTitle><DialogDescription>固定字段与当前结果中实际出现的指标、属性。缺失值保持为空。</DialogDescription></DialogHeader><div className="space-y-4">{['通用字段', '指标', '扩展属性'].map((group) => { const columns = [...BASE_COLUMNS.map(([key, label]) => ({ key, label, group: '通用字段' })), ...dynamicColumns].filter((column) => column.group === group); return columns.length ? <section key={group}><h3 className="mb-2 text-xs font-semibold text-cyber-text-muted">{group}</h3><div className="grid gap-2 sm:grid-cols-2">{columns.map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded border border-cyber-border-subtle p-2 text-xs"><Checkbox checked={visibleColumns.has(column.key)} onCheckedChange={(checked) => toggleColumn(column.key, checked)} />{column.label}</label>)}</div></section> : null })}</div></DialogContent></Dialog>
      <Dialog open={mobileScopeOpen} onOpenChange={setMobileScopeOpen}><DialogContent className="left-0 top-0 h-dvh w-[min(360px,92vw)] max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none"><DialogHeader><DialogTitle>任务范围</DialogTitle><DialogDescription>选择任务、采集轮次或单次执行</DialogDescription></DialogHeader>{renderScopeTree(true)}</DialogContent></Dialog>
      <DocumentDrawer document={selectedDocument} platformLabel={selectedDocument ? platformLabels.get(selectedDocument.platform) || selectedDocument.platform : ''} onOpenChange={(open) => { if (!open) setSelectedDocument(null) }} />
    </div>
  )
}
