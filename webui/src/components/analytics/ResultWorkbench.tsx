import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import {
  BarChart3,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileSearch,
  Heart,
  History,
  MessageCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Share2,
  Star,
  Trash2,
  Users,
} from 'lucide-react'
import { dataApi, type KeywordAnalytics, type NormalizedContent } from '@/lib/api'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

type MetricKey = 'engagement' | 'likes' | 'saves' | 'comments' | 'shares'

const metricLabels: Record<MetricKey, string> = {
  engagement: '总互动',
  likes: '点赞',
  saves: '收藏',
  comments: '评论',
  shares: '转发',
}

const sortOptions = [
  ['engagement', '总互动'],
  ['likes', '点赞'],
  ['saves', '收藏'],
  ['comments', '评论'],
  ['shares', '转发'],
  ['views', '播放量'],
  ['published_at', '发布时间'],
] as const

function formatNumber(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`
  return new Intl.NumberFormat('zh-CN').format(value)
}

function formatDate(timestamp: number) {
  if (!timestamp) return '未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp * 1000))
}

function formatRunTime(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value))
}

const runStatusLabel = {
  running: '采集中',
  completed: '已完成',
  failed: '失败',
  stopped: '已停止',
} as const

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

function KeywordBars({ rows, metric, selected, onSelect }: {
  rows: KeywordAnalytics[]
  metric: MetricKey
  selected: string
  onSelect: (keyword: string) => void
}) {
  const maximum = Math.max(1, ...rows.map((row) => row[metric]))
  return (
    <div className="space-y-2">
      {rows.slice(0, 10).map((row) => {
        const active = selected === row.keyword
        return (
          <button
            type="button"
            key={row.keyword}
            onClick={() => onSelect(active ? 'all' : row.keyword)}
            className={`w-full grid grid-cols-[minmax(90px,140px)_1fr_72px] items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
              active ? 'bg-cyber-neon-cyan/10' : 'hover:bg-cyber-bg-tertiary/70'
            }`}
          >
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-cyber-text-primary">{row.keyword}</span>
              <span className="block text-[10px] text-cyber-text-muted">{row.content_count} 篇</span>
            </span>
            <span className="h-5 overflow-hidden rounded-sm bg-cyber-bg-tertiary">
              <span
                className="block h-full bg-cyber-neon-cyan/70 transition-all duration-300"
                style={{ width: `${Math.max(2, row[metric] / maximum * 100)}%` }}
              />
            </span>
            <span className="text-right text-xs font-mono text-cyber-text-secondary">{formatNumber(row[metric])}</span>
          </button>
        )
      })}
    </div>
  )
}

function ContentCommentsDialog({ content, runId, taskId, onOpenChange }: {
  content: NormalizedContent | null
  runId?: string
  taskId?: string
  onOpenChange: (open: boolean) => void
}) {
  const [page, setPage] = useState(1)
  const commentsQuery = useQuery({
    queryKey: ['analytics-comment-threads', runId, taskId, content?.platform, content?.content_id, page],
    enabled: Boolean(content),
    queryFn: async () => (await dataApi.getAnalyticsCommentThreads({
      run_id: runId,
      task_id: taskId,
      platform: content!.platform,
      content_id: content!.content_id,
      page,
      page_size: 20,
    })).data,
  })

  useEffect(() => setPage(1), [content?.platform, content?.content_id])
  const threads = commentsQuery.data

  return (
    <Dialog open={Boolean(content)} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-3 overflow-hidden p-5">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate text-base">视频评论</DialogTitle>
          <DialogDescription className="truncate" title={content?.title}>
            {content?.title || content?.content_id || '当前视频'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-y border-cyber-border-subtle py-2 text-xs text-cyber-text-muted">
          <span>已采集 {threads?.total ?? 0} 条评论 · {threads?.root_total ?? 0} 条一级评论</span>
          <span className="font-mono">{content?.platform_label} / {content?.content_id}</span>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {commentsQuery.isLoading ? (
            <div className="py-16 text-center text-xs text-cyber-text-muted">正在加载评论…</div>
          ) : null}
          {threads?.items.map((thread) => (
            <article key={thread.comment_id} className="rounded-md border border-cyber-border-subtle bg-cyber-bg-secondary/40 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-cyber-text-secondary">{thread.creator_name || thread.creator_id || '未知用户'}</span>
                    <Badge variant="outline" className="text-[10px]">一级评论</Badge>
                    <span className="text-[10px] text-cyber-text-muted">{formatDate(thread.published_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-cyber-text-primary">{thread.content || '—'}</p>
                </div>
                <span className="shrink-0 text-[11px] text-cyber-text-muted">赞 {formatNumber(thread.likes)}</span>
              </div>

              {thread.replies.length ? (
                <div className="ml-3 mt-3 space-y-2 border-l-2 border-cyber-neon-cyan/20 pl-3 sm:ml-8">
                  {thread.replies.map((reply) => (
                    <div key={reply.comment_id} className="rounded bg-cyber-bg-tertiary/60 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="font-medium text-cyber-text-secondary">{reply.creator_name || reply.creator_id || '未知用户'}</span>
                        <Badge variant="outline" className="text-[9px]">二级回复</Badge>
                        <span className="text-cyber-text-muted">{formatDate(reply.published_at)}</span>
                        <span className="ml-auto text-cyber-text-muted">赞 {formatNumber(reply.likes)}</span>
                      </div>
                      <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-cyber-text-primary">{reply.content || '—'}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
          {threads?.orphan_replies.length ? (
            <section className="rounded-md border border-cyber-neon-yellow/30 bg-cyber-neon-yellow/5 p-3">
              <p className="mb-2 text-xs text-cyber-text-muted">未采集到对应一级评论的二级回复</p>
              <div className="space-y-2">
                {threads.orphan_replies.map((reply) => (
                  <div key={reply.comment_id} className="rounded bg-cyber-bg-tertiary/60 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-medium text-cyber-text-secondary">{reply.creator_name || reply.creator_id || '未知用户'}</span>
                      <Badge variant="outline" className="text-[9px]">二级回复</Badge>
                      <span className="text-cyber-text-muted">{formatDate(reply.published_at)}</span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-xs text-cyber-text-primary">{reply.content || '—'}</p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {!commentsQuery.isLoading && !threads?.items.length ? (
            <div className="py-16 text-center text-xs text-cyber-text-muted">这条视频暂无已采集评论</div>
          ) : null}
        </div>

        {(threads?.pages ?? 0) > 1 ? (
          <div className="flex items-center justify-between border-t border-cyber-border-subtle pt-3 text-xs text-cyber-text-muted">
            <span>一级评论第 {threads?.page ?? 1} / {threads?.pages ?? 1} 页</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                <ChevronLeft />上一页
              </Button>
              <Button variant="outline" size="sm" disabled={!threads || page >= threads.pages} onClick={() => setPage((value) => value + 1)}>
                下一页<ChevronRight />
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

export function ResultWorkbench({ initialScope = 'all' }: { initialScope?: string }) {
  const queryClient = useQueryClient()
  const statuses = useCrawlerStore((state) => state.statuses)
  const crawlerStatus = Object.values(statuses).some((s) => s === 'running')
    ? 'running'
    : Object.values(statuses).some((s) => s === 'stopping')
    ? 'stopping'
    : Object.values(statuses).some((s) => s === 'error')
    ? 'error'
    : 'idle'
  const previousCrawlerStatus = useRef(crawlerStatus)
  const [scope, setScope] = useState(initialScope)
  const [platform, setPlatform] = useState('all')
  const [keyword, setKeyword] = useState('all')
  const [metric, setMetric] = useState<MetricKey>('engagement')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('engagement')
  const [page, setPage] = useState(1)
  const [commentLevel, setCommentLevel] = useState('all')
  const [commentQueryInput, setCommentQueryInput] = useState('')
  const [commentQuery, setCommentQuery] = useState('')
  const [commentPage, setCommentPage] = useState(1)
  const [isRunHistoryOpen, setIsRunHistoryOpen] = useState(false)
  const [isTaskSidebarCollapsed, setIsTaskSidebarCollapsed] = useState(false)
  const [taskQuery, setTaskQuery] = useState('')
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set())
  const [selectedCommentContent, setSelectedCommentContent] = useState<NormalizedContent | null>(null)

  const runsQuery = useQuery({
    queryKey: ['analytics-runs'],
    queryFn: async () => (await dataApi.getAnalyticsRuns(1, 100)).data,
    refetchInterval: crawlerStatus === 'running' || crawlerStatus === 'stopping' ? 3_000 : false,
  })

  useEffect(() => {
    setScope(initialScope)
    if (initialScope.startsWith('task:')) {
      const taskId = initialScope.slice(5)
      setExpandedTasks((current) => new Set(current).add(taskId))
    }
  }, [initialScope])

  const selectedRunId = scope.startsWith('run:') ? scope.slice(4) : undefined
  const selectedTaskId = scope.startsWith('task:') ? scope.slice(5) : undefined

  const summaryQuery = useQuery({
    queryKey: ['analytics-summary', scope, platform, keyword],
    queryFn: async () => (await dataApi.getAnalyticsSummary(platform, keyword, selectedRunId, selectedTaskId)).data,
  })
  const contentsQuery = useQuery({
    queryKey: ['analytics-contents', scope, platform, keyword, query, sortBy, page],
    queryFn: async () => (await dataApi.getAnalyticsContents({
      run_id: selectedRunId, task_id: selectedTaskId, platform, keyword, query, sort_by: sortBy, sort_order: 'desc', page, page_size: 20,
    })).data,
  })
  const commentsQuery = useQuery({
    queryKey: ['analytics-comments', scope, platform, commentLevel, commentQuery, commentPage],
    queryFn: async () => (await dataApi.getAnalyticsComments({
      run_id: selectedRunId,
      task_id: selectedTaskId,
      platform,
      level: commentLevel === 'all' ? undefined : Number(commentLevel),
      query: commentQuery,
      page: commentPage,
      page_size: 20,
    })).data,
  })

  useEffect(() => {
    setKeyword('all')
    setPage(1)
    setCommentPage(1)
  }, [platform])

  useEffect(() => {
    setPlatform('all')
    setKeyword('all')
    setPage(1)
    setCommentPage(1)
  }, [scope])

  useEffect(() => {
    const wasActive = previousCrawlerStatus.current === 'running' || previousCrawlerStatus.current === 'stopping'
    if (wasActive && (crawlerStatus === 'idle' || crawlerStatus === 'error')) {
      queryClient.invalidateQueries({ queryKey: ['analytics-runs'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-contents'] })
      queryClient.invalidateQueries({ queryKey: ['analytics-comments'] })
    }
    previousCrawlerStatus.current = crawlerStatus
  }, [crawlerStatus, queryClient])

  const summary = summaryQuery.data
  const contents = contentsQuery.data
  const comments = commentsQuery.data
  const keywordRows = useMemo(() => summary?.by_keyword ?? [], [summary])
  const runs = runsQuery.data?.items ?? []
  const tasks = useMemo(() => {
    const groups = new Map<string, { task_id: string; task_title: string; runs: typeof runs }>()
    runs.forEach((run) => {
      const taskId = run.task_id || run.run_id
      const current = groups.get(taskId)
      if (current) current.runs.push(run)
      else groups.set(taskId, { task_id: taskId, task_title: run.task_title || run.task_name, runs: [run] })
    })
    return Array.from(groups.values())
  }, [runs])
  const filteredTasks = useMemo(() => {
    const normalizedQuery = taskQuery.trim().toLocaleLowerCase()
    if (!normalizedQuery) return tasks
    return tasks.filter((task) =>
      task.task_title.toLocaleLowerCase().includes(normalizedQuery)
      || task.runs.some((run) => `${run.task_name} ${run.platform} ${run.keywords}`.toLocaleLowerCase().includes(normalizedQuery))
    )
  }, [tasks, taskQuery])
  const selectedRun = runs.find((run) => run.run_id === selectedRunId)
  const selectedTask = tasks.find((task) => task.task_id === selectedTaskId)
  const scopeTitle = scope === 'all'
    ? '全部任务的最新数据'
    : selectedTask?.task_title || selectedRun?.task_name || '所选任务'


  const deleteRun = async (selectedRunId: string) => {
    try {
      await dataApi.deleteAnalyticsRun(selectedRunId)
      if (scope === `run:${selectedRunId}`) setScope('all')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['analytics-runs'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics-contents'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics-comments'] }),
      ])
      toast.success('任务记录已删除，原始数据文件仍然保留')
    } catch (error) {
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null
      toast.error(detail || '任务记录删除失败')
      throw error
    }
  }

  const deleteTask = async (taskId: string) => {
    try {
      await dataApi.deleteAnalyticsTask(taskId)
      if (scope === `task:${taskId}` || tasks.find((task) => task.task_id === taskId)?.runs.some((run) => scope === `run:${run.run_id}`)) setScope('all')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['analytics-runs'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics-summary'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics-contents'] }),
        queryClient.invalidateQueries({ queryKey: ['analytics-comments'] }),
      ])
      toast.success('任务及其全部执行记录已删除，原始数据文件仍然保留')
    } catch (error) {
      const detail = axios.isAxiosError(error) ? error.response?.data?.detail : null
      toast.error(detail || '任务删除失败')
      throw error
    }
  }

  const exportUrl = dataApi.getAnalyticsExportUrl({
    run_id: selectedRunId, task_id: selectedTaskId, platform, keyword, query, sort_by: sortBy,
  })

  const renderTaskGroups = (mobile = false) => filteredTasks.map((task) => {
    const isExpanded = expandedTasks.has(task.task_id) || task.runs.some((run) => scope === `run:${run.run_id}`)
    const isSelected = scope === `task:${task.task_id}`
    const isRunning = task.runs.some((run) => run.status === 'running')
    const itemCount = task.runs.reduce((total, run) => total + run.item_count, 0)
    const latestRun = task.runs[0]
    return (
      <div key={task.task_id} className="overflow-hidden rounded-md border border-cyber-border-subtle">
        <div className={`group relative transition-colors ${isSelected ? 'bg-cyber-neon-cyan/10' : 'hover:bg-cyber-bg-tertiary/70'}`}>
          <button
            type="button"
            onClick={() => { setScope(`task:${task.task_id}`); if (mobile) setIsRunHistoryOpen(false) }}
            className={`w-full text-left ${mobile ? 'p-3 pl-9 pr-12' : 'p-2.5 pl-8 pr-9'}`}
          >
            <span className="block truncate text-xs font-semibold text-cyber-text-primary" title={task.task_title}>{task.task_title}</span>
            <span className={`mt-1 flex items-center justify-between gap-2 text-cyber-text-muted ${mobile ? 'text-[11px]' : 'text-[10px]'}`}>
              <span>{task.runs.length} 个执行 · {formatRunTime(latestRun?.started_at ?? null)}</span>
              <span>{itemCount} 条</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setExpandedTasks((current) => {
              const next = new Set(current)
              if (next.has(task.task_id)) next.delete(task.task_id)
              else next.add(task.task_id)
              return next
            })}
            className="absolute left-1.5 top-2 flex h-6 w-6 items-center justify-center rounded text-cyber-text-muted hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"
            aria-label={isExpanded ? `收起任务 ${task.task_title}` : `展开任务 ${task.task_title}`}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {!isRunning ? (
            <DeleteConfirmDialog
              title="删除整个任务？"
              description={`将删除“${task.task_title}”及其 ${task.runs.length} 个执行记录，但不会删除 SQLite 中的平台原始采集表数据。`}
              onConfirm={() => deleteTask(task.task_id)}
              trigger={<Button variant="ghost" size="icon" aria-label={`删除任务 ${task.task_title}`} className={`absolute right-1 top-1 h-7 w-7 text-cyber-text-muted hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink ${mobile ? '' : 'opacity-0 focus:opacity-100 group-hover:opacity-100'}`}><Trash2 /></Button>}
            />
          ) : null}
        </div>
        {isExpanded ? (
          <div className="border-t border-cyber-border-subtle bg-cyber-bg-secondary/35 p-1.5">
            {task.runs.map((run) => (
              <div key={run.run_id} className={`group/run relative rounded transition-colors ${scope === `run:${run.run_id}` ? 'bg-cyber-neon-cyan/10' : 'hover:bg-cyber-bg-tertiary/70'}`}>
                <button type="button" onClick={() => { setScope(`run:${run.run_id}`); if (mobile) setIsRunHistoryOpen(false) }} className="w-full py-2 pl-6 pr-9 text-left">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[11px] font-medium text-cyber-text-secondary" title={run.task_name}>{run.task_name}</span>
                    <Badge variant="outline" className="shrink-0 text-[9px]">{runStatusLabel[run.status] ?? run.status}</Badge>
                  </span>
                  <span className="mt-1 flex items-center justify-between text-[10px] text-cyber-text-muted"><span>{formatRunTime(run.started_at)}</span><span>{run.item_count} 条</span></span>
                </button>
                <span className="absolute left-2 top-3 h-1.5 w-1.5 rounded-full bg-cyber-neon-cyan/50" />
                {run.status !== 'running' ? (
                  <DeleteConfirmDialog
                    title="删除执行记录？"
                    description={`仅删除“${run.task_name}”这一次执行的看板记录。`}
                    onConfirm={() => deleteRun(run.run_id)}
                    trigger={<Button variant="ghost" size="icon" aria-label={`删除执行 ${run.task_name}`} className="absolute right-0.5 top-1 h-7 w-7 text-cyber-text-muted opacity-0 hover:text-cyber-neon-pink focus:opacity-100 group-hover/run:opacity-100"><Trash2 /></Button>}
                  />
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    )
  })

  return (
    <div className="flex h-full min-h-0 overflow-hidden animate-slide-up">
      <aside
        className={`glass-panel relative z-[5] hidden min-h-0 shrink-0 flex-col border-r border-cyber-border-subtle transition-[width] duration-200 min-[1440px]:flex ${
          isTaskSidebarCollapsed ? 'w-16' : 'w-[260px]'
        }`}
        aria-label="任务范围"
      >
        <div className={`flex h-14 shrink-0 items-center border-b border-cyber-border-subtle ${isTaskSidebarCollapsed ? 'justify-center px-2' : 'justify-between px-3'}`}>
          {!isTaskSidebarCollapsed ? (
            <div className="flex min-w-0 items-center gap-2">
              <History className="h-4 w-4 shrink-0 text-cyber-neon-cyan" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-cyber-text-primary">任务范围</h2>
                <p className="text-[10px] text-cyber-text-muted">共 {tasks.length} 个任务 · {runsQuery.data?.total ?? 0} 个执行</p>
              </div>
            </div>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setIsTaskSidebarCollapsed((value) => !value)}
            aria-label={isTaskSidebarCollapsed ? '展开任务侧栏' : '收起任务侧栏'}
            title={isTaskSidebarCollapsed ? '展开任务侧栏' : '收起任务侧栏'}
          >
            {isTaskSidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>

        {isTaskSidebarCollapsed ? (
          <div className="flex flex-1 flex-col items-center gap-2 px-2 py-3">
            <button
              type="button"
              onClick={() => setIsTaskSidebarCollapsed(false)}
              className="flex h-10 w-10 items-center justify-center rounded-md border border-cyber-neon-cyan/30 bg-cyber-neon-cyan/10 text-cyber-neon-cyan"
              title={`当前范围：${scopeTitle}`}
              aria-label="展开并查看当前任务范围"
            >
              <History className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="shrink-0 space-y-2 border-b border-cyber-border-subtle p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyber-text-muted" />
                <Input
                  value={taskQuery}
                  onChange={(event) => setTaskQuery(event.target.value)}
                  placeholder="搜索任务"
                  className="h-8 pl-8 text-xs"
                />
              </div>
            <div
              className={`group relative rounded-md border transition-colors ${
                scope === 'all'
                  ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10'
                  : 'border-cyber-border-subtle hover:bg-cyber-bg-tertiary/70'
              }`}
            >
              <button
                type="button"
                onClick={() => setScope('all')}
                className="w-full p-2.5 pr-9 text-left"
              >
                <span className="block text-xs font-medium text-cyber-text-primary">全部任务</span>
                <span className="mt-0.5 block text-[10px] text-cyber-text-muted">展示各任务中的最新数据</span>
              </button>
              {runs.some((run) => run.status !== 'running') ? (
                <DeleteConfirmDialog
                  title="清空全部任务历史记录？"
                  description="将清空所有已完成任务及其看板历史记录，但不会删除 SQLite 中的平台原始采集表数据。"
                  onConfirm={() => deleteRun('all')}
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="清空全部任务历史记录"
                      title="清空全部任务历史记录"
                      className="absolute right-1 top-1 h-7 w-7 text-cyber-text-muted opacity-0 hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 />
                    </Button>
                  }
                />
              ) : null}
            </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {renderTaskGroups()}
              {!runsQuery.isLoading && !filteredTasks.length ? (
                <div className="py-8 text-center text-xs text-cyber-text-muted">
                  {taskQuery.trim() ? '没有匹配的任务' : '暂无任务记录'}
                </div>
              ) : null}
            </div>
          </>
        )}
      </aside>

      <main className="min-w-0 flex-1 overflow-auto px-4 pb-5">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-cyber-text-primary">
              <BarChart3 className="h-5 w-5 text-cyber-neon-cyan" />
              采集结果看板
            </h1>
            <p className="mt-1 text-xs text-cyber-text-muted">跨文件统一内容字段，按平台和来源关键词对比采集结果</p>
            <p className="mt-1 truncate text-[11px] text-cyber-text-secondary" title={selectedRun?.task_name}>
              当前范围：{scopeTitle}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="min-[1440px]:hidden"
              onClick={() => setIsRunHistoryOpen(true)}
            >
              <History />任务范围
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={exportUrl}><Download />导出 CSV</a>
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="内容总数" value={summary?.totals.content_count ?? 0} hint="当前筛选范围" icon={FileSearch} />
          <StatCard label="创作者" value={summary?.totals.creator_count ?? 0} hint="按用户 ID 去重" icon={Users} />
          <StatCard label="累计互动" value={summary?.totals.engagement ?? 0} hint="赞、藏、评、转合计" icon={Heart} />
          <StatCard label="关键词" value={summary?.by_keyword.length ?? 0} hint="有采集结果的关键词" icon={BarChart3} />
        </div>

        <div className="grid gap-4 2xl:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.6fr)]">
          <section className="glass-panel float-panel rounded-lg p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-cyber-text-primary">关键词横向对比</h2>
                <p className="text-[11px] text-cyber-text-muted">点击关键词可联动筛选内容库</p>
              </div>
              <Select value={metric} onValueChange={(value) => setMetric(value as MetricKey)}>
                <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(metricLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {keywordRows.length ? (
              <KeywordBars rows={keywordRows} metric={metric} selected={keyword} onSelect={(value) => { setKeyword(value); setPage(1) }} />
            ) : (
              <div className="py-12 text-center text-xs text-cyber-text-muted">暂无可对比数据</div>
            )}
          </section>

          <section className="glass-panel float-panel min-w-0 rounded-lg p-4">
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <label className="min-w-[140px] flex-1 space-y-1 text-[11px] text-cyber-text-muted">
                平台
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部平台</SelectItem>
                    {summary?.filters.platforms.map(([value, label]) => (
                      <SelectItem value={value} key={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="min-w-[160px] flex-1 space-y-1 text-[11px] text-cyber-text-muted">
                来源关键词
                <Select value={keyword} onValueChange={(value) => { setKeyword(value); setPage(1) }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">全部关键词</SelectItem>
                    {summary?.filters.keywords.map((value) => <SelectItem value={value} key={value}>{value}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="min-w-[140px] flex-1 space-y-1 text-[11px] text-cyber-text-muted">
                排序
                <Select value={sortBy} onValueChange={(value) => { setSortBy(value); setPage(1) }}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {sortOptions.map(([value, label]) => <SelectItem value={value} key={value}>{label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <form
                className="relative min-w-[220px] flex-[1.4]"
                onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()); setPage(1) }}
              >
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyber-text-muted" />
                <Input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索标题、账号或内容 ID" className="pl-9" />
              </form>
            </div>

            <div className="overflow-x-auto rounded-md border border-cyber-border-subtle">
              <table className="w-full min-w-[980px] border-collapse text-xs">
                <thead className="bg-cyber-bg-tertiary/80 text-cyber-text-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">内容</th>
                    <th className="px-3 py-2 text-left font-medium">平台 / 关键词</th>
                    <th className="px-3 py-2 text-right font-medium">点赞</th>
                    <th className="px-3 py-2 text-right font-medium">收藏</th>
                    <th className="px-3 py-2 text-right font-medium">评论</th>
                    <th className="px-3 py-2 text-right font-medium">转发</th>
                    <th className="px-3 py-2 text-right font-medium">发布时间</th>
                    <th className="px-3 py-2 text-center font-medium">原帖</th>
                  </tr>
                </thead>
                <tbody>
                  {contents?.items.map((item) => (
                    <tr key={`${item.platform}-${item.content_id}-${item.keyword}`} className="border-t border-cyber-border-subtle hover:bg-cyber-neon-cyan/5">
                      <td className="max-w-[360px] px-3 py-2.5">
                        <div className="flex items-center gap-2.5">
                          <div className="h-11 w-16 flex-shrink-0 overflow-hidden rounded bg-cyber-bg-tertiary">
                            {item.cover_url ? <img src={item.cover_url} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-cyber-text-primary" title={item.title}>{item.title || '无标题'}</p>
                            <p className="mt-1 truncate text-[11px] text-cyber-text-muted" title={item.creator_id}>
                              {item.creator_name || item.creator_id || '未知账号'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant="outline" className="mr-1 text-[10px]">{item.platform_label}</Badge>
                        <span className="whitespace-nowrap text-[11px] text-cyber-text-secondary">{item.keyword}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono"><Heart className="mr-1 inline h-3 w-3 text-cyber-neon-pink" />{formatNumber(item.likes)}</td>
                      <td className="px-3 py-2.5 text-right font-mono"><Star className="mr-1 inline h-3 w-3 text-cyber-neon-yellow" />{formatNumber(item.saves)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        <button
                          type="button"
                          onClick={() => setSelectedCommentContent(item)}
                          className="inline-flex items-center rounded px-1.5 py-1 text-cyber-neon-cyan transition-colors hover:bg-cyber-neon-cyan/10 hover:underline"
                          title="查看这条视频的全部一、二级评论"
                          aria-label={`查看 ${item.title || item.content_id} 的全部评论`}
                        >
                          <MessageCircle className="mr-1 h-3 w-3" />{formatNumber(item.comments)}
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono"><Share2 className="mr-1 inline h-3 w-3 text-cyber-neon-green" />{formatNumber(item.shares)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-cyber-text-muted">{formatDate(item.published_at)}</td>
                      <td className="px-3 py-2.5 text-center">
                        {item.content_url ? (
                          <a href={item.content_url} target="_blank" rel="noreferrer" className="inline-flex text-cyber-neon-cyan hover:opacity-75" aria-label="打开原帖">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : <span className="text-cyber-text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!contentsQuery.isLoading && !contents?.items.length ? (
                <div className="py-14 text-center text-xs text-cyber-text-muted">没有符合当前条件的内容</div>
              ) : null}
            </div>

            <div className="mt-3 flex items-center justify-between text-xs text-cyber-text-muted">
              <span>共 {contents?.total ?? 0} 条 · 第 {contents?.page ?? 1} / {Math.max(contents?.pages ?? 1, 1)} 页</span>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  <ChevronLeft />上一页
                </Button>
                <Button variant="outline" size="sm" disabled={!contents || page >= contents.pages} onClick={() => setPage((value) => value + 1)}>
                  下一页<ChevronRight />
                </Button>
              </div>
            </div>
          </section>
        </div>

        <section className="glass-panel float-panel rounded-lg p-4">
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <div className="mr-auto">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-cyber-text-primary">
                <MessageCircle className="h-4 w-4 text-cyber-neon-cyan" />采集评论
              </h2>
              <p className="mt-1 text-[11px] text-cyber-text-muted">直接读取 SQLite，保留一级评论、二级回复及父评论关系</p>
            </div>
            <Select value={commentLevel} onValueChange={(value) => { setCommentLevel(value); setCommentPage(1) }}>
              <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部层级</SelectItem>
                <SelectItem value="1">一级评论</SelectItem>
                <SelectItem value="2">二级回复</SelectItem>
              </SelectContent>
            </Select>
            <form
              className="relative min-w-[260px]"
              onSubmit={(event) => { event.preventDefault(); setCommentQuery(commentQueryInput.trim()); setCommentPage(1) }}
            >
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyber-text-muted" />
              <Input
                value={commentQueryInput}
                onChange={(event) => setCommentQueryInput(event.target.value)}
                placeholder="搜索评论、评论者或作品 ID"
                className="pl-9"
              />
            </form>
          </div>

          <div className="overflow-x-auto rounded-md border border-cyber-border-subtle">
            <table className="w-full min-w-[980px] border-collapse text-xs">
              <thead className="bg-cyber-bg-tertiary/80 text-cyber-text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">层级</th>
                  <th className="px-3 py-2 text-left font-medium">评论内容</th>
                  <th className="px-3 py-2 text-left font-medium">评论者</th>
                  <th className="px-3 py-2 text-left font-medium">平台 / 作品 ID</th>
                  <th className="px-3 py-2 text-left font-medium">父评论 ID</th>
                  <th className="px-3 py-2 text-right font-medium">点赞</th>
                  <th className="px-3 py-2 text-right font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {comments?.items.map((item) => (
                  <tr key={`${item.platform}-${item.comment_id}`} className="border-t border-cyber-border-subtle hover:bg-cyber-neon-cyan/5">
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <Badge variant="outline" className="text-[10px]">{item.level === 1 ? '一级评论' : '二级回复'}</Badge>
                    </td>
                    <td className="max-w-[420px] px-3 py-2.5 text-cyber-text-primary">
                      <p className="line-clamp-2" title={item.content}>{item.content || '—'}</p>
                    </td>
                    <td className="max-w-[180px] px-3 py-2.5">
                      <p className="truncate text-cyber-text-secondary" title={item.creator_id}>{item.creator_name || item.creator_id || '未知用户'}</p>
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant="outline" className="mr-1 text-[10px]">{item.platform_label}</Badge>
                      <span className="font-mono text-[11px] text-cyber-text-muted">{item.content_id}</span>
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 font-mono text-[11px] text-cyber-text-muted" title={item.parent_comment_id}>
                      {item.parent_comment_id || '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">{formatNumber(item.likes)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right text-cyber-text-muted">{formatDate(item.published_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!commentsQuery.isLoading && !comments?.items.length ? (
              <div className="py-12 text-center text-xs text-cyber-text-muted">暂无已采集评论</div>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between text-xs text-cyber-text-muted">
            <span>共 {comments?.total ?? 0} 条 · 第 {comments?.page ?? 1} / {Math.max(comments?.pages ?? 1, 1)} 页</span>
            <div className="flex gap-1">
              <Button variant="outline" size="sm" disabled={commentPage <= 1} onClick={() => setCommentPage((value) => Math.max(1, value - 1))}>
                <ChevronLeft />上一页
              </Button>
              <Button variant="outline" size="sm" disabled={!comments || commentPage >= comments.pages} onClick={() => setCommentPage((value) => value + 1)}>
                下一页<ChevronRight />
              </Button>
            </div>
          </div>
        </section>
        <Dialog open={isRunHistoryOpen} onOpenChange={setIsRunHistoryOpen}>
          <DialogContent className="left-0 top-0 flex h-dvh w-[min(360px,92vw)] max-w-none translate-x-0 translate-y-0 flex-col gap-3 overflow-hidden rounded-none border-y-0 border-l-0 border-r border-cyber-border-subtle p-4 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left">
            <DialogHeader className="pr-8">
              <DialogTitle className="flex items-center gap-2 text-base"><History className="h-4 w-4" />任务范围</DialogTitle>
              <DialogDescription>选择任务查看该次采集结果</DialogDescription>
            </DialogHeader>

            <div className="relative shrink-0">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyber-text-muted" />
              <Input
                value={taskQuery}
                onChange={(event) => setTaskQuery(event.target.value)}
                placeholder="搜索任务"
                className="h-9 pl-8 text-xs"
              />
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
              <div
                className={`group relative rounded-md border transition-colors ${
                  scope === 'all'
                    ? 'border-cyber-neon-cyan bg-cyber-neon-cyan/10'
                    : 'border-cyber-border-subtle hover:bg-cyber-bg-tertiary/70'
                }`}
              >
                <button
                  type="button"
                  onClick={() => { setScope('all'); setIsRunHistoryOpen(false) }}
                  className="w-full p-3 pr-12 text-left"
                >
                  <span className="block text-xs font-medium text-cyber-text-primary">全部任务</span>
                  <span className="mt-1 block text-[11px] text-cyber-text-muted">每条内容展示所有任务中的最新数据</span>
                </button>
                {runs.some((run) => run.status !== 'running') ? (
                  <DeleteConfirmDialog
                    title="清空全部任务历史记录？"
                    description="将清空所有已完成任务及其看板历史记录，但不会删除 SQLite 中的平台原始采集表数据。"
                    onConfirm={() => deleteRun('all')}
                    trigger={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="清空全部任务历史记录"
                        title="清空全部任务历史记录"
                        className="absolute right-1.5 top-1.5 h-8 w-8 text-cyber-text-muted hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink"
                      >
                        <Trash2 />
                      </Button>
                    }
                  />
                ) : null}
              </div>

              {renderTaskGroups(true)}

              {!runsQuery.isLoading && !filteredTasks.length ? (
                <div className="py-8 text-center text-xs text-cyber-text-muted">
                  {taskQuery.trim() ? '没有匹配的任务' : '暂无任务记录'}
                </div>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>

        <ContentCommentsDialog
          content={selectedCommentContent}
          runId={selectedRunId}
          taskId={selectedTaskId}
          onOpenChange={(open) => { if (!open) setSelectedCommentContent(null) }}
        />
      </div>
      </main>
    </div>
  )
}
