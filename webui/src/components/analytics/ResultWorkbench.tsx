import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  ChevronsDown,
  ChevronsUp,
  BookOpen,
  Bookmark,
  Bot,
  Eye,
  ThumbsUp,
  Settings2,
  Sparkles,
  Share2,
  Clock,
  Code,
  Columns3,
  Download,
  ExternalLink,
  FileJson,
  FileSearch,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Check,
  Layers,
  MessageSquare,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  User,
  Users,
  X,
} from 'lucide-react'
import { dataApi, type CanonicalDocument } from '@/lib/api'
import { isMacPlatform } from '@/lib/utils'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { KnowledgeGraphView, ResearchReportsView } from '@/components/analytics/ResearchAssetsPanel'

type ExportCategory = 'data' | 'knowledge'
type ExportFormat =
  | 'xlsx'
  | 'csv'
  | 'json'
  | 'markdown'
  | 'obsidian'
  | 'notion'
  | 'dify'
  | 'feishu'
  | 'yuque'
  | 'ima'
  | 'logseq'
type ExportFieldMode = 'recommended' | 'visible' | 'all'

interface ExportFormatOption {
  id: ExportFormat
  title: string
  ext: string
  hint: string
  icon?: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  logoUrl?: string
  color?: string
  category: ExportCategory
  badge?: string
}

const DATA_FORMAT_OPTIONS: ExportFormatOption[] = [
  {
    id: 'xlsx',
    title: 'Excel 表格',
    ext: '.xlsx',
    hint: '推荐，包含核心业务指标与清洗字段',
    icon: FileSpreadsheet,
    color: '#10B981',
    category: 'data',
    badge: '最常用',
  },
  {
    id: 'csv',
    title: 'CSV 数据',
    ext: '.csv',
    hint: '轻量通用，适合 Excel / WPS / Python 分析',
    icon: FileSpreadsheet,
    color: '#059669',
    category: 'data',
  },
  {
    id: 'json',
    title: 'JSON 原始数据',
    ext: '.json',
    hint: '包含完整元数据与所有指标字段，适合系统对接',
    icon: FileJson,
    color: '#F59E0B',
    category: 'data',
  },
  {
    id: 'markdown',
    title: 'Markdown 全文合集',
    ext: '.md',
    hint: '合并所有筛选图文与 Frontmatter 的长文合集',
    logoUrl: '/logos/exporter_markdown.png',
    icon: FileText,
    color: '#38BDF8',
    category: 'data',
  },
]

const KNOWLEDGE_FORMAT_OPTIONS: ExportFormatOption[] = [
  {
    id: 'obsidian',
    title: 'Obsidian Vault',
    ext: '.zip',
    hint: '独立卡片笔记，构建双向链接与索引大纲',
    logoUrl: '/logos/exporter_obsidian.png',
    icon: Layers,
    color: '#A855F7',
    category: 'knowledge',
    badge: '双链知识库',
  },
  {
    id: 'notion',
    title: 'Notion 导入包',
    ext: '.zip',
    hint: 'Markdown 文件与属性映射 database.csv',
    logoUrl: '/logos/exporter_notion.png',
    icon: BookOpen,
    color: '#F43F5E',
    category: 'knowledge',
  },
  {
    id: 'dify',
    title: 'Dify / RAG 知识库',
    ext: '.zip',
    hint: '按语义自动切片为 Chunks，构建 AI 智能体',
    logoUrl: '/logos/exporter_dify.png',
    icon: Bot,
    color: '#3B82F6',
    category: 'knowledge',
    badge: 'RAG 智能体',
  },
  {
    id: 'feishu',
    title: '飞书 知识空间',
    ext: '.zip',
    hint: '包含多篇 Markdown 与 index.json 结构',
    logoUrl: '/logos/exporter_lark.png',
    icon: Share2,
    color: '#0284C7',
    category: 'knowledge',
  },
  {
    id: 'yuque',
    title: '语雀 知识库',
    ext: '.zip',
    hint: '包含标准目录树 toc.json 与文档包',
    logoUrl: '/logos/exporter_yuque.png',
    icon: BookOpen,
    color: '#22C55E',
    category: 'knowledge',
  },
  {
    id: 'ima',
    title: '腾讯 IMA',
    ext: '.zip',
    hint: '腾讯 IMA 知识库专有导入格式包',
    logoUrl: '/logos/exporter_ima.png',
    icon: Sparkles,
    color: '#10B981',
    category: 'knowledge',
  },
  {
    id: 'logseq',
    title: 'Logseq 大纲包',
    ext: '.zip',
    hint: '包含大纲属性块结构与 Pages 笔记库',
    logoUrl: '/logos/exporter_logseq.png',
    icon: Layers,
    color: '#06B6D4',
    category: 'knowledge',
  },
]

const BASE_COLUMNS = [
  ['title', '标题 / 摘要'],
  ['platform', '平台'],
  ['kind', '类型'],
  ['subject', '主体'],
  ['keyword', '关键词'],
  ['publishedAt', '发布时间'],
] as const

const DEFAULT_COLUMNS = new Set(BASE_COLUMNS.map(([key]) => key))

type PivotViewState = {
  version: 1
  platform: string
  kind: string
  keyword: string
  subjectType: string
  queryInput: string
  query: string
  sortBy: string
  sortOrder: 'asc' | 'desc'
  page: number
  visibleColumns: string[]
}

type PivotLayoutState = {
  version: 1
  sidebarCollapsed: boolean
  sidebarWidth: number
  expandedTasks: string[]
}

const PIVOT_VIEW_STORAGE_PREFIX = 'unisearch-pivot-view-v1:'
const PIVOT_LAYOUT_STORAGE_KEY = 'unisearch-pivot-layout-v1'

function defaultPivotViewState(): PivotViewState {
  return {
    version: 1,
    platform: 'all',
    kind: 'main_only',
    keyword: 'all',
    subjectType: 'all',
    queryInput: '',
    query: '',
    sortBy: 'fetched_at',
    sortOrder: 'desc',
    page: 1,
    visibleColumns: [...DEFAULT_COLUMNS],
  }
}

function loadPivotViewState(scope: string): PivotViewState | null {
  try {
    const raw = sessionStorage.getItem(`${PIVOT_VIEW_STORAGE_PREFIX}${scope}`)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<PivotViewState>
    if (saved.version !== 1) return null
    const fallback = defaultPivotViewState()
    return {
      version: 1,
      platform: typeof saved.platform === 'string' ? saved.platform : fallback.platform,
      kind: typeof saved.kind === 'string' ? saved.kind : fallback.kind,
      keyword: typeof saved.keyword === 'string' ? saved.keyword : fallback.keyword,
      subjectType: typeof saved.subjectType === 'string' ? saved.subjectType : fallback.subjectType,
      queryInput: typeof saved.queryInput === 'string' ? saved.queryInput : fallback.queryInput,
      query: typeof saved.query === 'string' ? saved.query : fallback.query,
      sortBy: typeof saved.sortBy === 'string' ? saved.sortBy : fallback.sortBy,
      sortOrder: saved.sortOrder === 'asc' ? 'asc' : 'desc',
      page: typeof saved.page === 'number' && Number.isInteger(saved.page) && saved.page > 0 ? saved.page : 1,
      visibleColumns: Array.isArray(saved.visibleColumns)
        ? saved.visibleColumns.filter((column): column is string => typeof column === 'string')
        : fallback.visibleColumns,
    }
  } catch {
    return null
  }
}

function savePivotViewState(scope: string, state: PivotViewState) {
  try {
    sessionStorage.setItem(`${PIVOT_VIEW_STORAGE_PREFIX}${scope}`, JSON.stringify(state))
  } catch {
    // 会话存储不可用时不影响当前页面继续使用。
  }
}

function removePivotViewState(scope: string) {
  try {
    sessionStorage.removeItem(`${PIVOT_VIEW_STORAGE_PREFIX}${scope}`)
  } catch {
    // 忽略不可用的会话存储。
  }
}

