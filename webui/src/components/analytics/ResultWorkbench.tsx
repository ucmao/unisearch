import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { toast } from 'sonner'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code,
  Columns3,
  Download,
  ExternalLink,
  FileJson,
  FileSearch,
  FileSpreadsheet,
  FileText,
  FileType,
  Check,
  History,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Trash2,
  User,
  Users,
} from 'lucide-react'
import { dataApi, type CanonicalDocument } from '@/lib/api'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

type ExportFormat = 'csv' | 'json' | 'markdown'

const EXPORT_FORMAT_OPTIONS = [
  {
    id: 'csv',
    title: 'CSV 表格',
    ext: '.csv',
    hint: '适合 Excel / WPS 表格数据分析',
    icon: FileSpreadsheet,
  },
  {
    id: 'json',
    title: 'JSON 数据',
    ext: '.json',
    hint: '适合 API 对接与程序开发',
    icon: FileJson,
  },
  {
    id: 'markdown',
    title: 'Markdown 文档',
    ext: '.md',
    hint: '适合 Obsidian / Notion 笔记阅读',
    icon: FileType,
  },
] as const

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

const PLATFORM_CONFIGS: Record<string, { label: string; bg: string; text: string; border: string }> = {
  baidu: { label: '百度', bg: 'bg-blue-500/10 dark:bg-blue-400/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20' },
  bing: { label: '必应', bg: 'bg-teal-500/10 dark:bg-teal-400/15', text: 'text-teal-600 dark:text-teal-400', border: 'border-teal-500/20' },
  so360: { label: '360搜索', bg: 'bg-emerald-500/10 dark:bg-emerald-400/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  sogou: { label: '搜狗', bg: 'bg-orange-500/10 dark:bg-orange-400/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20' },
  toutiao: { label: '头条搜索', bg: 'bg-red-500/10 dark:bg-red-400/15', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/20' },
  arxiv: { label: 'arXiv', bg: 'bg-rose-700/10 dark:bg-rose-500/15', text: 'text-rose-800 dark:text-rose-300', border: 'border-rose-700/20' },
  github_repositories: { label: 'GitHub 仓库', bg: 'bg-slate-700/10 dark:bg-slate-300/15', text: 'text-slate-800 dark:text-slate-200', border: 'border-slate-600/20' },
  rss_news: { label: 'RSS 新闻', bg: 'bg-orange-600/10 dark:bg-orange-400/15', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-500/20' },
  xhs: { label: '小红书', bg: 'bg-rose-500/10 dark:bg-rose-400/15', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/20' },
  douyin: { label: '抖音', bg: 'bg-slate-800/10 dark:bg-slate-200/15', text: 'text-slate-700 dark:text-slate-200', border: 'border-slate-400/20' },
  kuaishou: { label: '快手', bg: 'bg-amber-500/10 dark:bg-amber-400/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20' },
  bili: { label: '哔哩哔哩', bg: 'bg-pink-500/10 dark:bg-pink-400/15', text: 'text-pink-600 dark:text-pink-400', border: 'border-pink-500/20' },
  weibo: { label: '微博', bg: 'bg-yellow-500/10 dark:bg-yellow-400/15', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-500/20' },
  tieba: { label: '贴吧', bg: 'bg-indigo-500/10 dark:bg-indigo-400/15', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/20' },
  zhihu: { label: '知乎', bg: 'bg-sky-500/10 dark:bg-sky-400/15', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/20' },
  boss: { label: 'BOSS直聘', bg: 'bg-cyan-600/10 dark:bg-cyan-400/15', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-600/20' },
  zhaopin: { label: '智联招聘', bg: 'bg-cyan-500/10 dark:bg-cyan-400/15', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/20' },
  job51: { label: '前程无忧', bg: 'bg-orange-500/10 dark:bg-orange-400/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20' },
  liepin: { label: '猎聘网', bg: 'bg-emerald-500/10 dark:bg-emerald-400/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  heimao: { label: '黑猫投诉', bg: 'bg-red-600/10 dark:bg-red-500/15', text: 'text-red-700 dark:text-red-400', border: 'border-red-600/20' },
  deepseek: { label: 'DeepSeek', bg: 'bg-purple-500/10 dark:bg-purple-400/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/20' },
  kimi: { label: 'Kimi', bg: 'bg-sky-500/10 dark:bg-sky-400/15', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/20' },
  doubao: { label: '豆包', bg: 'bg-blue-600/10 dark:bg-blue-400/15', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-600/20' },
}

function renderPlatformBadge(platformKey: string, fallbackLabel?: string) {
  const config = PLATFORM_CONFIGS[platformKey]
  if (config) {
    return (
      <span className={`inline-flex items-center rounded-full border ${config.border} ${config.bg} ${config.text} px-2.5 py-0.5 text-[11px] font-medium transition-colors`}>
        {config.label}
      </span>
    )
  }
  return (
    <Badge variant="outline" className="rounded-full px-2.5 text-[11px]">
      {fallbackLabel || platformKey}
    </Badge>
  )
}

const attributeLabels: Record<string, string> = {
  salary: '薪资', city: '城市', experience: '经验', education: '学历', status: '状态',
  amount: '金额', request: '诉求', domain: '域名', forumName: '社区', questionId: '问题 ID',
  mediaType: '媒体类型', tags: '标签', reasoningContent: '推理内容',
}

const assetRoleLabels: Record<CanonicalDocument['assets'][number]['role'], string> = {
  cover: '封面', content: '正文资源', avatar: '头像', thumbnail: '缩略图',
  attachment: '附件', unknown: '其他资源',
}

function previewAsset(document: CanonicalDocument) {
  return document.assets.find((asset) => asset.role === 'cover')
    || document.assets.find((asset) => asset.role === 'thumbnail')
    || document.assets.find((asset) => asset.kind === 'image')
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
    <div className="glass-panel float-panel rounded-xl border border-cyber-border-subtle p-4 flex items-start justify-between gap-3 transition-colors duration-150 hover:border-cyber-border-subtle/80">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-wider text-cyber-text-muted">{label}</p>
        <p className="mt-1.5 font-mono text-2xl font-bold tracking-tight text-cyber-text-primary">{formatNumber(value)}</p>
        <p className="mt-1 text-[11px] text-cyber-text-muted/80">{hint}</p>
      </div>
      <div className="rounded-lg border border-cyber-border-subtle/80 bg-cyber-bg-tertiary/70 p-2.5 text-cyber-text-muted transition-colors">
        <Icon className="h-4 w-4 text-cyber-text-muted" />
      </div>
    </div>
  )
}

function CommentsSection({ document }: { document: CanonicalDocument }) {
  const sourceItemId = document.sourceItemId
  const documentId = document.documentId

  const { data: parentData, isLoading: parentLoading } = useQuery({
    queryKey: ['analytics-comments-parent', sourceItemId],
    queryFn: async () => (await dataApi.getAnalyticsDocuments({ parent_source_item_id: sourceItemId, page_size: 200 })).data,
    enabled: Boolean(sourceItemId),
  })

  const { data: queryData, isLoading: queryLoading } = useQuery({
    queryKey: ['analytics-comments-query', sourceItemId],
    queryFn: async () => (await dataApi.getAnalyticsDocuments({ query: sourceItemId, page_size: 200 })).data,
    enabled: Boolean(sourceItemId),
  })

  const { data: docIdData, isLoading: docIdLoading } = useQuery({
    queryKey: ['analytics-comments-docid', documentId],
    queryFn: async () => (await dataApi.getAnalyticsDocuments({ query: documentId, page_size: 200 })).data,
    enabled: Boolean(documentId),
  })

  const comments = useMemo(() => {
    const list = [
      ...(parentData?.items || []),
      ...(queryData?.items || []),
      ...(docIdData?.items || []),
    ]
    const map = new Map<string, CanonicalDocument>()
    for (const item of list) {
      if (item.kind === 'comment' && item.documentId !== documentId) {
        map.set(item.documentId, item)
      }
    }
    return Array.from(map.values())
  }, [parentData, queryData, docIdData, documentId])

  const isLoading = parentLoading || queryLoading || docIdLoading

  if (isLoading) {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-cyber-text-muted flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-cyber-neon-cyan" />
          关联评论区
        </h3>
        <div className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/20 p-4 text-xs text-cyber-text-muted animate-pulse">
          正在检索该主帖关联评论...
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-cyber-text-muted flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-cyber-neon-cyan" />
          关联评论区 ({comments.length})
        </h3>
      </div>
      {comments.length > 0 ? (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {comments.map((comment) => (
            <div key={comment.documentId} className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/30 p-3 text-xs space-y-1 hover:border-cyber-neon-cyan/30 transition-colors">
              <div className="flex items-center justify-between text-[11px] text-cyber-text-muted">
                <span className="font-medium text-cyber-text-primary flex items-center gap-1">
                  <User className="h-3 w-3 text-cyber-neon-cyan/70" />
                  {comment.subject.name || comment.subject.id || '匿名用户'}
                </span>
                <span>{formatDate(comment.publishedAt)}</span>
              </div>
              <p className="text-cyber-text-secondary leading-relaxed font-sans whitespace-pre-wrap break-words">
                {comment.markdown || comment.summary || '—'}
              </p>
              {Object.keys(comment.metrics).length > 0 && (
                <div className="flex items-center gap-3 pt-1 text-[10px] text-cyber-text-muted font-mono">
                  {typeof comment.metrics.likes === 'number' && <span>👍 {formatNumber(comment.metrics.likes)}</span>}
                  {typeof comment.metrics.replies === 'number' && <span>💬 {formatNumber(comment.metrics.replies)}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-cyber-border-subtle/80 bg-cyber-bg-secondary/20 p-4 text-center text-xs text-cyber-text-muted/70">
          当前数据集中未包含该主帖的衍生评论
        </div>
      )}
    </section>
  )
}

function DocumentDrawer({ document, platformLabel, onOpenChange }: {
  document: CanonicalDocument | null
  platformLabel: string
  onOpenChange: (open: boolean) => void
}) {
  const [drawerWidth, setDrawerWidth] = useState(560)
  const [isResizing, setIsResizing] = useState(false)
  const [techDetailsOpen, setTechDetailsOpen] = useState(false)

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault()
    setIsResizing(true)
    const startX = mouseDownEvent.clientX
    const startWidth = drawerWidth

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      const deltaX = startX - mouseMoveEvent.clientX
      const newWidth = Math.max(360, Math.min(startWidth + deltaX, window.innerWidth * 0.85))
      setDrawerWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const visibleAttributes = document
    ? Object.fromEntries(Object.entries(document.attributes).filter(([key]) => key !== 'reasoningContent'))
    : {}
  const cover = document ? previewAsset(document) : undefined

  // 判断摘要是否与正文内容大面积重复
  const isSummaryIdentical = useMemo(() => {
    if (!document?.summary || !document?.markdown) return false
    const s = document.summary.trim()
    const m = document.markdown.trim()
    if (s === m) return true
    return s.length > 20 && m.startsWith(s.slice(0, Math.min(40, s.length)))
  }, [document])

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent
        style={{ width: `min(${drawerWidth}px, 88vw)` }}
        className={`left-auto right-0 top-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 border-l border-cyber-border-subtle bg-cyber-bg-panel/95 p-0 shadow-2xl backdrop-blur-md data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right ${isResizing ? 'select-none' : ''}`}
      >
        <div
          onMouseDown={startResizing}
          className={`absolute -left-[3px] top-0 bottom-0 z-50 w-1.5 touch-none cursor-col-resize transition-colors hover:bg-cyber-neon-cyan/25 ${isResizing ? 'bg-cyber-neon-cyan/35' : ''}`}
          title="拖动调整抽屉宽度"
        />
        {document ? (
          <>
            {/* 顶栏 Header */}
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-cyber-border-subtle bg-cyber-bg-secondary/40 px-5 pr-12">
              <div className="flex items-center gap-2">
                {renderPlatformBadge(document.platform, platformLabel)}
                <Badge variant="secondary" className="rounded-full px-2.5 text-[11px] font-normal">
                  {kindLabels[document.kind] || document.kind}
                </Badge>
                {document.keyword ? (
                  <span className="rounded-full bg-cyber-bg-tertiary/70 px-2.5 py-0.5 font-mono text-[11px] text-cyber-text-secondary">
                    #{document.keyword}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {document.sourceUrl && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" asChild>
                    <a href={document.sourceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                      打开原帖
                    </a>
                  </Button>
                )}
              </div>
            </div>

            {/* 内容区 */}
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
              {/* 大标题 & 作者/时间属性 */}
              <div className="space-y-3">
                <h2 className="text-xl font-bold leading-snug tracking-tight text-cyber-text-primary">
                  {document.title || '无标题文档'}
                </h2>
                
                <div className="flex flex-wrap items-center gap-4 border-b border-cyber-border-subtle/60 pb-3 text-xs text-cyber-text-muted">
                  <div className="flex items-center gap-1.5 font-medium text-cyber-text-secondary">
                    <User className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                    <span>{document.subject.name || document.subject.id || '未知作者'}</span>
                    <span className="text-[10px] text-cyber-text-muted">
                      ({subjectTypeLabels[document.subject.type] || document.subject.type})
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    <span>发布于 {formatDate(document.publishedAt)}</span>
                  </div>
                </div>

                {/* 仅当摘要不与正文大面积重复时显示 */}
                {document.summary && !isSummaryIdentical ? (
                  <div className="rounded-lg border border-cyber-neon-cyan/20 bg-cyber-neon-cyan/5 p-3 text-xs leading-relaxed text-cyber-text-secondary">
                    <p className="mb-1 font-semibold text-cyber-neon-cyan">摘要提炼</p>
                    {document.summary}
                  </div>
                ) : null}
              </div>

              {/* 封面图 */}
              {cover ? (
                <div className="overflow-hidden rounded-xl border border-cyber-border-subtle bg-black/5 shadow-md">
                  <img
                    src={cover.url}
                    alt={document.title || '文档封面'}
                    referrerPolicy="no-referrer"
                    className="max-h-80 w-full object-contain"
                  />
                </div>
              ) : null}

              {/* 数据指标卡片 */}
              {Object.keys(document.metrics).length ? (
                <RecordSection title="数据指标" record={document.metrics} labels={metricLabels} numeric />
              ) : null}

              {/* 业务扩展属性 */}
              {Object.keys(visibleAttributes).length ? (
                <RecordSection title="业务属性" record={visibleAttributes} labels={attributeLabels} />
              ) : null}

              {/* 正文内容 */}
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyber-text-muted">
                  正文内容
                </h3>
                <div className="whitespace-pre-wrap break-words rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/40 p-4.5 font-sans text-sm leading-7 text-cyber-text-primary shadow-inner">
                  {document.markdown || '—'}
                </div>
              </section>

              {/* 引用 */}
              {document.citations.length ? (
                <section>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyber-text-muted">
                    引用出处 ({document.citations.length})
                  </h3>
                  <div className="space-y-2">
                    {document.citations.map((citation) => (
                      <a
                        key={citation.url}
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/30 p-2.5 text-xs text-cyber-neon-cyan transition-colors hover:border-cyber-neon-cyan/40 hover:bg-cyber-neon-cyan/5"
                      >
                        {citation.title || citation.source || citation.url}
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* 关联评论区 */}
              <CommentsSection document={document} />

              {/* 高级技术元数据折叠区 (IDs & Raw Assets) */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setTechDetailsOpen(!techDetailsOpen)}
                  className="flex w-full items-center justify-between rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/30 px-3 py-2 text-xs text-cyber-text-muted hover:bg-cyber-bg-secondary/60 hover:text-cyber-text-primary transition-colors"
                >
                  <span className="flex items-center gap-1.5 font-medium">
                    <Code className="h-3.5 w-3.5" />
                    高级技术属性 (ID & 原始资源)
                  </span>
                  {techDetailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </button>

                {techDetailsOpen && (
                  <div className="mt-3 space-y-4 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/20 p-4">
                    <section className="grid gap-2 sm:grid-cols-2">
                      <Detail label="Document ID" value={document.documentId} mono />
                      <Detail label="来源内容 ID" value={document.sourceItemId} mono />
                      <Detail label="采集时间" value={formatDate(document.fetchedAt)} />
                      {document.parentSourceItemId && (
                        <Detail label="父级来源 ID" value={document.parentSourceItemId} mono />
                      )}
                      {document.originalPlatform && (
                        <Detail label="原始平台" value={document.originalPlatform} />
                      )}
                    </section>

                    {document.assets.length ? (
                      <div>
                        <p className="mb-1.5 text-[11px] font-medium text-cyber-text-muted">
                          底层资源 URL 数组 ({document.assets.length})
                        </p>
                        <div className="grid gap-1.5 sm:grid-cols-2">
                          {document.assets.map((asset) => (
                            <a
                              key={asset.assetId}
                              href={asset.url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate rounded border border-cyber-border-subtle bg-cyber-bg-secondary/40 p-2 font-mono text-[10px] text-cyber-neon-cyan hover:underline"
                            >
                              {assetRoleLabels[asset.role]} · {asset.kind}
                            </a>
                          ))}
                        </div>
                      </div>
                    ) : null}
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

function Detail({ label, value, mono = false }: { label: string; value: unknown; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/20 p-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-cyber-text-muted">{label}</p>
      <p className={`mt-1 truncate text-xs text-cyber-text-secondary ${mono ? 'font-mono text-[11px]' : ''}`} title={String(value)}>
        {displayValue(value, 300)}
      </p>
    </div>
  )
}

function RecordSection({ title, record, labels, numeric = false, cols }: {
  title: string
  record: Record<string, unknown>
  labels: Record<string, string>
  numeric?: boolean
  cols?: number
}) {
  const gridColsClass = (cols === 4 || numeric) ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3'
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyber-text-muted">{title}</h3>
      <div className={`grid gap-2 ${gridColsClass}`}>
        {Object.entries(record).map(([key, value]) => (
          <Detail key={key} label={labels[key] || key} value={numeric && typeof value === 'number' ? formatNumber(value) : value} />
        ))}
      </div>
    </section>
  )
}

export function ResultWorkbench({ initialScope = 'all', onBack }: { initialScope?: string; onBack?: () => void }) {
  const queryClient = useQueryClient()
  const statuses = useCrawlerStore((state) => state.statuses)
  const crawlerStatus = Object.values(statuses).some((status) => status === 'running') ? 'running' : 'idle'
  const previousCrawlerStatus = useRef(crawlerStatus)
  const initializedDynamicColumns = useRef(false)
  const [scope, setScope] = useState(initialScope)
  const [platform, setPlatform] = useState('all')
  const [kind, setKind] = useState('main_only')
  const [keyword, setKeyword] = useState('all')
  const [subjectType, setSubjectType] = useState('all')
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('fetched_at')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [selectedDocument, setSelectedDocument] = useState<CanonicalDocument | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(DEFAULT_COLUMNS))
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(288)
  const [isResizing, setIsResizing] = useState(false)
  const [mobileScopeOpen, setMobileScopeOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv')
  const [exportDialogOpen, setExportDialogOpen] = useState(false)

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault()
    setIsResizing(true)
    const startX = mouseDownEvent.clientX
    const startWidth = sidebarWidth

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(startWidth + (mouseMoveEvent.clientX - startX), 520))
      setSidebarWidth(newWidth)
    }

    const onMouseUp = () => {
      setIsResizing(false)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const tasksQuery = useQuery({
    queryKey: ['analytics-tasks'],
    queryFn: async () => (await dataApi.getAnalyticsTasks()).data,
    refetchInterval: crawlerStatus === 'running' ? 1500 : false,
  })
  const tasks = tasksQuery.data?.items || []
  const selectedRunId = scope.startsWith('run:') ? scope.slice(4) : undefined
  const selectedWorkflowId = scope.startsWith('plan:') ? scope.slice(5) : undefined
  const selectedThreadId = scope.startsWith('thread:') ? scope.slice(7) : undefined
  const scopeFilters = useMemo(() => ({
    run_id: selectedRunId,
    workflow_id: selectedWorkflowId,
    thread_id: selectedThreadId,
  }), [selectedRunId, selectedWorkflowId, selectedThreadId])

  const scopeSummaryQuery = useQuery({
    queryKey: ['analytics-scope-summary', scopeFilters],
    queryFn: async () => (await dataApi.getAnalyticsSummary(scopeFilters)).data,
    refetchInterval: crawlerStatus === 'running' ? 1500 : false,
  })

  const filters = useMemo(() => ({
    ...scopeFilters,
    platform,
    kind,
    keyword,
    subject_type: subjectType,
    query,
  }), [scopeFilters, platform, kind, keyword, subjectType, query])

  const summaryQuery = useQuery({
    queryKey: ['analytics-summary', filters],
    queryFn: async () => (await dataApi.getAnalyticsSummary(filters)).data,
    refetchInterval: crawlerStatus === 'running' ? 1500 : false,
  })
  const documentsQuery = useQuery({
    queryKey: ['analytics-documents', filters, sortBy, sortOrder, page],
    queryFn: async () => (await dataApi.getAnalyticsDocuments({ ...filters, sort_by: sortBy, sort_order: sortOrder, page, page_size: 20 })).data,
    refetchInterval: crawlerStatus === 'running' ? 1500 : false,
  })
  const scopeSummary = scopeSummaryQuery.data
  const summary = summaryQuery.data
  const documents = documentsQuery.data
  const platformLabels = useMemo(() => new Map(scopeSummary?.filters.platforms || summary?.filters.platforms || []), [scopeSummary, summary])

  const dynamicColumns = useMemo(() => [
    ...(scopeSummary?.filters.metric_keys || summary?.filters.metric_keys || []).map((key) => ({ key: `metric:${key}`, label: metricLabels[key] || key, group: '指标' })),
    ...(scopeSummary?.filters.attribute_keys || summary?.filters.attribute_keys || [])
      .filter((key) => key !== 'reasoningContent')
      .map((key) => ({ key: `attribute:${key}`, label: attributeLabels[key] || key, group: '扩展属性' })),
  ], [scopeSummary, summary])

  useEffect(() => setScope(initialScope), [initialScope])
  useEffect(() => { setPage(1); setSelectedDocument(null) }, [scope, platform, kind, keyword, subjectType, query, sortBy, sortOrder])
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
      <button
        type="button"
        onClick={() => { setScope('all'); if (mobile) setMobileScopeOpen(false) }}
        className={`w-full rounded-lg border p-3 text-left transition-all ${scope === 'all' ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/10 shadow-sm' : 'border-cyber-border-subtle bg-cyber-bg-panel/40 hover:bg-cyber-bg-tertiary/60'}`}
      >
        <span className="block text-xs font-semibold text-cyber-text-primary">全部任务</span>
        <span className="mt-0.5 block text-[10px] text-cyber-text-muted">每个文档展示最新采集快照</span>
      </button>
      {tasks.map((task) => {
        const isTaskSelected = scope === `thread:${task.thread_id}`
        return (
          <div key={task.thread_id} className={`rounded-lg border p-2 transition-all ${isTaskSelected ? 'border-cyber-neon-cyan/40 bg-cyber-neon-cyan/5' : 'border-cyber-border-subtle bg-cyber-bg-panel/20'}`}>
            <div className={`group flex items-center justify-between rounded-md px-2 py-1.5 transition-colors ${isTaskSelected ? 'bg-cyber-neon-cyan/10 text-cyber-text-primary font-medium hover:bg-cyber-neon-cyan/20' : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary/70 hover:text-cyber-text-primary'}`}>
              <button
                type="button"
                onClick={() => { setScope(`thread:${task.thread_id}`); if (mobile) setMobileScopeOpen(false) }}
                className="min-w-0 flex-1 truncate text-left text-xs font-medium focus:outline-none"
              >
                {task.task_title || task.thread_id}
              </button>
              <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                <DeleteConfirmDialog
                  title="删除整个任务及其采集数据？"
                  description="该操作会物理删除任务下所有执行、文档来源和日志。"
                  onConfirm={() => deleteScope('task', task.thread_id)}
                  trigger={<Button variant="ghost" size="icon" className="h-6 w-6 text-cyber-text-muted hover:bg-cyber-bg-secondary hover:text-red-400"><Trash2 className="h-3 w-3" /></Button>}
                />
              </div>
            </div>
            <div className="ml-2 space-y-1 border-l border-cyber-border-subtle pl-2 mt-1">
              {task.rounds.map((round) => {
                const isRoundSelected = scope === `plan:${round.plan_id}`
                return (
                  <div key={round.plan_id} className={`group flex items-center justify-between rounded px-2 py-1 transition-colors ${isRoundSelected ? 'bg-cyber-neon-cyan/10 text-cyber-text-primary font-medium hover:bg-cyber-neon-cyan/20' : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary/70 hover:text-cyber-text-primary'}`}>
                    <button
                      type="button"
                      onClick={() => { setScope(`plan:${round.plan_id}`); if (mobile) setMobileScopeOpen(false) }}
                      className="min-w-0 flex-1 truncate text-left text-[11px] focus:outline-none"
                    >
                      {round.round_title || round.plan_id}
                    </button>
                    <div className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
                      <DeleteConfirmDialog
                        title="删除该采集轮次？"
                        description="该轮次下的执行和文档来源将被物理删除。"
                        onConfirm={() => deleteScope('round', round.plan_id)}
                        trigger={<Button variant="ghost" size="icon" className="h-5 w-5 text-cyber-text-muted hover:bg-cyber-bg-secondary hover:text-red-400"><Trash2 className="h-3 w-3" /></Button>}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )

  const selectedColumns = [
    ...BASE_COLUMNS.map(([key, label]) => ({ key, label, group: '通用字段' })),
    ...dynamicColumns,
  ].filter((column) => visibleColumns.has(column.key))

  const getSortKeyForColumn = (columnKey: string): string => {
    if (columnKey === 'publishedAt') return 'published_at'
    if (columnKey.startsWith('metric:')) return `metrics.${columnKey.slice(7)}`
    if (columnKey.startsWith('attribute:')) return `attributes.${columnKey.slice(10)}`
    return columnKey
  }

  const handleColumnHeaderClick = (columnKey: string) => {
    const targetSortBy = getSortKeyForColumn(columnKey)
    if (sortBy === targetSortBy) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortBy(targetSortBy)
      setSortOrder('desc')
    }
  }

  const getColumnSortState = (columnKey: string): 'asc' | 'desc' | null => {
    const targetSortBy = getSortKeyForColumn(columnKey)
    if (sortBy === targetSortBy) return sortOrder
    return null
  }

  const cell = (document: CanonicalDocument, key: string) => {
    if (key === 'title') {
      const preview = previewAsset(document)
      return <div className="flex max-w-[420px] items-start gap-3">{preview ? <img src={preview.url} alt="" referrerPolicy="no-referrer" className="h-14 w-20 shrink-0 rounded border border-cyber-border-subtle bg-cyber-bg-secondary object-cover" /> : null}<div className="min-w-0"><p className="truncate font-medium text-cyber-text-primary">{document.title || '无标题'}</p><p className="mt-1 line-clamp-2 text-[11px] text-cyber-text-muted">{document.summary || document.markdown || '—'}</p></div></div>
    }
    if (key === 'platform') return renderPlatformBadge(document.platform, platformLabels.get(document.platform))
    if (key === 'kind') return <Badge variant="secondary" className="rounded-md text-[11px] font-normal">{kindLabels[document.kind] || document.kind}</Badge>
    if (key === 'subject') return <div><p className="font-medium text-cyber-text-primary">{document.subject.name || document.subject.id || '—'}</p><p className="text-[10px] text-cyber-text-muted">{subjectTypeLabels[document.subject.type] || document.subject.type}</p></div>
    if (key === 'keyword') return <span className="rounded bg-cyber-bg-tertiary/70 px-1.5 py-0.5 font-mono text-[11px] text-cyber-text-secondary">{document.keyword || '—'}</span>
    if (key === 'publishedAt') return <span className="whitespace-nowrap font-mono text-[11px] text-cyber-text-muted">{formatDate(document.publishedAt)}</span>
    if (key.startsWith('metric:')) {
      const value = document.metrics[key.slice(7)]
      return typeof value === 'number' ? (
        <span className="font-mono text-xs font-semibold text-cyber-text-primary">{formatNumber(value)}</span>
      ) : (
        <span className="font-mono text-[11px] text-cyber-text-muted/30">—</span>
      )
    }
    if (key.startsWith('attribute:')) {
      const val = displayValue(document.attributes[key.slice(10)])
      return val === '—' ? <span className="font-mono text-[11px] text-cyber-text-muted/30">—</span> : val
    }
    return <span className="font-mono text-[11px] text-cyber-text-muted/30">—</span>
  }

  const exportUrl = dataApi.getAnalyticsExportUrl({ ...filters, sort_by: sortBy, sort_order: sortOrder, format: exportFormat })

  return (
    <div className="flex h-full min-h-0 flex-col bg-cyber-bg-primary">
      {onBack && (
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-cyber-border-subtle bg-cyber-bg-primary/90 pl-[74px] pr-4 backdrop-blur app-drag">
          <div className="flex items-center gap-1.5 app-no-drag">
            <Button size="icon" variant="ghost" className="h-8 w-8 text-cyber-text-secondary hover:text-cyber-text-primary" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} title={sidebarCollapsed ? "展开任务范围侧栏" : "收起任务范围侧栏"}>
              {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2.5 text-xs text-cyber-text-secondary hover:text-cyber-text-primary" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />返回任务
            </Button>
            <div className="mx-1 h-3.5 w-[1px] bg-cyber-border-subtle" />
            <span className="text-sm font-medium text-cyber-text-primary">数据透视工作台</span>
            <span className="hidden text-xs text-cyber-text-muted sm:inline">· {scopeTitle}</span>
          </div>

          <div className="flex items-center gap-2 app-no-drag">
            <Button variant="outline" size="sm" className="h-8 text-xs md:hidden" onClick={() => setMobileScopeOpen(true)}>
              <History className="h-3.5 w-3.5" />任务范围
            </Button>
            <Button
              size="sm"
              onClick={() => setExportDialogOpen(true)}
              className="h-8 gap-1.5 text-xs bg-cyber-neon-cyan/10 text-cyber-neon-cyan border border-cyber-neon-cyan/30 hover:bg-cyber-neon-cyan/20 hover:border-cyber-neon-cyan/50 transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              <span>统一下载</span>
            </Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          style={{ width: sidebarWidth }}
          className={`relative shrink-0 flex-col border-r border-cyber-border-subtle bg-cyber-bg-secondary/45 ${sidebarCollapsed ? 'hidden' : 'hidden md:flex'} ${isResizing ? 'select-none' : 'transition-[width] duration-200'}`}
        >
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-cyber-border-subtle bg-cyber-bg-secondary/30 px-3">
            <span className="text-xs font-medium text-cyber-text-muted">任务范围</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{renderScopeTree()}</div>
          {!sidebarCollapsed && (
            <div
              onMouseDown={startResizing}
              className={`absolute -right-[3px] top-0 bottom-0 z-20 w-1.5 touch-none cursor-col-resize transition-colors hover:bg-cyber-neon-cyan/25 ${isResizing ? 'bg-cyber-neon-cyan/35' : ''}`}
              title="拖动调整侧栏宽度"
            />
          )}
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-4">
          <div className="mx-auto max-w-[1800px] space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="文档总数" value={summary?.totals.document_count || 0} hint="包含正文与评论" icon={FileSearch} />
              <StatCard label="主体数" value={summary?.totals.subject_count || 0} hint="按主体 ID / 名称去重" icon={Users} />
              <StatCard label="正文" value={summary?.totals.content_count || 0} hint="非评论文档" icon={FileText} />
              <StatCard label="评论" value={summary?.totals.comment_count || 0} hint="保留父级关系" icon={MessageSquare} />
            </div>

          <section className="glass-panel rounded-lg p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <Select value={platform} onValueChange={setPlatform}>
                  <SelectTrigger className="h-8 w-28 text-xs bg-cyber-bg-secondary/60 border-cyber-border-subtle"><SelectValue placeholder="平台" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">全部平台</SelectItem>{(scopeSummary?.filters.platforms || summary?.filters.platforms || []).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger className="h-8 w-44 text-xs bg-cyber-bg-secondary/60 border-cyber-border-subtle font-medium"><SelectValue placeholder="类型" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main_only">全部正文/主帖 (排除评论)</SelectItem>
                    <SelectItem value="all">全部类型 (包含评论)</SelectItem>
                    {(scopeSummary?.filters.kinds || summary?.filters.kinds || []).map((value) => <SelectItem key={value} value={value}>{kindLabels[value] || value}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={keyword} onValueChange={setKeyword}>
                  <SelectTrigger className="h-8 w-32 text-xs bg-cyber-bg-secondary/60 border-cyber-border-subtle"><SelectValue placeholder="关键词" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">全部关键词</SelectItem>{(scopeSummary?.filters.keywords || summary?.filters.keywords || []).map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={subjectType} onValueChange={setSubjectType}>
                  <SelectTrigger className="h-8 w-28 text-xs bg-cyber-bg-secondary/60 border-cyber-border-subtle"><SelectValue placeholder="主体类型" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">全部主体</SelectItem>{(scopeSummary?.filters.subject_types || summary?.filters.subject_types || []).map((value) => <SelectItem key={value} value={value}>{subjectTypeLabels[value] || value}</SelectItem>)}</SelectContent>
                </Select>
                <form className="relative" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()) }}>
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyber-text-muted" />
                  <Input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="搜索标题、摘要、正文、主体或来源 ID" className="h-8 w-60 sm:w-72 pl-8 text-xs bg-cyber-bg-secondary/60 border-cyber-border-subtle" />
                </form>
              </div>

              <Button
                variant="ghost"
                size="sm"
                onClick={() => setColumnDialogOpen(true)}
                className="h-8 px-2.5 text-xs text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-tertiary/80 border border-transparent hover:border-cyber-border-subtle gap-1.5 ml-auto"
              >
                <Columns3 className="h-3.5 w-3.5" />
                <span>列设置</span>
              </Button>
            </div>

            <div className="overflow-x-auto rounded border border-cyber-border-subtle">
              <table className="w-full min-w-[960px] border-collapse text-xs">
                <thead className="bg-cyber-bg-tertiary/80 text-cyber-text-muted">
                  <tr>
                    {selectedColumns.map((column) => {
                      const activeSortOrder = getColumnSortState(column.key)
                      return (
                        <th
                          key={column.key}
                          onClick={() => handleColumnHeaderClick(column.key)}
                          className="group/th cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left font-medium hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary transition-colors"
                        >
                          <div className="inline-flex items-center gap-1.5">
                            <span className={activeSortOrder ? 'text-cyber-neon-cyan font-semibold' : ''}>
                              {column.label}
                            </span>
                            {activeSortOrder === 'desc' ? (
                              <ArrowDown className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                            ) : activeSortOrder === 'asc' ? (
                              <ArrowUp className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                            ) : (
                              <ArrowUpDown className="h-3.5 w-3.5 text-cyber-text-muted/40 opacity-0 group-hover/th:opacity-100 transition-opacity" />
                            )}
                          </div>
                        </th>
                      )
                    })}
                    <th className="px-3 py-2 text-center font-medium">来源</th>
                  </tr>
                </thead>
                <tbody>{documents?.items.map((document) => <tr key={`${document.documentId}:${document.provenance.runId || 'latest'}`} onClick={() => setSelectedDocument(document)} className="cursor-pointer border-t border-cyber-border-subtle hover:bg-cyber-neon-cyan/5">{selectedColumns.map((column) => <td key={column.key} className="max-w-[280px] px-3 py-2.5 align-top text-cyber-text-secondary">{cell(document, column.key)}</td>)}<td className="px-3 py-2.5 text-center">{document.sourceUrl ? <a href={document.sourceUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex text-cyber-neon-cyan"><ExternalLink className="h-4 w-4" /></a> : '—'}</td></tr>)}</tbody>
              </table>
              {!documentsQuery.isLoading && !documents?.items.length ? <div className="py-16 text-center text-xs text-cyber-text-muted">没有符合当前条件的数据</div> : null}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-cyber-text-muted"><span>共 {documents?.total || 0} 条 · 第 {documents?.page || 1} / {Math.max(documents?.pages || 1, 1)} 页</span><div className="flex gap-1"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft />上一页</Button><Button variant="outline" size="sm" disabled={!documents || page >= documents.pages} onClick={() => setPage((value) => value + 1)}>下一页<ChevronRight /></Button></div></div>
          </section>
        </div>
      </main>
    </div>

      <Dialog open={columnDialogOpen} onOpenChange={setColumnDialogOpen}><DialogContent className="max-h-[80vh] overflow-y-auto"><DialogHeader><DialogTitle>动态列设置</DialogTitle><DialogDescription>固定字段与当前结果中实际出现的指标、属性。缺失值保持为空。</DialogDescription></DialogHeader><div className="space-y-4">{['通用字段', '指标', '扩展属性'].map((group) => { const columns = [...BASE_COLUMNS.map(([key, label]) => ({ key, label, group: '通用字段' })), ...dynamicColumns].filter((column) => column.group === group); return columns.length ? <section key={group}><h3 className="mb-2 text-xs font-semibold text-cyber-text-muted">{group}</h3><div className="grid gap-2 sm:grid-cols-2">{columns.map((column) => <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded border border-cyber-border-subtle p-2 text-xs"><Checkbox checked={visibleColumns.has(column.key)} onCheckedChange={(checked) => toggleColumn(column.key, checked)} />{column.label}</label>)}</div></section> : null })}</div></DialogContent></Dialog>
      <Dialog open={mobileScopeOpen} onOpenChange={setMobileScopeOpen}><DialogContent className="left-0 top-0 h-dvh w-[min(360px,92vw)] max-w-none translate-x-0 translate-y-0 overflow-y-auto rounded-none"><DialogHeader><DialogTitle>任务范围</DialogTitle><DialogDescription>选择任务或采集轮次</DialogDescription></DialogHeader>{renderScopeTree(true)}</DialogContent></Dialog>
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-[440px] border-cyber-border-subtle bg-cyber-bg-panel/95 backdrop-blur-md p-5">
          <DialogHeader className="pb-1">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-cyber-text-primary">
              <Download className="h-4 w-4 text-cyber-neon-cyan" />
              数据导出下载
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2.5 py-1">
            <div className="grid gap-2">
              {EXPORT_FORMAT_OPTIONS.map((item) => {
                const isSelected = exportFormat === item.id
                const Icon = item.icon
                return (
                  <div
                    key={item.id}
                    onClick={() => setExportFormat(item.id as ExportFormat)}
                    className={`group flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 transition-all ${
                      isSelected
                        ? 'border-cyber-neon-cyan/60 bg-cyber-neon-cyan/10 shadow-sm'
                        : 'border-cyber-border-subtle bg-cyber-bg-secondary/40 hover:border-cyber-border-subtle/80 hover:bg-cyber-bg-secondary/70'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`rounded-lg p-2 transition-colors ${
                          isSelected ? 'bg-cyber-neon-cyan/20 text-cyber-neon-cyan' : 'bg-cyber-bg-tertiary/70 text-cyber-text-muted'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-cyber-text-primary">{item.title}</span>
                          <span className="font-mono text-[10px] text-cyber-text-muted">{item.ext}</span>
                        </div>
                        <p className="text-[11px] text-cyber-text-muted">{item.hint}</p>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="flex h-5 w-5 items-center justify-center rounded-full bg-cyber-neon-cyan text-black">
                        <Check className="h-3 w-3 stroke-[3]" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            <div className="flex items-center justify-between text-[11px] text-cyber-text-muted px-1 pt-1">
              <span>当前范围：{platform === 'all' ? '全部平台' : platformLabels.get(platform) || platform} · {kind === 'main_only' ? '仅正文' : '包含评论'}</span>
              <span className="font-mono font-medium text-cyber-text-secondary">{summary?.totals.document_count || 0} 条数据</span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-cyber-border-subtle/40">
            <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(false)} className="h-8 text-xs">
              取消
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs bg-cyber-neon-cyan text-black font-semibold hover:bg-cyber-neon-cyan/90 shadow-sm" asChild>
              <a
                href={exportUrl}
                onClick={() => {
                  setExportDialogOpen(false)
                  toast.success(`开始导出下载 (${exportFormat.toUpperCase()})`)
                }}
              >
                <Download className="h-3.5 w-3.5" />
                下载 {exportFormat.toUpperCase()}
              </a>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <DocumentDrawer document={selectedDocument} platformLabel={selectedDocument ? platformLabels.get(selectedDocument.platform) || selectedDocument.platform : ''} onOpenChange={(open) => { if (!open) setSelectedDocument(null) }} />
    </div>
  )
}