function loadPivotLayoutState(): PivotLayoutState | null {
  try {
    const raw = sessionStorage.getItem(PIVOT_LAYOUT_STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<PivotLayoutState>
    if (saved.version !== 1) return null
    return {
      version: 1,
      sidebarCollapsed: saved.sidebarCollapsed === true,
      sidebarWidth: typeof saved.sidebarWidth === 'number'
        ? Math.max(200, Math.min(saved.sidebarWidth, 520))
        : 270,
      expandedTasks: Array.isArray(saved.expandedTasks)
        ? saved.expandedTasks.filter((taskId): taskId is string => typeof taskId === 'string')
        : [],
    }
  } catch {
    return null
  }
}

function savePivotLayoutState(state: PivotLayoutState) {
  try {
    sessionStorage.setItem(PIVOT_LAYOUT_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 会话存储不可用时不影响当前页面继续使用。
  }
}

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

const PLATFORM_CONFIGS: Record<string, { label: string; shortLabel?: string; bg: string; text: string; border: string }> = {
  // 通用与工具类
  media_parser: { label: '无水印解析', shortLabel: '解析', bg: 'bg-indigo-500/10 dark:bg-indigo-400/15', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/20' },
  universal: { label: '通用采集', shortLabel: '通用', bg: 'bg-sky-500/10 dark:bg-sky-400/15', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/20' },
  web: { label: '网页采集', shortLabel: '网页', bg: 'bg-emerald-500/10 dark:bg-emerald-400/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  web_reader: { label: '网页正文', shortLabel: '正文', bg: 'bg-slate-500/10 dark:bg-slate-400/15', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-500/20' },

  // 通用搜索引擎
  baidu: { label: '百度', shortLabel: '度', bg: 'bg-blue-500/10 dark:bg-blue-400/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/20' },
  bing: { label: '必应', shortLabel: '应', bg: 'bg-teal-500/10 dark:bg-teal-400/15', text: 'text-teal-600 dark:text-teal-400', border: 'border-teal-500/20' },
  so360: { label: '360搜索', shortLabel: '360', bg: 'bg-emerald-500/10 dark:bg-emerald-400/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  sogou: { label: '搜狗', shortLabel: '狗', bg: 'bg-orange-500/10 dark:bg-orange-400/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20' },
  toutiao: { label: '头条搜索', shortLabel: '头条', bg: 'bg-red-500/10 dark:bg-red-400/15', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/20' },
  quark: { label: '神马搜索', shortLabel: '神马', bg: 'bg-amber-600/10 dark:bg-amber-400/15', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-500/20' },
  chinaso: { label: '中国搜索', shortLabel: '国搜', bg: 'bg-red-700/10 dark:bg-red-500/15', text: 'text-red-800 dark:text-red-300', border: 'border-red-600/20' },

  // 学术、资讯与代码
  arxiv: { label: 'arXiv', shortLabel: 'arXiv', bg: 'bg-rose-700/10 dark:bg-rose-500/15', text: 'text-rose-800 dark:text-rose-300', border: 'border-rose-700/20' },
  github_repositories: { label: 'GitHub 仓库', shortLabel: 'GH', bg: 'bg-slate-700/10 dark:bg-slate-300/15', text: 'text-slate-800 dark:text-slate-200', border: 'border-slate-600/20' },
  aihot: { label: 'AI HOT', shortLabel: 'HOT', bg: 'bg-orange-500/10 dark:bg-orange-400/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20' },
  kr36: { label: '36氪', shortLabel: '36氪', bg: 'bg-sky-600/10 dark:bg-sky-400/15', text: 'text-sky-700 dark:text-sky-300', border: 'border-sky-500/20' },

  // 社交与社区平台
  xhs: { label: '小红书', shortLabel: '小红书', bg: 'bg-rose-500/10 dark:bg-rose-400/15', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/20' },
  douyin: { label: '抖音', shortLabel: '抖音', bg: 'bg-slate-800/10 dark:bg-slate-200/15', text: 'text-slate-700 dark:text-slate-200', border: 'border-slate-400/20' },
  kuaishou: { label: '快手', shortLabel: '快手', bg: 'bg-amber-500/10 dark:bg-amber-400/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20' },
  bili: { label: '哔哩哔哩', shortLabel: 'B站', bg: 'bg-pink-500/10 dark:bg-pink-400/15', text: 'text-pink-600 dark:text-pink-400', border: 'border-pink-500/20' },
  weibo: { label: '微博', shortLabel: '微博', bg: 'bg-yellow-500/10 dark:bg-yellow-400/15', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-500/20' },
  tieba: { label: '贴吧', shortLabel: '贴吧', bg: 'bg-indigo-500/10 dark:bg-indigo-400/15', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/20' },
  zhihu: { label: '知乎', shortLabel: '知乎', bg: 'bg-sky-500/10 dark:bg-sky-400/15', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/20' },

  // 招聘与维权平台
  boss: { label: 'BOSS直聘', shortLabel: 'BOSS', bg: 'bg-cyan-600/10 dark:bg-cyan-400/15', text: 'text-cyan-700 dark:text-cyan-300', border: 'border-cyan-600/20' },
  zhaopin: { label: '智联招聘', shortLabel: '智联', bg: 'bg-cyan-500/10 dark:bg-cyan-400/15', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/20' },
  job51: { label: '前程无忧', shortLabel: '前程', bg: 'bg-orange-500/10 dark:bg-orange-400/15', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500/20' },
  liepin: { label: '猎聘网', shortLabel: '猎聘', bg: 'bg-emerald-500/10 dark:bg-emerald-400/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  heimao: { label: '黑猫投诉', shortLabel: '黑猫', bg: 'bg-red-600/10 dark:bg-red-500/15', text: 'text-red-700 dark:text-red-400', border: 'border-red-600/20' },

  // AI 搜索问答平台（简约低调大厂美学，低饱和品牌色）
  deepseek: { label: 'DeepSeek', shortLabel: 'DS', bg: 'bg-purple-500/10 dark:bg-purple-400/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/20' },
  kimi: { label: 'Kimi', shortLabel: 'Kimi', bg: 'bg-sky-500/10 dark:bg-sky-400/15', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/20' },
  doubao: { label: '豆包', shortLabel: '豆包', bg: 'bg-blue-600/10 dark:bg-blue-400/15', text: 'text-blue-700 dark:text-blue-400', border: 'border-blue-600/20' },
  qwen: { label: '通义千问', shortLabel: '千问', bg: 'bg-violet-500/10 dark:bg-violet-400/15', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/20' },
  yuanbao: { label: '腾讯元宝', shortLabel: '元宝', bg: 'bg-emerald-500/10 dark:bg-emerald-400/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20' },
  nami: { label: '纳米AI', shortLabel: '纳米', bg: 'bg-teal-500/10 dark:bg-teal-400/15', text: 'text-teal-600 dark:text-teal-400', border: 'border-teal-500/20' },
  wenxin: { label: '文心一言', shortLabel: '文心', bg: 'bg-amber-500/10 dark:bg-amber-400/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20' },
}

function renderPlatformBadge(platformKey: string, fallbackLabel?: string, compact = false) {
  const config = PLATFORM_CONFIGS[platformKey]
  const label = compact ? (config?.shortLabel || config?.label || fallbackLabel || platformKey) : (config?.label || fallbackLabel || platformKey)
  const border = config?.border || 'border-cyber-border-subtle'
  const bg = config?.bg || 'bg-cyber-bg-secondary'
  const text = config?.text || 'text-cyber-text-secondary'

  return (
    <span className={`inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap rounded-md border ${border} ${bg} ${text} ${compact ? 'px-1.5 py-0 text-[9.5px]' : 'px-2 py-0.5 text-[11px]'} font-medium transition-colors`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-75" />
      {label}
    </span>
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
  const assets = document.assets || []
  return assets.find((asset) => asset.role === 'cover')
    || assets.find((asset) => asset.role === 'thumbnail')
    || assets.find((asset) => asset.kind === 'image')
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

function getColumnWidthClass(key: string): string {
  if (key === 'title') return 'min-w-[340px] max-w-[520px]'
  if (key === 'platform') return 'min-w-[100px] w-[100px] whitespace-nowrap'
  if (key === 'kind') return 'min-w-[80px] w-[80px] whitespace-nowrap'
  if (key === 'subject') return 'min-w-[130px] max-w-[180px]'
  if (key === 'keyword') return 'min-w-[110px] max-w-[170px]'
  if (key === 'publishedAt') return 'min-w-[130px] w-[130px] whitespace-nowrap font-mono'
  if (key.startsWith('metric:')) return 'min-w-[90px] w-[90px] whitespace-nowrap text-right font-mono'
  if (key.startsWith('attribute:')) return 'min-w-[120px] max-w-[220px]'
  return 'min-w-[100px]'
}

function StatRibbonItem({ label, value, total, hint, icon: Icon, isFiltered = false }: {
  label: string
  value: number
  total?: number
  hint: string
  icon: typeof FileSearch
  isFiltered?: boolean
}) {
  const showRatio = isFiltered && total !== undefined && total > 0 && value < total

  return (
    <div
      className="group flex min-w-0 items-center justify-between gap-2 rounded-lg px-2.5 py-1 sm:px-3 sm:py-1.5 transition-colors cursor-default select-none hover:bg-cyber-bg-secondary/40 text-cyber-text-secondary"
      title={hint}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className={`shrink-0 rounded-md p-1 transition-colors ${isFiltered ? 'bg-cyber-neon-cyan/15 text-cyber-neon-cyan' : 'bg-cyber-bg-tertiary/70 text-cyber-text-muted group-hover:text-cyber-text-primary'
          }`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="truncate text-xs font-medium text-cyber-text-muted group-hover:text-cyber-text-primary transition-colors">
          {label}
        </span>
      </div>

      <div className="flex items-baseline gap-1 shrink-0 font-mono">
        <span className={`text-sm sm:text-base font-bold tracking-tight ${isFiltered ? 'text-cyber-neon-cyan' : 'text-cyber-text-primary'
          }`}>
          {formatNumber(value)}
        </span>
        {showRatio && (
          <span className="text-[11px] font-normal text-cyber-text-muted/70">
            / {formatNumber(total)}
          </span>
        )}
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
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
          关联评论区
        </h3>
        <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 text-xs text-slate-400 animate-pulse">
          正在检索该主帖关联评论...
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
          关联评论区 ({comments.length})
        </h3>
      </div>
      {comments.length > 0 ? (
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {comments.map((comment) => (
            <div key={comment.documentId} className="rounded-2xl border border-slate-100 bg-slate-50/50 p-3.5 text-xs space-y-1.5 hover:border-slate-200 hover:bg-white hover:shadow-xs transition-all">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-800 flex items-center gap-1">
                  <User className="h-3 w-3 text-blue-500/80" />
                  {comment.subject?.name || comment.subject?.id || '匿名用户'}
                </span>
                <span>{formatDate(comment.publishedAt)}</span>
              </div>
              <p className="text-slate-700 leading-relaxed font-sans whitespace-pre-wrap break-words">
                {comment.markdown || comment.summary || '—'}
              </p>
              {comment.metrics && Object.keys(comment.metrics).length > 0 && (
                <div className="flex items-center gap-3 pt-1 text-[10px] text-slate-400 font-mono">
                  {typeof comment.metrics.likes === 'number' && <span>👍 {formatNumber(comment.metrics.likes)}</span>}
                  {typeof comment.metrics.replies === 'number' && <span>💬 {formatNumber(comment.metrics.replies)}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 bg-slate-50/40 p-4 text-center text-xs text-slate-400">
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
  const [drawerWidth, setDrawerWidth] = useState(580)
  const [isResizing, setIsResizing] = useState(false)
  const [techDetailsOpen, setTechDetailsOpen] = useState(false)

  const startResizing = (mouseDownEvent: React.MouseEvent) => {
    mouseDownEvent.preventDefault()
    setIsResizing(true)
    const startX = mouseDownEvent.clientX
    const startWidth = drawerWidth

    const onMouseMove = (mouseMoveEvent: MouseEvent) => {
      const deltaX = startX - mouseMoveEvent.clientX
      const newWidth = Math.max(380, Math.min(startWidth + deltaX, window.innerWidth * 0.88))
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

  // 判断摘要是否与正文或标题大面积重复
  const isSummaryIdentical = useMemo(() => {
    if (!document?.summary) return true
    const s = document.summary.trim()
    const m = document.markdown ? document.markdown.trim() : ''
    const t = document.title ? document.title.trim() : ''
    if (s === m || s === t) return true
    if (m && s.length > 20 && m.startsWith(s.slice(0, Math.min(40, s.length)))) return true
    if (t && s.length > 20 && t.startsWith(s.slice(0, Math.min(40, s.length)))) return true
    return false
  }, [document])

  return (
    <Dialog open={Boolean(document)} onOpenChange={onOpenChange}>
      <DialogContent
        hideClose
        overlayClassName="bg-black/25 backdrop-blur-xs"
        style={{ width: `min(${drawerWidth}px, 94vw)` }}
        className={`left-auto right-0 top-0 flex h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-y-0 border-r-0 border-l border-slate-200/80 bg-white p-0 shadow-2xl backdrop-blur-md data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right ${isResizing ? 'select-none' : ''}`}
      >
        <div
          onMouseDown={startResizing}
          className={`absolute -left-[3px] top-0 bottom-0 z-50 w-1.5 touch-none cursor-col-resize transition-colors hover:bg-blue-500/25 ${isResizing ? 'bg-blue-500/35' : ''}`}
          title="拖动调整抽屉宽度"
        />
        {document ? (
          <>
            {/* 顶栏 Header */}
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-100 bg-white/95 px-6 sm:px-7 gap-3 backdrop-blur-md">
              <div className="flex items-center gap-2.5 min-w-0 flex-1 overflow-hidden">
                {renderPlatformBadge(document.platform, platformLabel)}
                <span className="shrink-0 whitespace-nowrap rounded-full bg-slate-100 px-3 py-0.5 text-xs font-normal text-slate-600 border border-slate-200/60">
                  {kindLabels[document.kind] || document.kind}
                </span>
                {document.keyword && !document.keyword.startsWith('http') ? (
                  <span className="shrink-0 max-w-[160px] truncate rounded-full bg-blue-50/80 text-blue-600 border border-blue-100/80 px-3 py-0.5 text-xs font-medium" title={document.keyword}>
                    #{document.keyword}
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {document.sourceUrl && (
                  <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-lg px-3 text-xs font-medium text-slate-700 bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 hover:text-blue-600 transition-all shadow-xs" asChild>
                    <a href={document.sourceUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 text-slate-500 group-hover:text-blue-600" />
                      <span>打开原帖</span>
                    </a>
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onOpenChange(false)}
                  className="h-8 w-8 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                  title="关闭详情面板"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* 内容区 */}
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6 sm:p-7 bg-white">
              {/* 大标题 & 作者/时间属性 */}
              <div className="space-y-3.5">
                <h2
                  className="line-clamp-2 text-xl sm:text-2xl font-bold tracking-tight leading-snug text-slate-900 break-words"
                  title={document.title || '无标题文档'}
                >
                  {document.title || '无标题文档'}
                </h2>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-slate-50/90 border border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5 font-medium text-slate-700">
                    <User className="h-3.5 w-3.5 text-blue-500" />
                    <span className="truncate max-w-[240px]">{document.subject.name || document.subject.id || '未知作者'}</span>
                    <span className="text-[10px] text-slate-400 shrink-0 font-normal">
                      ({subjectTypeLabels[document.subject.type] || document.subject.type})
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 text-slate-400">
                    <Clock className="h-3.5 w-3.5" />
                    <span>发布于 {formatDate(document.publishedAt)}</span>
                  </div>
                </div>

                {/* 仅当摘要非空且与正文/标题不重复时显示 */}
                {document.summary && !isSummaryIdentical ? (
                  <div className="rounded-2xl border border-blue-100/90 bg-gradient-to-br from-blue-50/70 via-indigo-50/30 to-purple-50/20 p-4 text-xs leading-relaxed text-slate-700 shadow-xs">
                    <p className="mb-1.5 font-semibold text-blue-600 flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-blue-500" />
                      <span>AI 摘要提炼</span>
                    </p>
                    <p className="whitespace-pre-wrap break-words">{document.summary}</p>
                  </div>
                ) : null}
              </div>

              {/* 封面图 / 媒体展示 */}
              {cover ? (
                <div className="group relative overflow-hidden rounded-2xl border border-slate-100 bg-slate-50/50 shadow-xs flex items-center justify-center max-h-80 p-2">
                  <img
                    src={cover.url}
                    alt={document.title || '文档封面'}
                    referrerPolicy="no-referrer"
                    className="max-h-76 w-auto max-w-full rounded-xl object-contain transition-transform duration-300 group-hover:scale-[1.01]"
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
              <section className="space-y-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-slate-400" />
                  正文内容
                </h3>
                <div className="whitespace-pre-wrap break-words rounded-2xl border border-slate-100 bg-slate-50/50 p-5 font-sans text-sm leading-7 text-slate-700 shadow-xs selection:bg-blue-100">
                  {document.markdown || document.summary || '—'}
                </div>
              </section>

              {/* 引用 */}
              {document.citations.length ? (
                <section className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    引用出处 ({document.citations.length})
                  </h3>
                  <div className="space-y-2">
                    {document.citations.map((citation) => (
                      <a
                        key={citation.url}
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-xl border border-slate-100 bg-white p-3 text-xs text-blue-600 transition-all hover:border-blue-200 hover:bg-blue-50/40 hover:shadow-xs"
                      >
                        {citation.title || citation.source || citation.url}
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* 关联评论区 */}
              <CommentsSection document={document} />

              {/* 高级技术元数据折叠区 */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setTechDetailsOpen(!techDetailsOpen)}
                  className="flex w-full items-center justify-between rounded-xl border border-slate-100 bg-slate-50/60 px-4 py-2.5 text-xs font-medium text-slate-500 hover:bg-slate-100/70 hover:text-slate-800 transition-colors"
                >
                  <span className="flex items-center gap-1.5">
                    <Code className="h-3.5 w-3.5 text-slate-400" />
                    高级技术属性 (ID & 原始资源)
                  </span>
                  {techDetailsOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
                </button>

                {techDetailsOpen && (
                  <div className="mt-3 space-y-4 rounded-2xl border border-slate-100 bg-slate-50/40 p-4">
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

                    {document.assets && document.assets.length ? (
                      <div>
                        <p className="mb-2 text-[11px] font-medium text-slate-400">
                          底层资源 URL 数组 ({document.assets.length})
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {document.assets.map((asset) => (
                            <a
                              key={asset.assetId}
                              href={asset.url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate rounded-lg border border-slate-100 bg-white p-2.5 font-mono text-[10px] text-blue-600 hover:bg-blue-50/50 hover:underline transition-colors"
                            >
                              {assetRoleLabels[asset.role] || asset.role} · {asset.kind}
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
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/60 p-3 transition-colors hover:bg-slate-50">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 truncate text-xs font-medium text-slate-700 ${mono ? 'font-mono text-[11px]' : ''}`} title={String(value)}>
        {displayValue(value, 300)}
      </p>
    </div>
  )
}

function MetricCard({ label, keyName, value }: { label: string; keyName: string; value: unknown }) {
  const numValue = typeof value === 'number' ? value : Number(value) || 0
  const isZero = numValue === 0

  const getIcon = () => {
    const k = keyName.toLowerCase()
    const l = label.toLowerCase()
    if (k.includes('like') || l.includes('赞')) return <ThumbsUp className="h-3.5 w-3.5 text-rose-500/80" />
    if (k.includes('collect') || k.includes('favorite') || l.includes('藏')) return <Bookmark className="h-3.5 w-3.5 text-amber-500/80" />
    if (k.includes('comment') || k.includes('reply') || l.includes('评')) return <MessageSquare className="h-3.5 w-3.5 text-blue-500/80" />
    if (k.includes('share') || l.includes('享')) return <Share2 className="h-3.5 w-3.5 text-emerald-500/80" />
    if (k.includes('view') || k.includes('read') || l.includes('看')) return <Eye className="h-3.5 w-3.5 text-indigo-500/80" />
    return <Sparkles className="h-3.5 w-3.5 text-slate-400" />
  }

  return (
    <div className="group min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 p-3.5 transition-all hover:border-slate-200 hover:bg-white hover:shadow-xs flex flex-col justify-between">
      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
        {getIcon()}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-2 text-xl font-bold font-mono tracking-tight">
        <span className={isZero ? 'text-slate-300' : 'text-slate-800 group-hover:text-blue-600 transition-colors'}>
          {formatNumber(numValue)}
        </span>
      </div>
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
    <section className="space-y-2">
      <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
        {numeric ? <Sparkles className="h-3.5 w-3.5 text-amber-500/80" /> : <Tag className="h-3.5 w-3.5 text-slate-400" />}
        {title}
      </h3>
      <div className={`grid gap-2.5 ${gridColsClass}`}>
        {Object.entries(record).map(([key, value]) => (
          numeric ? (
            <MetricCard key={key} label={labels[key] || key} keyName={key} value={value} />
          ) : (
            <Detail key={key} label={labels[key] || key} value={value} />
          )
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
  const initialViewRef = useRef<{ state: PivotViewState; restored: boolean } | null>(null)
  if (!initialViewRef.current) {
    const restored = loadPivotViewState(initialScope)
    initialViewRef.current = { state: restored || defaultPivotViewState(), restored: Boolean(restored) }
  }
  const initialView = initialViewRef.current.state
  const initialLayoutRef = useRef<PivotLayoutState | null | undefined>(undefined)
  if (initialLayoutRef.current === undefined) initialLayoutRef.current = loadPivotLayoutState()
  const initialLayout = initialLayoutRef.current
  const initializedDynamicColumns = useRef(initialViewRef.current.restored)
  const restoringViewState = useRef(true)
  const initializedTaskExpansion = useRef(Boolean(initialLayout))
  const [scope, setScope] = useState(initialScope)
  const [platform, setPlatform] = useState(initialView.platform)
  const [kind, setKind] = useState(initialView.kind)
  const [keyword, setKeyword] = useState(initialView.keyword)
  const [subjectType, setSubjectType] = useState(initialView.subjectType)
  const [queryInput, setQueryInput] = useState(initialView.queryInput)
  const [query, setQuery] = useState(initialView.query)
  const [sortBy, setSortBy] = useState(initialView.sortBy)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(initialView.sortOrder)
  const [page, setPage] = useState(initialView.page)
  const [pageSize, setPageSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('unisearch-pivot-page-size')
      const parsed = saved ? Number(saved) : NaN
      return [20, 50, 100, 200].includes(parsed) ? parsed : 50
    } catch {
      return 50
    }
  })
  const [selectedDocument, setSelectedDocument] = useState<CanonicalDocument | null>(null)
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(new Set(initialView.visibleColumns))
  const [columnDialogOpen, setColumnDialogOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialLayout?.sidebarCollapsed || false)
  const [sidebarWidth, setSidebarWidth] = useState(initialLayout?.sidebarWidth || 270)
  const [isResizing, setIsResizing] = useState(false)
  const [activeMainTab, setActiveMainTab] = useState<'pivot' | 'graph' | 'reports'>('pivot')
  const [exportCategory, setExportCategory] = useState<ExportCategory>('data')
  const [exportFormat, setExportFormat] = useState<ExportFormat>('xlsx')
  const [exportFieldMode, setExportFieldMode] = useState<ExportFieldMode>('recommended')
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set(initialLayout?.expandedTasks || []))

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
  const taskItems = tasksQuery.data?.items
  const tasks = useMemo(() => taskItems ?? [], [taskItems])
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
    queryKey: ['analytics-documents', filters, sortBy, sortOrder, page, pageSize],
    queryFn: async () => (await dataApi.getAnalyticsDocuments({ ...filters, sort_by: sortBy, sort_order: sortOrder, page, page_size: pageSize })).data,
    refetchInterval: crawlerStatus === 'running' ? 1500 : false,
  })
  const scopeSummary = scopeSummaryQuery.data
  const summary = summaryQuery.data
  const documents = documentsQuery.data
  const platformLabels = useMemo(() => new Map(scopeSummary?.filters?.platforms || summary?.filters?.platforms || []), [scopeSummary, summary])

  const currentScopeName = useMemo(() => {
    if (scope === 'all') return '全部任务数据'
    if (selectedThreadId) {
      const task = tasks.find((t) => t.thread_id === selectedThreadId)
      return task?.task_title || task?.thread_id || '任务数据'
    }
    if (selectedWorkflowId) {
      for (const task of tasks) {
        const round = task.rounds?.find((r: any) => r.plan_id === selectedWorkflowId)
        if (round) return round.round_title || round.plan_id || '轮次数据'
      }
    }
    if (selectedRunId) {
      for (const task of tasks) {
        for (const round of (task.rounds || [])) {
          const run = round.runs?.find((r: any) => r.run_id === selectedRunId)
          if (run) return `${run.platform_label || run.platform || '批次'} · 采集数据`
        }
      }
    }
    return '数据透视'
  }, [scope, selectedThreadId, selectedWorkflowId, selectedRunId, tasks])

  // 关键词列表与对应的统计计数（纯净关键词按数据量降序与名称排序）
  const keywordStats = useMemo(() => {
    const counts = new Map<string, number>()
    const groupList = scopeSummary?.by_keyword || summary?.by_keyword || []
    for (const g of groupList) {
      if (g.keyword) counts.set(g.keyword, g.document_count)
    }
    const kwList = (scopeSummary?.filters?.keywords || summary?.filters?.keywords || [])
      .filter((kw) => {
        const trimmed = (kw || '').trim()
        return Boolean(trimmed) && trimmed !== '指定作品' && trimmed !== '指定内容' && !/^https?:\/\//i.test(trimmed) && !/^www\./i.test(trimmed) && !trimmed.startsWith('作者:') && !trimmed.startsWith('创作者:') && !trimmed.startsWith('UP:')
      })
    const list = kwList.map((kw) => {
      const trimmed = (kw || '').trim()
      return {
        name: trimmed,
        count: counts.get(kw),
        displayLabel: trimmed,
      }
    })

    // 排序：数据量 count 降序 -> 中文拼音 / 字母表升序
    list.sort((a, b) => {
      const countA = a.count || 0
      const countB = b.count || 0
      if (countA !== countB) {
        return countB - countA
      }
      return (a.name || '').localeCompare(b.name || '', 'zh-CN')
    })

    return list
  }, [scopeSummary, summary])

  const dynamicColumns = useMemo(() => [
    ...(scopeSummary?.filters?.metric_keys || summary?.filters?.metric_keys || []).map((key) => ({ key: `metric:${key}`, label: metricLabels[key] || key, group: '指标' })),
    ...(scopeSummary?.filters?.attribute_keys || summary?.filters?.attribute_keys || [])
      .filter((key) => key !== 'reasoningContent')
      .map((key) => ({ key: `attribute:${key}`, label: attributeLabels[key] || key, group: '扩展属性' })),
  ], [scopeSummary, summary])

  const currentViewState = useMemo<PivotViewState>(() => ({
    version: 1,
    platform,
    kind,
    keyword,
    subjectType,
    queryInput,
    query,
    sortBy,
    sortOrder,
    page,
    visibleColumns: [...visibleColumns],
  }), [platform, kind, keyword, subjectType, queryInput, query, sortBy, sortOrder, page, visibleColumns])

  const switchScope = useCallback((nextScope: string) => {
    if (nextScope === scope) return

    savePivotViewState(scope, currentViewState)
    const restored = loadPivotViewState(nextScope)
    const next = restored || defaultPivotViewState()

    restoringViewState.current = true
    initializedDynamicColumns.current = Boolean(restored)
    setScope(nextScope)
    setPlatform(next.platform)
    setKind(next.kind)
    setKeyword(next.keyword)
    setSubjectType(next.subjectType)
    setQueryInput(next.queryInput)
    setQuery(next.query)
    setSortBy(next.sortBy)
    setSortOrder(next.sortOrder)
    setPage(next.page)
    setVisibleColumns(new Set(next.visibleColumns))

    // 任务切换时不继承一次性交互界面。
    setSelectedDocument(null)
    setColumnDialogOpen(false)
    setExportDialogOpen(false)

    // 手风琴模式：切换范围时自动同步侧栏展开状态
    if (nextScope === 'all') {
      setExpandedTasks(new Set())
    } else if (nextScope.startsWith('thread:')) {
      const threadId = nextScope.slice(7)
      setExpandedTasks(new Set([threadId]))
    } else if (nextScope.startsWith('plan:')) {
      const planId = nextScope.slice(5)
      const parentTask = tasks.find((t) => t.rounds?.some((r: any) => r.plan_id === planId))
      if (parentTask) {
        setExpandedTasks(new Set([parentTask.thread_id]))
      }
    }
  }, [currentViewState, scope, tasks])

  const previousInitialScope = useRef<string | null>(null)
  useEffect(() => {
    if (previousInitialScope.current === initialScope) return
    previousInitialScope.current = initialScope
    if (initialScope !== scope) switchScope(initialScope)
  }, [initialScope, scope, switchScope])
  useEffect(() => {
    if (scope.startsWith('plan:') && tasks.length > 0) {
      const planId = scope.slice(5)
      const parentTask = tasks.find((t) => t.rounds?.some((r: any) => r.plan_id === planId))
      if (parentTask) {
        setExpandedTasks((prev) => {
          if (prev.has(parentTask.thread_id)) return prev
          return new Set([parentTask.thread_id])
        })
      }
    }
  }, [scope, tasks])
  useEffect(() => {
    savePivotViewState(scope, currentViewState)
  }, [scope, currentViewState])
  useEffect(() => {
    if (restoringViewState.current) {
      restoringViewState.current = false
      setSelectedDocument(null)
      return
    }
    setPage(1)
    setSelectedDocument(null)
  }, [scope, platform, kind, keyword, subjectType, query, sortBy, sortOrder, pageSize])
  useEffect(() => {
    if (initializedDynamicColumns.current || !dynamicColumns.length) return
    initializedDynamicColumns.current = true
    setVisibleColumns((current) => new Set([...current, ...dynamicColumns.slice(0, 6).map((column) => column.key)]))
  }, [dynamicColumns])
  useEffect(() => {
    if (!scopeSummary?.filters) return
    const availablePlatforms = new Set(scopeSummary.filters.platforms?.map(([value]) => value) || [])
    const availableKinds = new Set(scopeSummary.filters.kinds || [])
    const availableKeywords = new Set(scopeSummary.filters.keywords || [])
    const availableSubjectTypes = new Set(scopeSummary.filters.subject_types || [])

    if (platform !== 'all' && !availablePlatforms.has(platform)) setPlatform('all')
    if (!['all', 'main_only'].includes(kind) && !availableKinds.has(kind)) setKind('main_only')
    if (keyword !== 'all' && !availableKeywords.has(keyword)) setKeyword('all')
    if (subjectType !== 'all' && !availableSubjectTypes.has(subjectType)) setSubjectType('all')
  }, [scopeSummary, platform, kind, keyword, subjectType])
  useEffect(() => {
    if (!documents) return
    const lastPage = Math.max(1, documents.pages || 1)
    if (page > lastPage) setPage(lastPage)
  }, [documents, page])
  useEffect(() => {
    savePivotLayoutState({
      version: 1,
      sidebarCollapsed,
      sidebarWidth,
      expandedTasks: [...expandedTasks],
    })
  }, [sidebarCollapsed, sidebarWidth, expandedTasks])
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
      if (scope.endsWith(id)) switchScope('all')
      if (type === 'task') {
        removePivotViewState(`thread:${id}`)
        tasks.find((task) => task.thread_id === id)?.rounds?.forEach((round: any) => removePivotViewState(`plan:${round.plan_id}`))
        setExpandedTasks((current) => {
          const next = new Set(current)
          next.delete(id)
          return next
        })
      } else if (type === 'round') {
        removePivotViewState(`plan:${id}`)
      } else {
        removePivotViewState(`run:${id}`)
      }
      await queryClient.invalidateQueries({ queryKey: ['analytics-tasks'] })
      await queryClient.invalidateQueries({ queryKey: ['analytics-summary'] })
      await queryClient.invalidateQueries({ queryKey: ['analytics-documents'] })
      await queryClient.invalidateQueries({ queryKey: ['research-graph'] })
      await queryClient.invalidateQueries({ queryKey: ['research-reports'] })
      toast.success('已删除所选数据及关联关系图谱与研报')
    } catch (error) {
      toast.error(axios.isAxiosError(error) ? error.response?.data?.detail || error.message : '删除失败')
    }
  }

  // 首次载入或根据当前选中任务智能初始化展开状态（手风琴模式：仅展开当前任务，全部数据时默认折叠）
  useEffect(() => {
    if (tasks.length && !initializedTaskExpansion.current) {
      initializedTaskExpansion.current = true
      if (selectedThreadId) {
        setExpandedTasks(new Set([selectedThreadId]))
      } else if (selectedWorkflowId) {
        const parentTask = tasks.find((t) => t.rounds?.some((r: any) => r.plan_id === selectedWorkflowId))
        if (parentTask) {
          setExpandedTasks(new Set([parentTask.thread_id]))
        }
      } else {
        setExpandedTasks(new Set())
      }
    }
  }, [tasks, selectedThreadId, selectedWorkflowId])

  const toggleTaskExpand = (threadId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setExpandedTasks((prev) => {
      if (prev.has(threadId)) {
        const next = new Set(prev)
        next.delete(threadId)
        return next
      }
      // 手风琴模式：展开此任务，同时收起其他任务
      return new Set([threadId])
    })
  }

  const expandAllTasks = () => {
    setExpandedTasks(new Set(tasks.map((t) => t.thread_id)))
  }

  const collapseAllTasks = () => {
    setExpandedTasks(new Set())
  }

  // 判断是否存在活动筛选
  const hasActiveFilters = platform !== 'all' || kind !== 'main_only' || keyword !== 'all' || subjectType !== 'all' || query.trim() !== ''

  const resetAllFilters = () => {
    setPlatform('all')
    setKind('main_only')
    setKeyword('all')
    setSubjectType('all')
    setQueryInput('')
    setQuery('')
  }

  const renderScopeTree = () => {
    const handleScopeSelect = (nextScope: string) => {
      switchScope(nextScope)
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true)
      }
    }

    return (
      <div className="flex flex-col gap-0.5">
        {/* 全局范围：全部数据（作为列表置顶首项） */}
        <button
          type="button"
          onClick={() => handleScopeSelect('all')}
          title="全部数据"
          className={`group relative flex h-[34px] w-full items-center gap-2 rounded-xl px-2.5 text-left transition-all cursor-pointer ${scope === 'all'
            ? 'bg-cyber-neon-cyan/15 font-semibold text-cyber-neon-cyan border border-cyber-neon-cyan/40 shadow-[0_0_10px_rgba(0,240,255,0.08)] shadow-xs'
            : 'font-normal text-cyber-text-primary/80 hover:bg-cyber-bg-tertiary/70 hover:text-cyber-text-primary border border-transparent'
            }`}
        >
          <div className="flex h-5 w-5 shrink-0 items-center justify-center">
            <Layers className={`h-4 w-4 transition-colors ${scope === 'all' ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted group-hover:text-cyber-text-primary'
              }`} />
          </div>
          <span className="truncate text-sm tracking-tight">
            全部数据
          </span>
        </button>

        {/* 文件夹树状列表：大厂极简一行式纯净导航 */}
        <div className="flex flex-col gap-0.5">
          {tasks.map((task) => {
            const isTaskSelected = scope === `thread:${task.thread_id}`
            const isExpanded = expandedTasks.has(task.thread_id)
            const hasRounds = Boolean(task.rounds && task.rounds.length > 0)
            const taskItemCount = (task.rounds || []).reduce(
              (sum: number, r: any) => sum + (r.runs || []).reduce((rSum: number, run: any) => rSum + (run.item_count || 0), 0),
              0
            )

            return (
              <div key={task.thread_id} className="select-none">
                {/* 1级节点：任务文件夹行（极简紧凑 32px） */}
                <div
                  className={`group flex h-[32px] w-full items-center gap-1.5 rounded-xl px-1.5 text-left transition-all cursor-pointer ${isTaskSelected
                    ? 'bg-cyber-neon-cyan/15 font-semibold text-cyber-neon-cyan border border-cyber-neon-cyan/40 shadow-[0_0_10px_rgba(0,240,255,0.08)] shadow-xs'
                    : 'font-medium text-cyber-text-primary/80 hover:bg-cyber-bg-tertiary/70 hover:text-cyber-text-primary border border-transparent'
                    }`}
                  onClick={() => {
                    if (scope === `thread:${task.thread_id}`) {
                      toggleTaskExpand(task.thread_id)
                    } else {
                      handleScopeSelect(`thread:${task.thread_id}`)
                    }
                  }}
                >
                  {/* 折叠/展开箭头 */}
                  {hasRounds ? (
                    <button
                      type="button"
                      onClick={(e) => toggleTaskExpand(task.thread_id, e)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md hover:bg-cyber-bg-tertiary transition-colors focus:outline-none ${isTaskSelected ? 'text-cyber-neon-cyan hover:text-cyber-neon-cyan' : 'text-cyber-text-muted hover:text-cyber-text-primary'
                        }`}
                      title={isExpanded ? "收起" : "展开"}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" />
                  )}

                  {/* 文件夹图标 */}
                  <div className="flex h-4 w-4 shrink-0 items-center justify-center -ml-0.5">
                    {isExpanded ? (
                      <FolderOpen className={`h-3.5 w-3.5 ${isTaskSelected ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted/75'}`} />
                    ) : (
                      <Folder className={`h-3.5 w-3.5 ${isTaskSelected ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted/70 group-hover:text-cyber-text-secondary'}`} />
                    )}
                  </div>

                  {/* 任务标题 */}
                  <span className={`min-w-0 flex-1 truncate text-[13px] leading-snug transition-colors ${isTaskSelected ? 'text-cyber-neon-cyan font-semibold' : 'text-cyber-text-primary/80 group-hover:text-cyber-text-primary'
                    }`} title={task.task_title || task.thread_id}>
                    {task.task_title || task.thread_id}
                  </span>

                  {/* 右侧数量徽章与快捷删除 */}
                  <div className="relative flex h-6 min-w-[24px] items-center justify-end shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
                    <span
                      className={`rounded px-1.5 py-0.2 font-mono text-[9.5px] transition-all ${isTaskSelected
                        ? 'bg-cyber-neon-cyan/25 text-cyber-neon-cyan font-bold border border-cyber-neon-cyan/30'
                        : 'bg-cyber-bg-secondary text-cyber-text-muted font-medium'
                        } group-hover:opacity-0`}
                      title={`该任务记录采集 ${taskItemCount} 项`}
                    >
                      {taskItemCount}
                    </span>
                    <div className="absolute right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <DeleteConfirmDialog
                        title="删除整个任务及其采集数据？"
                        description="该操作会物理删除任务下所有执行、文档来源和日志。"
                        onConfirm={() => deleteScope('task', task.thread_id)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 text-cyber-text-muted hover:bg-cyber-bg-secondary hover:text-red-400"
                            title="删除任务"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* 2级节点：采集轮次子树（清晰树状错层缩进 28px） */}
                {isExpanded && hasRounds && (
                  <div className="ml-[18px] pl-3 my-0.5 space-y-0.5 border-l border-cyber-border-subtle/60">
                    {(task.rounds || []).map((round: any) => {
                      const isRoundSelected = scope === `plan:${round.plan_id}`
                      const roundItemCount = (round.runs || []).reduce(
                        (rSum: number, run: any) => rSum + (run.item_count || 0),
                        0
                      )

                      return (
                        <div
                          key={round.plan_id}
                          className={`group flex h-[28px] items-center justify-between rounded-lg px-2 text-[12px] transition-all cursor-pointer ${isRoundSelected
                            ? 'bg-cyber-neon-cyan/12 text-cyber-neon-cyan font-medium border border-cyber-neon-cyan/35 shadow-[0_0_8px_rgba(0,240,255,0.06)] shadow-xs'
                            : 'text-cyber-text-muted hover:bg-cyber-bg-tertiary/60 hover:text-cyber-text-primary font-normal border border-transparent'
                            }`}
                          onClick={() => handleScopeSelect(`plan:${round.plan_id}`)}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-1">
                            <FileText className={`h-3 w-3 shrink-0 ${isRoundSelected ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted/65'}`} />
                            <span className={`min-w-0 flex-1 truncate transition-colors ${isRoundSelected ? 'text-cyber-neon-cyan font-medium' : 'text-cyber-text-muted group-hover:text-cyber-text-primary'
                              }`} title={round.round_title || round.plan_id}>
                              {round.round_title || round.plan_id}
                            </span>
                          </div>

                          {/* 轮次采集量徽章与快捷删除 */}
                          <div className="relative flex h-5 min-w-[20px] items-center justify-end shrink-0 ml-auto" onClick={(e) => e.stopPropagation()}>
                            <span
                              className={`rounded px-1 py-0.2 font-mono text-[9px] transition-all ${isRoundSelected
                                ? 'bg-cyber-neon-cyan/25 text-cyber-neon-cyan font-bold border border-cyber-neon-cyan/30'
                                : 'bg-cyber-bg-secondary/70 text-cyber-text-muted/80'
                                } group-hover:opacity-0`}
                              title={`该轮次共采集 ${roundItemCount} 条数据`}
                            >
                              {roundItemCount}
                            </span>
                            <div className="absolute right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                              <DeleteConfirmDialog
                                title="删除该采集轮次？"
                                description="该轮次下的执行和文档来源将被物理删除。"
                                onConfirm={() => deleteScope('round', round.plan_id)}
                                trigger={
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 text-cyber-text-muted hover:bg-cyber-bg-secondary hover:text-red-400"
                                    title="删除轮次"
                                  >
                                    <Trash2 className="h-2.5 w-2.5" />
                                  </Button>
                                }
                              />
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {tasks.length === 0 && (
          <div className="py-6 text-center text-xs text-cyber-text-muted">
            暂无采集任务
          </div>
        )}
      </div>
    )
  }

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
      return (
        <div className="flex max-w-[500px] items-start gap-3">
          {preview ? (
            <img
              src={preview.url}
              alt=""
              referrerPolicy="no-referrer"
              className="h-14 w-11 shrink-0 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary object-cover shadow-xs"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-cyber-text-primary hover:text-cyber-neon-cyan transition-colors" title={document.title || '无标题'}>
              {document.title || '无标题'}
            </p>
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-cyber-text-muted">
              {document.summary || document.markdown || '—'}
            </p>
          </div>
        </div>
      )
    }
    if (key === 'platform') return renderPlatformBadge(document.platform, platformLabels.get(document.platform))
    if (key === 'kind') return (
      <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] text-cyber-text-muted bg-cyber-bg-tertiary/60 border border-cyber-border-subtle/50 whitespace-nowrap font-normal">
        {kindLabels[document.kind] || document.kind}
      </span>
    )
    if (key === 'subject') {
      const subjectName = document.subject?.name || document.subject?.id || '—'
      const subjectType = document.subject?.type || 'unknown'
      return (
        <div className="min-w-0">
          <p className="truncate font-medium text-cyber-text-primary" title={subjectName}>
            {subjectName}
          </p>
          <p className="text-[10px] text-cyber-text-muted shrink-0">
            {subjectTypeLabels[subjectType] || subjectType}
          </p>
        </div>
      )
    }
    if (key === 'keyword') {
      return (
        <span className="inline-block max-w-[170px] truncate rounded-md bg-cyber-bg-secondary/70 border border-cyber-border-subtle/40 px-1.5 py-0.5 font-mono text-[11px] text-cyber-text-secondary" title={document.keyword || ''}>
          {document.keyword || '—'}
        </span>
      )
    }
    if (key === 'publishedAt') return <span className="whitespace-nowrap font-mono text-[11px] text-cyber-text-muted">{formatDate(document.publishedAt)}</span>
    if (key.startsWith('metric:')) {
      const value = document.metrics?.[key.slice(7)]
      return typeof value === 'number' ? (
        <span className="font-mono text-xs font-semibold text-cyber-text-primary">{formatNumber(value)}</span>
      ) : (
        <span className="font-mono text-[11px] text-cyber-text-muted/30">—</span>
      )
    }
    if (key.startsWith('attribute:')) {
      const val = displayValue(document.attributes?.[key.slice(10)])
      return val === '—' ? <span className="font-mono text-[11px] text-cyber-text-muted/30">—</span> : <span className="truncate block" title={val}>{val}</span>
    }
    return <span className="font-mono text-[11px] text-cyber-text-muted/30">—</span>
  }

  const visibleExportFields = selectedColumns.flatMap((column) => {
    if (column.key === 'title') return ['title', 'summary']
    if (column.key === 'subject') return ['subject.name']
    if (column.key.startsWith('metric:')) return [`metrics.${column.key.slice(7)}`]
    if (column.key.startsWith('attribute:')) return [`attributes.${column.key.slice(10)}`]
    return [column.key]
  })
  const isKnowledgeFormat = ['markdown', 'obsidian', 'notion', 'dify', 'feishu', 'yuque', 'ima', 'logseq'].includes(exportFormat)

  const exportUrl = isKnowledgeFormat
    ? dataApi.getKnowledgeExportUrl({
        exporterId: exportFormat,
        ...filters,
        sort_by: sortBy,
        sort_order: sortOrder,
      })
    : dataApi.getAnalyticsExportUrl({
        ...filters,
        sort_by: sortBy,
        sort_order: sortOrder,
        format: exportFormat as any,
        field_mode: exportFieldMode,
        fields: exportFieldMode === 'visible' ? visibleExportFields.join(',') : undefined,
      })

  // 基准数据（当前任务 Scope 下的总盘基准，用于计算筛选占比）
  const baselineTotals = scopeSummary?.totals || { document_count: 0, subject_count: 0, content_count: 0, comment_count: 0 }
  // 当前筛选切片下的实时精准汇总
  const activeTotals = summary?.totals || baselineTotals

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-cyber-bg-primary">
      {/* 移动端侧栏遮罩层 */}
      {!sidebarCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden="true"
        />
      )}

      {/* 贯通式左侧边栏 */}
      <aside
        style={{ width: sidebarWidth }}
        className={`shrink-0 flex-col border-r border-cyber-border-subtle bg-cyber-bg-panel md:bg-cyber-bg-secondary/70 ${sidebarCollapsed
          ? 'hidden'
          : 'fixed inset-y-0 left-0 z-50 flex shadow-2xl md:relative md:z-auto md:shadow-none'
          } ${isResizing ? 'select-none' : 'transition-[width] duration-200'}`}
      >
        {/* 顶部控制行：Mac 交通灯预留与收起按钮 */}
        <div className={`flex h-9 shrink-0 items-center justify-between ${isMacPlatform() ? 'pl-[74px]' : 'pl-3'} pr-2`}>
          <div className="flex-1 h-full app-drag" />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 shrink-0 rounded-lg text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary app-no-drag"
            onClick={() => setSidebarCollapsed(true)}
            title="收起任务范围侧栏"
          >
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>

        {/* 模块标题区（精致轻量化字号与字重） */}
        <div className="pl-6 pr-3 pt-2 pb-2.5">
          <div className="flex items-center gap-2 select-none app-no-drag">
            <span className="text-base font-semibold tracking-tight text-cyber-text-primary/95">
              知识库
            </span>
          </div>
        </div>

        {/* 核心快捷按键：返回任务 */}
        {onBack && (
          <div className="px-2 pb-1.5">
            <Button
              className="w-full justify-start gap-2 h-9 text-sm font-medium rounded-xl text-cyber-text-secondary hover:text-cyber-text-primary hover:bg-cyber-bg-tertiary/60 transition-colors"
              variant="ghost"
              onClick={onBack}
              title="返回任务"
            >
              <ArrowLeft className="h-4 w-4 text-cyber-text-muted" />
              <span>返回任务</span>
            </Button>
          </div>
        )}

        {/* 数据集分界与头部 */}
        <div className="mx-2 my-1.5 border-t border-cyber-border-subtle" />
        <div className="flex items-center justify-between px-2.5 py-1.5">
          <span className="text-[11px] font-medium text-cyber-text-muted">数据集</span>
          {tasks.length > 0 && (
            <button
              type="button"
              onClick={tasks.length > 0 && tasks.every((t) => expandedTasks.has(t.thread_id)) ? collapseAllTasks : expandAllTasks}
              className="text-cyber-text-muted hover:text-cyber-neon-cyan transition-colors text-[10px] font-medium flex items-center gap-0.5 focus:outline-none cursor-pointer"
              title={tasks.length > 0 && tasks.every((t) => expandedTasks.has(t.thread_id)) ? "折叠所有任务文件夹" : "展开所有任务文件夹"}
            >
              {tasks.length > 0 && tasks.every((t) => expandedTasks.has(t.thread_id)) ? (
                <>
                  <ChevronsUp className="h-3 w-3" />
                  <span>全部折叠</span>
                </>
              ) : (
                <>
                  <ChevronsDown className="h-3 w-3" />
                  <span>全部展开</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* 任务范围树 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pt-1 pb-2">
          {renderScopeTree()}
        </div>

        {/* 拖拽调宽手柄 */}
        {!sidebarCollapsed && (
          <div
            onMouseDown={startResizing}
            className={`absolute -right-[3px] top-0 bottom-0 z-20 w-1.5 touch-none cursor-col-resize transition-colors hover:bg-cyber-neon-cyan/25 ${isResizing ? 'bg-cyber-neon-cyan/35' : ''}`}
            title="拖动调整侧栏宽度"
          />
        )}
      </aside>

      {/* 右侧主工作区 */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* 右侧主顶栏 */}
        <div className={`flex h-12 shrink-0 items-center justify-between border-b border-cyber-border-subtle bg-cyber-bg-primary/90 pr-2.5 sm:pr-4 backdrop-blur ${sidebarCollapsed ? 'app-drag' : 'md:app-drag'} ${isMacPlatform()
          ? (sidebarCollapsed ? 'pl-[74px]' : 'pl-[74px] md:pl-4')
          : (sidebarCollapsed ? 'pl-2.5 sm:pl-3.5' : 'pl-2.5 md:pl-4')
          }`}>
          <div className="flex items-center gap-2 min-w-0 app-no-drag">
            {/* 侧栏收起状态下的展开按钮与快捷返回 */}
            <div className={`items-center gap-1.5 ${sidebarCollapsed ? 'flex' : 'flex md:hidden'}`}>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0 rounded-xl text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary"
                onClick={() => setSidebarCollapsed(false)}
                title="展开任务范围侧栏"
              >
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
              {onBack && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 gap-1.5 rounded-xl px-2 md:px-2.5 text-xs text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary"
                  onClick={onBack}
                  title="返回任务"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span className="hidden md:inline">返回任务</span>
                </Button>
              )}
              <div className="mx-1 h-3.5 w-[1px] bg-cyber-border-subtle" />
            </div>

            {/* 当前分析范围标题 */}
            <div className="flex items-center min-w-0">
              <h1 className="truncate text-sm font-medium text-cyber-text-primary">
                {currentScopeName}
              </h1>
            </div>
          </div>

          {/* 右侧核心区：视图切换 Tabs */}
          <div className="flex items-center app-no-drag">
            {/* 一级视图切换 Segmented Control (Apple / Linear 高级物理卡片质感) */}
            <div className="flex items-center gap-1 rounded-xl bg-slate-200/50 dark:bg-slate-800/60 p-1 border border-slate-300/40 dark:border-slate-700/50 shadow-inner">
              <button
                type="button"
                onClick={() => setActiveMainTab('pivot')}
                className={`flex items-center justify-center gap-2 rounded-lg h-8 w-8 md:h-auto md:w-auto p-1.5 md:px-3.5 md:py-1.5 text-xs md:text-[13px] font-medium transition-all duration-150 cursor-pointer ${activeMainTab === 'pivot'
                  ? 'bg-white dark:bg-cyber-bg-elevated text-cyber-text-primary shadow-xs dark:shadow-md border border-black/[0.08] dark:border-white/[0.1] font-semibold'
                  : 'text-cyber-text-secondary hover:text-cyber-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] border border-transparent'
                  }`}
                title="数据透视表 - 查看与筛选清洗原始文档、正文与评论数据"
              >
                <FileSpreadsheet className={`h-4 w-4 shrink-0 transition-colors ${activeMainTab === 'pivot' ? 'text-cyber-text-primary' : 'text-cyber-text-muted'}`} />
                <span className="hidden md:inline">数据透视表</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveMainTab('graph')}
                className={`flex items-center justify-center gap-2 rounded-lg h-8 w-8 md:h-auto md:w-auto p-1.5 md:px-3.5 md:py-1.5 text-xs md:text-[13px] font-medium transition-all duration-150 cursor-pointer ${activeMainTab === 'graph'
                  ? 'bg-white dark:bg-cyber-bg-elevated text-cyber-text-primary shadow-xs dark:shadow-md border border-black/[0.08] dark:border-white/[0.1] font-semibold'
                  : 'text-cyber-text-secondary hover:text-cyber-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] border border-transparent'
                  }`}
                title="关联图谱 - 探索实体关联、回溯证据并管理同义实体"
              >
                <Network className={`h-4 w-4 shrink-0 transition-colors ${activeMainTab === 'graph' ? 'text-cyber-text-primary' : 'text-cyber-text-muted'}`} />
                <span className="hidden md:inline">关联图谱</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveMainTab('reports')}
                className={`flex items-center justify-center gap-2 rounded-lg h-8 w-8 md:h-auto md:w-auto p-1.5 md:px-3.5 md:py-1.5 text-xs md:text-[13px] font-medium transition-all duration-150 cursor-pointer ${activeMainTab === 'reports'
                  ? 'bg-white dark:bg-cyber-bg-elevated text-cyber-text-primary shadow-xs dark:shadow-md border border-black/[0.08] dark:border-white/[0.1] font-semibold'
                  : 'text-cyber-text-secondary hover:text-cyber-text-primary hover:bg-black/[0.04] dark:hover:bg-white/[0.05] border border-transparent'
                  }`}
                title="研究报告 - 查看研究报告、对比版本、检查数据质量并导出"
              >
                <FileText className={`h-4 w-4 shrink-0 transition-colors ${activeMainTab === 'reports' ? 'text-cyber-text-primary' : 'text-cyber-text-muted'}`} />
                <span className="hidden md:inline">研究报告</span>
              </button>
            </div>
          </div>
        </div>

        {/* 主工作区根据 Tab 分支渲染 */}
        {activeMainTab === 'pivot' ? (
          /* 主数据看板与透视表格 */
          <main className="min-w-0 flex-1 overflow-auto p-3 sm:p-4 bg-cyber-bg-primary/40">
            <div className="mx-auto max-w-[1800px] space-y-3">

              {/* 顶部独立 4 个概览数据看板条带 (Independent Top Metrics Ribbon) */}
              <section className="glass-panel rounded-xl border border-cyber-border-subtle shadow-xs p-1.5 sm:px-2.5 sm:py-1.5 bg-cyber-bg-panel/75">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-1 sm:gap-1.5 divide-y sm:divide-y-0 lg:divide-x divide-cyber-border-subtle/50">
                  <StatRibbonItem
                    label="文档总数"
                    value={activeTotals.document_count || 0}
                    total={baselineTotals.document_count}
                    hint={hasActiveFilters ? `当前筛选命中 (总盘 ${baselineTotals.document_count} 篇)` : "包含正文与评论"}
                    icon={FileSearch}
                    isFiltered={hasActiveFilters}
                  />
                  <div className="lg:pl-1.5">
                    <StatRibbonItem
                      label="去重主体"
                      value={activeTotals.subject_count || 0}
                      total={baselineTotals.subject_count}
                      hint={hasActiveFilters ? `当前涉及主体 (总盘 ${baselineTotals.subject_count} 位)` : "按主体 ID / 名称去重"}
                      icon={Users}
                      isFiltered={hasActiveFilters}
                    />
                  </div>
                  <div className="lg:pl-1.5">
                    <StatRibbonItem
                      label="正文/主帖"
                      value={activeTotals.content_count || 0}
                      total={baselineTotals.content_count}
                      hint={hasActiveFilters ? `当前独立正文 (总盘 ${baselineTotals.content_count} 篇)` : "独立采集分析单元"}
                      icon={FileText}
                      isFiltered={hasActiveFilters}
                    />
                  </div>
                  <div className="lg:pl-1.5">
                    <StatRibbonItem
                      label="衍生评论"
                      value={activeTotals.comment_count || 0}
                      total={baselineTotals.comment_count}
                      hint={hasActiveFilters ? `当前切片评论 (总盘 ${baselineTotals.comment_count} 条)` : "保留父级关联评论"}
                      icon={MessageSquare}
                      isFiltered={hasActiveFilters}
                    />
                  </div>
                </div>
              </section>

              {/* 下方独立数据透视工作台 (全能工具栏 + 吸顶表格 + 分页栏) */}
              <div className="glass-panel rounded-2xl border border-cyber-border-subtle shadow-xs overflow-hidden bg-cyber-bg-panel/75">

                {/* 精细多维过滤全能工具栏 (Sticky All-in-One Filter Toolbar) */}
                <div className="sticky top-0 z-20 border-b border-cyber-border-subtle bg-cyber-bg-panel/95 backdrop-blur-md px-3.5 py-2.5 sm:px-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {/* 左侧紧凑筛选集群 */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
                      {/* 1. 关键词筛选 (已合并至工具栏) */}
                      {keywordStats.length > 0 && (
                        <Select value={keyword} onValueChange={setKeyword}>
                          <SelectTrigger className="h-8 w-auto min-w-[105px] max-w-[150px] shrink-0 text-xs bg-cyber-bg-secondary/70 border-cyber-border-subtle rounded-lg">
                            <SelectValue>
                              {keyword === 'all' ? (
                                <span className="flex items-center gap-1.5 truncate text-cyber-text-secondary">
                                  <Tag className="h-3.5 w-3.5 text-cyber-text-muted shrink-0" />
                                  <span>全部关键词</span>
                                  <span className="font-mono text-[10px] text-cyber-text-muted/80">({keywordStats.length})</span>
                                </span>
                              ) : (
                                <span className="flex items-center gap-1.5 truncate text-cyber-text-primary font-medium">
                                  <Tag className="h-3.5 w-3.5 text-cyber-text-muted shrink-0" />
                                  <span className="truncate">#{keyword}</span>
                                </span>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="max-h-[320px]">
                            <SelectItem value="all">
                              <div className="flex items-center justify-between gap-2 w-full">
                                <span>全部关键词</span>
                                <span className="font-mono text-[10px] text-cyber-text-muted">({baselineTotals.document_count || 0} 篇)</span>
                              </div>
                            </SelectItem>
                            {keywordStats.map((item) => (
                              <SelectItem key={item.name} value={item.name}>
                                <div className="flex items-center justify-between gap-3 w-full">
                                  <span className="truncate max-w-[200px]">{item.displayLabel}</span>
                                  {item.count !== undefined && (
                                    <span className="font-mono text-[10px] text-cyber-text-muted shrink-0">({item.count})</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {/* 2. 平台筛选 */}
                      <Select value={platform} onValueChange={setPlatform}>
                        <SelectTrigger className="h-8 w-24 sm:w-28 shrink-0 text-xs bg-cyber-bg-secondary/70 border-cyber-border-subtle rounded-lg">
                          <SelectValue placeholder="全部平台" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部平台</SelectItem>
                          {(scopeSummary?.filters?.platforms || summary?.filters?.platforms || []).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* 3. 主体类型筛选 */}
                      <Select value={subjectType} onValueChange={setSubjectType}>
                        <SelectTrigger className="h-8 w-24 sm:w-28 shrink-0 text-xs bg-cyber-bg-secondary/70 border-cyber-border-subtle rounded-lg">
                          <SelectValue placeholder="全部主体" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部主体</SelectItem>
                          {(scopeSummary?.filters?.subject_types || summary?.filters?.subject_types || []).map((value) => (
                            <SelectItem key={value} value={value}>{subjectTypeLabels[value] || value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* 4. 内容形态/正文筛选 */}
                      <Select value={kind} onValueChange={setKind}>
                        <SelectTrigger className="h-8 w-28 shrink-0 text-xs bg-cyber-bg-secondary/70 border-cyber-border-subtle rounded-lg">
                          <SelectValue>
                            {kind === 'main_only' ? '正文/主帖' : (kind === 'all' ? '全部内容' : (kindLabels[kind] || kind))}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="main_only">正文/主帖(排除评论)</SelectItem>
                          <SelectItem value="all">全部内容(含评论)</SelectItem>
                          {(scopeSummary?.filters?.kinds || summary?.filters?.kinds || []).map((value) => (
                            <SelectItem key={value} value={value}>{kindLabels[value] || value}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* 5. 紧凑搜索框 */}
                      <form className="relative w-44 sm:w-52 shrink-0" onSubmit={(event) => { event.preventDefault(); setQuery(queryInput.trim()) }}>
                        <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-cyber-text-muted" />
                        <Input
                          value={queryInput}
                          onChange={(event) => setQueryInput(event.target.value)}
                          placeholder="搜索标题、摘要..."
                          className="h-8 w-full pl-8 pr-7 text-xs bg-cyber-bg-secondary/70 border-cyber-border-subtle rounded-lg"
                        />
                        {queryInput && (
                          <button
                            type="button"
                            onClick={() => { setQueryInput(''); setQuery('') }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-cyber-text-muted hover:text-cyber-text-primary"
                            title="清空搜索"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </form>
                    </div>

                    {/* 右侧动作区：重置 + 分隔线 + 列设置 + 导出数据 */}
                    <div className="flex items-center gap-2 shrink-0 ml-auto pl-2">
                      {hasActiveFilters && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={resetAllFilters}
                          className="h-8 shrink-0 px-2.5 text-xs text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10 gap-1 rounded-lg"
                          title="重置所有筛选条件"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>重置</span>
                        </Button>
                      )}

                      <div className="h-3.5 w-px bg-cyber-border-subtle/70 hidden sm:block" />

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setColumnDialogOpen(true)}
                        className="h-8 w-8 p-0 shrink-0 text-cyber-text-muted hover:text-cyber-text-primary hover:bg-cyber-bg-tertiary/80 border border-cyber-border-subtle/50 rounded-lg flex items-center justify-center transition-colors"
                        title="列设置"
                      >
                        <Columns3 className="h-4 w-4" />
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setExportDialogOpen(true)}
                        className="h-8 shrink-0 px-2.5 sm:px-3 text-xs gap-1.5 border-cyber-border-subtle text-cyber-text-secondary hover:text-cyber-text-primary hover:border-cyber-neon-cyan/50 hover:bg-cyber-neon-cyan/10 rounded-lg cursor-pointer transition-all"
                        title="导出当前筛选数据 (Excel / CSV / JSON)"
                      >
                        <Download className="h-3.5 w-3.5 shrink-0 text-cyber-neon-cyan" />
                        <span className="hidden sm:inline font-medium">导出数据</span>
                      </Button>
                    </div>
                  </div>
                </div>

                {/* 第 3 层：表格数据区 (Scrollable Table Container) */}
                <div className="overflow-auto max-h-[calc(100vh-175px)] min-h-[460px]">
                  <table className="w-full min-w-[1040px] border-collapse text-xs">
                    <thead className="sticky top-0 z-10 bg-cyber-bg-secondary/95 backdrop-blur-md text-cyber-text-muted border-b border-cyber-border-subtle">
                      <tr>
                        {selectedColumns.map((column) => {
                          const activeSortOrder = getColumnSortState(column.key)
                          const colWidth = getColumnWidthClass(column.key)
                          return (
                            <th
                              key={column.key}
                              onClick={() => handleColumnHeaderClick(column.key)}
                              className={`sticky top-0 z-10 bg-cyber-bg-secondary/95 backdrop-blur-md border-b border-cyber-border-subtle group/th cursor-pointer select-none whitespace-nowrap px-3.5 py-2.5 text-left font-medium hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary transition-colors ${colWidth}`}
                            >
                              <div className="inline-flex items-center gap-1.5">
                                <span className={activeSortOrder ? 'text-cyber-neon-cyan font-semibold' : ''}>
                                  {column.label}
                                </span>
                                {activeSortOrder === 'desc' ? (
                                  <ArrowDown className="h-3.5 w-3.5 text-cyber-neon-cyan shrink-0" />
                                ) : activeSortOrder === 'asc' ? (
                                  <ArrowUp className="h-3.5 w-3.5 text-cyber-neon-cyan shrink-0" />
                                ) : (
                                  <ArrowUpDown className="h-3.5 w-3.5 text-cyber-text-muted/40 opacity-0 group-hover/th:opacity-100 transition-opacity shrink-0" />
                                )}
                              </div>
                            </th>
                          )
                        })}
                        <th className="sticky top-0 z-10 bg-cyber-bg-secondary/95 backdrop-blur-md border-b border-cyber-border-subtle min-w-[65px] w-[65px] whitespace-nowrap px-3.5 py-2.5 text-center font-medium">来源</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cyber-border-subtle/50">
                      {documents?.items.map((document) => {
                        const isSelected = selectedDocument?.documentId === document.documentId
                        return (
                          <tr
                            key={`${document.documentId}:${document.provenance?.runId || 'latest'}`}
                            onClick={() => setSelectedDocument(document)}
                            className={`cursor-pointer transition-colors ${isSelected
                              ? 'bg-cyber-neon-cyan/15 hover:bg-cyber-neon-cyan/20'
                              : 'hover:bg-cyber-neon-cyan/5'
                              }`}
                          >
                            {selectedColumns.map((column) => (
                              <td key={column.key} className={`px-3.5 py-2.5 align-top text-cyber-text-secondary ${getColumnWidthClass(column.key)}`}>
                                {cell(document, column.key)}
                              </td>
                            ))}
                            <td className="min-w-[65px] w-[65px] px-3.5 py-2.5 text-center align-top whitespace-nowrap">
                              {document.sourceUrl ? (
                                <a
                                  href={document.sourceUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="inline-flex items-center justify-center rounded p-1 text-cyber-neon-cyan hover:bg-cyber-neon-cyan/10 transition-colors"
                                  title="打开原帖链接"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              ) : (
                                <span className="text-cyber-text-muted/40">—</span>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {!documentsQuery.isLoading && !documents?.items.length ? (
                    <div className="py-16 text-center text-xs text-cyber-text-muted">
                      没有符合当前条件的数据
                    </div>
                  ) : null}
                </div>

                {/* 第 5 层：底部常驻分页栏 (Pinned Pagination Footer) */}
                <div className="border-t border-cyber-border-subtle bg-cyber-bg-panel/70 px-3.5 py-2 sm:px-4 flex flex-wrap items-center justify-between gap-3 text-xs text-cyber-text-muted">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>
                      共 <span className="font-mono font-medium text-cyber-text-primary">{documents?.total || 0}</span> 条
                      {documents && documents.total > 0 && (
                        <span className="text-cyber-text-muted/80 ml-1.5 font-mono">
                          (第 {(page - 1) * pageSize + 1} - {Math.min(page * pageSize, documents.total)} 条)
                        </span>
                      )}
                      <span className="mx-2 text-cyber-border-subtle">·</span>
                      第 <span className="font-mono font-medium text-cyber-text-primary">{documents?.page || 1}</span> / <span className="font-mono">{Math.max(documents?.pages || 1, 1)}</span> 页
                    </span>

                    {/* 每页条数选择器 */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-cyber-text-muted text-[11px] shrink-0">每页</span>
                      <Select
                        value={String(pageSize)}
                        onValueChange={(val) => {
                          const next = Number(val)
                          setPageSize(next)
                          setPage(1)
                          try {
                            localStorage.setItem('unisearch-pivot-page-size', String(next))
                          } catch {
                            // ignore
                          }
                        }}
                      >
                        <SelectTrigger className="h-7 w-[102px] px-2.5 text-[11px] bg-cyber-bg-secondary/70 border-cyber-border-subtle font-mono rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="20" className="text-xs">20 条/页</SelectItem>
                          <SelectItem value="50" className="text-xs">50 条/页</SelectItem>
                          <SelectItem value="100" className="text-xs">100 条/页</SelectItem>
                          <SelectItem value="200" className="text-xs">200 条/页</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5 bg-cyber-bg-secondary/50 border-cyber-border-subtle rounded-lg"
                      disabled={page <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5 mr-0.5" />上一页
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs px-2.5 bg-cyber-bg-secondary/50 border-cyber-border-subtle rounded-lg"
                      disabled={!documents || page >= documents.pages}
                      onClick={() => setPage((value) => value + 1)}
                    >
                      下一页<ChevronRight className="h-3.5 w-3.5 ml-0.5" />
                    </Button>
                  </div>
                </div>

              </div>
            </div>
          </main>
        ) : activeMainTab === 'graph' ? (
          <main className="min-w-0 flex-1 overflow-hidden bg-cyber-bg-primary/40">
            <KnowledgeGraphView
              scope={{ thread_id: selectedThreadId, workflow_id: selectedWorkflowId, run_id: selectedRunId }}
              onFilter={(node) => {
                if (node.type === 'platform') setPlatform(node.label)
                else if (node.type === 'keyword') setKeyword(node.label)
                else {
                  setQueryInput(node.label)
                  setQuery(node.label)
                }
                setPage(1)
                setActiveMainTab('pivot')
                toast.success(`已应用实体「${node.label}」过滤条件并切换至数据透视表`)
              }}
              onOpenDocument={async (documentId) => {
                const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`)
                if (response.ok) setSelectedDocument(await response.json())
              }}
            />
          </main>
        ) : (
          <main className="min-w-0 flex-1 overflow-auto bg-cyber-bg-primary/40">
            <ResearchReportsView
              scope={{ thread_id: selectedThreadId, workflow_id: selectedWorkflowId, run_id: selectedRunId }}
            />
          </main>
        )}
      </section>

      <Dialog open={columnDialogOpen} onOpenChange={setColumnDialogOpen}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>动态列设置</DialogTitle>
            <DialogDescription>固定字段与当前结果中实际出现的指标、属性。缺失值保持为空。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {['通用字段', '指标', '扩展属性'].map((group) => {
              const columns = [...BASE_COLUMNS.map(([key, label]) => ({ key, label, group: '通用字段' })), ...dynamicColumns].filter((column) => column.group === group)
              return columns.length ? (
                <section key={group}>
                  <h3 className="mb-2 text-xs font-semibold text-cyber-text-muted">{group}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {columns.map((column) => (
                      <label key={column.key} className="flex cursor-pointer items-center gap-2 rounded border border-cyber-border-subtle p-2 text-xs hover:bg-cyber-bg-secondary/40 transition-colors">
                        <Checkbox checked={visibleColumns.has(column.key)} onCheckedChange={(checked) => toggleColumn(column.key, Boolean(checked))} />
                        <span>{column.label}</span>
                      </label>
                    ))}
                  </div>
                </section>
              ) : null
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-[500px] h-[550px] flex flex-col justify-between border-cyber-border-subtle bg-cyber-bg-panel/95 backdrop-blur-md p-5 overflow-hidden">
          <DialogHeader className="pb-1 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-cyber-text-primary">
              <Download className="h-4 w-4 text-cyber-neon-cyan" />
              数据与知识库导出
            </DialogTitle>
          </DialogHeader>

          {/* 分类 Tabs */}
          <div className="flex rounded-xl bg-cyber-bg-secondary/60 p-1 border border-cyber-border-subtle/50 my-1 shrink-0">
            <button
              type="button"
              onClick={() => {
                setExportCategory('data')
                if (['obsidian', 'notion', 'dify', 'feishu', 'yuque', 'ima', 'logseq'].includes(exportFormat)) {
                  setExportFormat('xlsx')
                }
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                exportCategory === 'data'
                  ? 'bg-cyber-bg-panel text-cyber-neon-cyan shadow-xs border border-cyber-border-subtle/70'
                  : 'text-cyber-text-muted hover:text-cyber-text-secondary'
              }`}
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              表格与通用数据 ({DATA_FORMAT_OPTIONS.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setExportCategory('knowledge')
                if (['xlsx', 'csv', 'json'].includes(exportFormat)) {
                  setExportFormat('obsidian')
                }
              }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                exportCategory === 'knowledge'
                  ? 'bg-cyber-bg-panel text-cyber-neon-cyan shadow-xs border border-cyber-border-subtle/70'
                  : 'text-cyber-text-muted hover:text-cyber-text-secondary'
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              知识库与智能体 ({KNOWLEDGE_FORMAT_OPTIONS.length})
            </button>
          </div>

          {/* 格式选项列表 (固定高度，自适应滚动) */}
          <div className="grid gap-2 flex-1 min-h-0 overflow-y-auto pr-1 my-1">
            {(exportCategory === 'data' ? DATA_FORMAT_OPTIONS : KNOWLEDGE_FORMAT_OPTIONS).map((item) => {
              const isSelected = exportFormat === item.id
              const Icon = item.icon
              return (
                <div
                  key={item.id}
                  onClick={() => setExportFormat(item.id)}
                  className={`group flex cursor-pointer items-center justify-between rounded-xl border px-3.5 py-2.5 transition-all ${
                    isSelected
                      ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/[0.08] shadow-xs'
                      : 'border-cyber-border-subtle bg-cyber-bg-secondary/40 hover:border-cyber-border-subtle/80 hover:bg-cyber-bg-secondary/70'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg flex items-center justify-center shrink-0 p-1.5 transition-colors bg-white/90 border border-slate-200/60 shadow-2xs">
                      {item.logoUrl ? (
                        <img src={item.logoUrl} alt={item.title} className="h-5 w-5 object-contain" />
                      ) : Icon ? (
                        <Icon className="h-4 w-4" style={item.color ? { color: item.color } : undefined} />
                      ) : null}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-cyber-text-primary">{item.title}</span>
                        <span className="font-mono text-[10px] text-cyber-text-muted">{item.ext}</span>
                        {item.badge && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyber-neon-cyan/15 text-cyber-neon-cyan font-medium">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-cyber-text-muted truncate">{item.hint}</p>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyber-neon-cyan text-white shadow-xs">
                      <Check className="h-3 w-3 stroke-[2.5]" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* 底部配置与状态区 (高度完全固定，无论切换任何格式均不跳动) */}
          <div className="shrink-0 space-y-2 border-t border-cyber-border-subtle/50 pt-2.5 mt-1">
            {/* 配置/规范行 */}
            <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-cyber-bg-secondary/40 border border-cyber-border-subtle/30 text-xs min-h-[34px]">
              {exportFormat === 'xlsx' || exportFormat === 'csv' ? (
                <>
                  <span className="text-[11px] text-cyber-text-secondary flex items-center gap-1.5">
                    <Settings2 className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                    字段范围
                  </span>
                  <div className="flex items-center gap-1">
                    {([
                      ['recommended', '推荐字段'],
                      ['visible', '当前列'],
                      ['all', '全部字段'],
                    ] as const).map(([val, lbl]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setExportFieldMode(val)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                          exportFieldMode === val
                            ? 'bg-cyber-neon-cyan/15 text-cyber-neon-cyan border border-cyber-neon-cyan/40 font-semibold'
                            : 'text-cyber-text-muted hover:text-cyber-text-primary'
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </>
              ) : exportFormat === 'dify' ? (
                <>
                  <span className="text-[11px] text-cyber-text-secondary flex items-center gap-1.5">
                    <Bot className="h-3.5 w-3.5 text-blue-400" />
                    RAG 切片规范
                  </span>
                  <span className="text-[11px] text-cyber-text-muted">按语义/段落自动拆分 Chunks</span>
                </>
              ) : exportFormat === 'obsidian' || exportFormat === 'notion' || exportFormat === 'feishu' || exportFormat === 'yuque' || exportFormat === 'ima' || exportFormat === 'logseq' ? (
                <>
                  <span className="text-[11px] text-cyber-text-secondary flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5 text-purple-400" />
                    知识库规范
                  </span>
                  <span className="text-[11px] text-cyber-text-muted">独立 Markdown 笔记 + 索引大纲</span>
                </>
              ) : (
                <>
                  <span className="text-[11px] text-cyber-text-secondary flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-amber-400" />
                    原始全集规范
                  </span>
                  <span className="text-[11px] text-cyber-text-muted">包含完整字段与 Frontmatter 元数据</span>
                </>
              )}
            </div>

            {/* 条数与提示行 */}
            <div className="flex items-center justify-between px-1 text-[11px] text-cyber-text-muted">
              <span>基于当前透视表筛选切片导出</span>
              <span className="font-mono font-medium text-cyber-neon-cyan bg-cyber-neon-cyan/10 px-1.5 py-0.5 rounded">
                {summary?.totals?.document_count || 0} 条
              </span>
            </div>

            {/* 操作按钮行 */}
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-cyber-border-subtle/30">
              <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(false)} className="h-8 text-xs">
                取消
              </Button>
              <Button size="sm" className="h-8 gap-1.5 text-xs bg-cyber-neon-cyan text-white font-medium hover:bg-cyber-neon-cyan/90 active:scale-[0.98] shadow-xs" asChild>
                <a
                  href={exportUrl}
                  download
                  onClick={() => {
                    setExportDialogOpen(false)
                    const targetOption = [...DATA_FORMAT_OPTIONS, ...KNOWLEDGE_FORMAT_OPTIONS].find((o) => o.id === exportFormat)
                    toast.success(`开始导出下载 (${targetOption?.title || exportFormat.toUpperCase()})`)
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  下载 {([...DATA_FORMAT_OPTIONS, ...KNOWLEDGE_FORMAT_OPTIONS].find((o) => o.id === exportFormat)?.title) || exportFormat.toUpperCase()}
                </a>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <DocumentDrawer document={selectedDocument} platformLabel={selectedDocument ? platformLabels.get(selectedDocument.platform) || selectedDocument.platform : ''} onOpenChange={(open) => { if (!open) setSelectedDocument(null) }} />
    </div>
  )
}
