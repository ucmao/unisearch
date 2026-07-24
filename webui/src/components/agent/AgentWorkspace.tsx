import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, Bot, Check, CheckCircle2, ChevronRight, Clock3, Copy, Database, Download, Eye, EyeOff, FileText,
  Loader2, MessageSquarePlus, MoreHorizontal, Paperclip, Pin, PinOff, Play, Plus, Search, Send,
  Sparkles, SquarePen, Table2, Trash2, User, X, XCircle, PanelBottom, PanelLeftClose, PanelLeftOpen, PanelRight,
} from 'lucide-react'
import { agentApi, browserApi, type AgentAttachment, type AgentMessage, type AgentPlan, type AgentTaskReference, type AgentThread, type AgentThreadSummary } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MarkdownContent } from './MarkdownContent'
import { Terminal } from '@/components/console/Terminal'
import { SettingsDialog, type SettingsSection } from '@/components/layout/SettingsDialog'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'
import { useLogWebSocket } from '@/hooks/useWebSocket'
import { useCrawlerStore } from '@/store/crawlerStore'
import { CommandPopover } from './CommandPopover'
import { useMentionCommands } from '@/hooks/useMentionCommands'

const PLATFORM_LABELS: Record<string, string> = {
  xhs: '小红书', dy: '抖音', douyin: '抖音', ks: '快手', kuaishou: '快手', bili: '哔哩哔哩', wb: '微博', weibo: '微博', tieba: '百度贴吧', zhihu: '知乎',
  baidu: '百度', bing: '必应', so360: '360搜索', sogou: '搜狗', media_parser: '综合解析', zhaopin: '智联招聘', heimao: '黑猫投诉',
  deepseek: 'DeepSeek', doubao: '豆包', kimi: 'Kimi', nami: '纳米AI',
  qwen: '通义千问', wenxin: '文心一言', yuanbao: '腾讯元宝',
}

const AI_PLATFORMS = new Set([
  'deepseek', 'doubao', 'kimi', 'nami', 'qwen', 'wenxin', 'yuanbao',
])

const STATUS_LABELS: Record<string, string> = {
  awaiting_confirmation: '等待确认', queued: '排队中', running: '采集中', completed: '已完成',
  partially_completed: '部分完成', failed: '失败', stopped: '已停止',
}

function storedPanelSize(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function getError(error: any) {
  return error?.response?.data?.detail || error?.message || '操作失败'
}

function timeAgo(value: string) {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  if (!copied) throw new Error('复制失败')
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-cyber-neon-cyan" />
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-cyber-neon-green" />
  if (status === 'failed' || status === 'stopped') return <XCircle className="h-4 w-4 text-cyber-neon-pink" />
  return <Clock3 className="h-4 w-4 text-cyber-text-muted" />
}

function CsvDownloadLink({ planId, compact = false }: { planId: string; compact?: boolean }) {
  return (
    <a
      href={agentApi.getPlanExportUrl(planId)}
      download
      className={`inline-flex items-center justify-center rounded-md border border-cyber-border-default text-xs font-medium transition-colors hover:border-cyber-neon-cyan/60 hover:bg-cyber-neon-cyan/10 hover:text-cyber-neon-cyan ${compact ? 'h-9 min-w-0 gap-1.5 px-2' : 'mt-3 h-10 min-w-0 gap-2 px-4'}`}
    >
      <Download className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 text-cyber-neon-cyan`} />
      <span className="truncate">下载 CSV</span>
    </a>
  )
}

const DEPTH_LABELS: Record<string, string> = {
  quick: '⚡ 快速',
  standard: '⚖️ 标准',
  deep: '🔬 深度',
  custom: '⚙️ 自定义',
}

// Conversation stays text-first. The legacy inline card is kept behind a
// feature flag for comparison, while the right task panel is the source of truth.
const SHOW_INLINE_PLAN_CARDS = false

function PlanCard({ plan, onExecute, executing, onUpdateKeywords, onUpdateDepth, updatingPlan }: {
  plan: AgentPlan
  onExecute: () => void
  executing: boolean
  onUpdateKeywords: (keywords: string[]) => void
  onUpdateDepth: (depth: 'quick' | 'standard' | 'deep') => void
  updatingPlan: boolean
}) {
  const [editingKeywords, setEditingKeywords] = useState(false)
  const [keywordsDraft, setKeywordsDraft] = useState(plan.plan.keywords)
  const [keywordInput, setKeywordInput] = useState('')
  const isPending = plan.status === 'awaiting_confirmation'
  const isActive = ['queued', 'running'].includes(plan.status)
  const isFinished = ['completed', 'partially_completed'].includes(plan.status)
  const totalItems = plan.stats?.content_count ?? plan.steps.reduce((total, step) => total + (step.item_count || 0), 0)
  const completedPlatforms = plan.steps.filter((step) => step.status === 'completed').length
  const depth = plan.plan.collectionDepth || (plan.plan.collectComments ? 'standard' : 'quick')
  const isOnlyAiQA = plan.plan.platforms.length > 0 && plan.plan.platforms.every((p) => ['deepseek', 'kimi', 'doubao', 'qwen', 'yuanbao', 'nami', 'wenxin'].includes(p))

  useEffect(() => {
    if (!editingKeywords) setKeywordsDraft(plan.plan.keywords)
  }, [plan.plan.keywords, editingKeywords])

  const addKeyword = () => {
    const value = keywordInput.trim()
    if (!value || keywordsDraft.includes(value) || keywordsDraft.length >= 12) return
    setKeywordsDraft((current) => [...current, value])
    setKeywordInput('')
  }

  if (!isPending) {
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/45 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {isActive ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-cyber-neon-cyan" /> : isFinished ? <CheckCircle2 className="h-4 w-4 shrink-0 text-cyber-neon-green" /> : <XCircle className="h-4 w-4 shrink-0 text-cyber-neon-pink" />}
          <div className="min-w-0">
            <p className="text-xs font-medium text-cyber-text-primary">
              {isActive ? '采集任务正在执行' : isFinished ? `已采集 ${totalItems} 条内容` : STATUS_LABELS[plan.status] || plan.status}
            </p>
            <p className="mt-0.5 text-[10px] text-cyber-text-muted">
              {isActive ? '各平台实时进度和异常信息请查看右侧任务大盘' : `${completedPlatforms}/${plan.steps.length} 个平台完成，详细分布和结果操作在右侧`}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-cyber-neon-cyan/25 bg-cyber-bg-secondary/55">
      <div className="flex items-center justify-between gap-3 border-b border-cyber-border-subtle px-4 py-3">
        <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-cyber-neon-cyan" /><span className="text-sm font-medium">确认采集范围</span></div>
        <Badge variant="outline" className="text-[10px]">等待确认</Badge>
      </div>
      <div className="space-y-3 px-4 py-3 text-xs">
        <div className="grid gap-2 sm:grid-cols-[72px_1fr]">
          <span className="text-cyber-text-muted">采集平台</span>
          <div className="flex flex-wrap gap-1.5">{plan.plan.platforms.map((platform) => <Badge key={platform} variant="outline">{PLATFORM_LABELS[platform] || platform}</Badge>)}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[72px_1fr]">
          <div className="flex items-center justify-between gap-2"><span className="text-cyber-text-muted">关键词</span>{!editingKeywords ? <button type="button" onClick={() => setEditingKeywords(true)} className="text-[10px] text-cyber-neon-cyan">编辑</button> : null}</div>
          <div>
            <div className="flex flex-wrap gap-1.5">
              {(editingKeywords ? keywordsDraft : plan.plan.keywords).map((item) => <Badge key={item} variant="outline" className="gap-1">{item}{editingKeywords ? <button type="button" onClick={() => setKeywordsDraft((current) => current.filter((keyword) => keyword !== item))} aria-label={`删除关键词 ${item}`}><X className="h-3 w-3" /></button> : null}</Badge>)}
            </div>
            {editingKeywords ? <div className="mt-2 space-y-2">
              <div className="flex gap-2"><Input value={keywordInput} maxLength={40} className="h-8 text-xs" placeholder="添加关键词" onChange={(event) => setKeywordInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addKeyword() } }} /><Button size="sm" variant="outline" className="h-8" onClick={addKeyword} disabled={!keywordInput.trim() || keywordsDraft.length >= 12}><Plus /></Button></div>
              <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" className="h-7" onClick={() => { setKeywordsDraft(plan.plan.keywords); setEditingKeywords(false) }}>取消</Button><Button size="sm" className="h-7" disabled={!keywordsDraft.length || updatingPlan} onClick={() => { onUpdateKeywords(keywordsDraft); setEditingKeywords(false) }}>{updatingPlan ? <Loader2 className="animate-spin" /> : null}保存</Button></div>
            </div> : null}
          </div>
        </div>
        {!isOnlyAiQA ? (
          <div className="grid gap-2 sm:grid-cols-[72px_1fr]">
            <span className="text-cyber-text-muted">采集深度</span>
            <div className="flex flex-wrap gap-1.5">{(['quick', 'standard', 'deep'] as const).map((item) => <button key={item} type="button" disabled={updatingPlan} onClick={() => onUpdateDepth(item)} className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${depth === item ? 'border-cyber-neon-cyan/80 bg-cyber-neon-cyan/15 font-medium text-cyber-neon-cyan' : 'border-cyber-border-subtle text-cyber-text-muted hover:border-cyber-border-default hover:text-cyber-text-primary'}`}>{DEPTH_LABELS[item]}</button>)}</div>
          </div>
        ) : null}
        {plan.plan.analysisSource !== 'fallback' && plan.plan.analysis.length ? <div className="grid gap-2 sm:grid-cols-[72px_1fr]"><span className="text-cyber-text-muted">分析方向</span><p className="leading-5 text-cyber-text-secondary">{plan.plan.analysis.join('、')} <span className="text-[10px] text-cyber-text-muted">（根据对话提炼，不影响采集执行）</span></p></div> : null}
        <p className="border-t border-cyber-border-subtle pt-2 text-[10px] text-cyber-text-muted">需要更换平台或补充条件，可以直接在对话中告诉我。</p>
      </div>
      <div className="flex justify-end border-t border-cyber-border-subtle bg-cyber-bg-tertiary/20 px-4 py-3">
        <Button size="sm" onClick={onExecute} disabled={executing}><Play />确认并开始</Button>
      </div>
    </div>
  )
}

function ChatCrawlingStatusBanner({
  activePlan,
  rightSidebarOpen,
  onToggleRightSidebar,
  onTriggerPulse,
}: {
  activePlan: AgentPlan
  rightSidebarOpen: boolean
  onToggleRightSidebar: () => void
  onTriggerPulse: () => void
}) {
  if (!activePlan) return null

  const isRunning = ['queued', 'running'].includes(activePlan.status)
  if (!isRunning) return null

  const totalSteps = activePlan.steps.length
  const completedSteps = activePlan.steps.filter((s) => s.status === 'completed').length

  const handleClick = () => {
    if (!rightSidebarOpen) {
      onToggleRightSidebar()
      toast.info('已在右侧展开任务大盘', { duration: 2000 })
    } else {
      onTriggerPulse()
      toast.info('任务详情已在右侧大盘中显示', { duration: 2000 })
    }
  }

  return (
    <div className="flex gap-3 text-xs text-cyber-text-muted">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10">
        <Bot className="h-4 w-4 text-cyber-neon-cyan" />
      </div>
      <div className="flex items-center gap-2 py-1">
        <button
          type="button"
          onClick={handleClick}
          className="inline-flex items-center gap-1.5 transition-colors hover:text-cyber-text-primary"
          title={rightSidebarOpen ? '任务大盘已在右侧显示' : '点击展开右侧任务大盘'}
        >
          <Search className="h-3.5 w-3.5 text-cyber-neon-cyan animate-pulse" />
          <span>🔍 正在采集数据 ({completedSteps}/{totalSteps})</span>
        </button>
      </div>
    </div>
  )
}

function MessageBubble({ message, plan, showPlanCard, onExecute, executing, onUpdateKeywords, onUpdateDepth, updatingPlan, onDeletePair, deletingPair, onPreviewImage }: {
  message: AgentMessage; plan: AgentPlan | null; onExecute: () => void; executing: boolean
  showPlanCard: boolean
  onUpdateKeywords: (keywords: string[]) => void
  onUpdateDepth: (depth: 'quick' | 'standard' | 'deep') => void
  updatingPlan: boolean
  onDeletePair: () => Promise<unknown>
  deletingPair: boolean
  onPreviewImage?: (url: string) => void
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const copyMarkdown = async () => {
    try {
      await copyText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
      toast.success('已复制 Markdown 原文')
    } catch (error) {
      toast.error(getError(error))
    }
  }
  return (
    <div className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10"><Bot className="h-4 w-4 text-cyber-neon-cyan" /></div>}
      <div className={`max-w-[780px] ${isUser ? 'rounded-2xl rounded-tr-sm bg-cyber-neon-cyan/12 px-4 py-3' : 'min-w-0 flex-1'}`}>
        {isUser && (message.metadata?.attachments?.length || message.metadata?.task_references?.length) ? <div className="mb-2 flex flex-wrap justify-end gap-2">
          {(message.metadata.attachments || []).map((attachment: AgentAttachment) => {
            const isImage = attachment.kind === 'image' || attachment.mime_type?.startsWith('image/')
            const imgUrl = attachment.preview_url || agentApi.getAttachmentFileUrl(message.thread_id, attachment.attachment_id)
            if (isImage) {
              return (
                <div key={attachment.attachment_id} className="overflow-hidden rounded-xl border border-cyber-border-default bg-cyber-bg-panel/80 p-1 group/img">
                  <img
                    src={imgUrl}
                    alt={attachment.file_name}
                    className="max-h-56 max-w-xs rounded-lg object-contain transition-transform hover:scale-[1.02] cursor-pointer"
                    onClick={() => onPreviewImage?.(imgUrl)}
                  />
                  <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-cyber-text-muted">
                    <span className="truncate max-w-[140px]">{attachment.file_name}</span>
                    {attachment.size_bytes ? <span>{(attachment.size_bytes / 1024).toFixed(0)}KB</span> : null}
                  </div>
                </div>
              )
            }
            return (
              <span key={attachment.attachment_id} className="inline-flex max-w-52 items-center gap-1 rounded-md border border-cyber-border-default bg-cyber-bg-panel/60 px-2 py-1 text-[10px] text-cyber-text-secondary"><Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{attachment.file_name}</span></span>
            )
          })}
          {(message.metadata.task_references || []).map((reference: { plan_id: string; goal: string; platforms?: string[] }) => <span key={reference.plan_id} className="inline-flex max-w-52 items-center gap-1 rounded-md border border-cyber-neon-green/30 bg-cyber-neon-green/5 px-2 py-1 text-[10px] text-cyber-text-secondary"><Database className="h-3 w-3 shrink-0" /><span className="truncate">{reference.goal}</span></span>)}
        </div> : null}
        {isUser
          ? <div className="whitespace-pre-wrap text-sm leading-6 text-cyber-text-primary">{message.content}</div>
          : <MarkdownContent content={message.content} />}
        {message.kind === 'export' && typeof message.metadata?.plan_id === 'string'
          ? <CsvDownloadLink planId={message.metadata.plan_id} />
          : null}
        {SHOW_INLINE_PLAN_CARDS && showPlanCard && plan && message.metadata?.plan_id === plan.plan_id
          ? <PlanCard plan={plan} onExecute={onExecute} executing={executing} onUpdateKeywords={onUpdateKeywords} onUpdateDepth={onUpdateDepth} updatingPlan={updatingPlan} /> : null}
        <div className={`mt-1.5 flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <p className="text-[9px] text-cyber-text-muted">{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.created_at))}</p>
          <div className="flex items-center opacity-60 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            <button type="button" onClick={copyMarkdown} className="flex h-6 w-6 items-center justify-center rounded text-cyber-text-muted transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary" title="复制 Markdown 原文" aria-label="复制 Markdown 原文">
              {copied ? <Check className="h-3 w-3 text-cyber-neon-green" /> : <Copy className="h-3 w-3" />}
            </button>
            {!isUser ? <DeleteConfirmDialog
              trigger={<button type="button" disabled={deletingPair} className="flex h-6 w-6 items-center justify-center rounded text-cyber-text-muted transition-colors hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink disabled:opacity-40" title="删除这一轮对话" aria-label="删除这一轮对话"><Trash2 className="h-3 w-3" /></button>}
              title="删除这一轮对话？"
              description="将删除这条用户消息及其对应的全部 AI 回复；关联的采集任务和看板数据会保留。此操作无法撤销。"
              confirmLabel="删除这一轮"
              onConfirm={onDeletePair}
            /> : null}
          </div>
        </div>
      </div>
      {isUser && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-bg-tertiary"><User className="h-4 w-4 text-cyber-text-secondary" /></div>}
    </div>
  )
}

type AgentWorkspaceProps = {
  selectedId: string | null
  onSelectedIdChange: Dispatch<SetStateAction<string | null>>
  onOpenResults: (context: { threadId: string; planId: string }) => void
}

export function AgentWorkspace({ selectedId, onSelectedIdChange: setSelectedId, onOpenResults }: AgentWorkspaceProps) {
  const client = useQueryClient()
  useLogWebSocket()
  const [input, setInput] = useState('')

  const handleExecuteCommand = (cmd: string) => {
    if (cmd === 'clear') {
      setInput('')
      toast.info('已清空输入框')
    } else if (cmd === 'export') {
      toast.info('可以通过结果看板或任务大盘导出数据')
    } else if (cmd === 'crawl') {
      toast.info('请输入目标关键词并发送消息')
    }
  }

  const mentionCommands = useMentionCommands({
    value: input,
    onChange: setInput,
    onExecuteCommand: handleExecuteCommand,
  })
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [aiRetryState, setAiRetryState] = useState<{ count: number; max: number; delaySec: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const [taskReferences, setTaskReferences] = useState<Array<{ plan_id: string; goal: string; platforms: string[] }>>([])
  const [threadsCollapsed, setThreadsCollapsed] = useState(() => localStorage.getItem('unisearch-threads-collapsed') === 'true')

  const systemLogs = useCrawlerStore((state) => state.logs.system)

  const browserWindowQuery = useQuery({
    queryKey: ['browser-window-status'],
    queryFn: async () => (await browserApi.getWindowStatus()).data,
    refetchInterval: 3000,
  })

  const toggleBrowserWindow = useMutation({
    mutationFn: async () => (await browserApi.toggleWindow('toggle')).data,
    onSuccess: (data) => {
      client.setQueryData(['browser-window-status'], data)
      if (data.has_views === false) {
        toast.info('当前任务为后台 HTTP 接口采集，无需网页浏览器视窗')
      } else {
        toast.success(data.visible ? '已打开内置采集浏览器窗口' : '已隐藏内置采集浏览器窗口')
      }
    },
    onError: (error) => toast.error(getError(error)),
  })
  const [threadSearchOpen, setThreadSearchOpen] = useState(false)
  const [threadSearchQuery, setThreadSearchQuery] = useState('')
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null)
  const [renamingThread, setRenamingThread] = useState<AgentThreadSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteAnalyticsData, setDeleteAnalyticsData] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => localStorage.getItem('unisearch-right-sidebar-open') !== 'false')
  const [rightSidebarPulsing, setRightSidebarPulsing] = useState(false)
  const triggerRightSidebarPulse = () => {
    setRightSidebarPulsing(true)
    window.setTimeout(() => setRightSidebarPulsing(false), 1200)
  }
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => storedPanelSize('unisearch-left-sidebar-width', 270))
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => storedPanelSize('unisearch-right-sidebar-width', 300))
  const [terminalHeight, setTerminalHeight] = useState(() => storedPanelSize('unisearch-terminal-height', 220))
  const [activeResize, setActiveResize] = useState<'left' | 'terminal' | 'right' | null>(null)
  const [petCelebrating, setPetCelebrating] = useState(false)
  const workspaceRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const petReactionTimerRef = useRef<number | null>(null)
  const petReactionFrameRef = useRef<number | null>(null)
  const send = useMutation({
    mutationFn: ({ id, content, attachmentIds, references }: { id: string; content: string; attachmentIds: string[]; references: Array<{ plan_id: string; platforms: string[] }>; message: AgentMessage }) => agentApi.sendMessage(id, content, { attachment_ids: attachmentIds, task_references: references }),
    onMutate: async ({ id, message }) => {
      await client.cancelQueries({ queryKey: ['agent-thread', id] })
      client.setQueryData<AgentThread>(['agent-thread', id], (current) => current ? {
        ...current,
        last_message: message.content,
        updated_at: message.created_at,
        messages: [...current.messages, message],
      } : current)
    },
    onSuccess: ({ data }) => {
      client.setQueryData(['agent-thread', data.thread_id], data)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      client.invalidateQueries({ queryKey: ['agent-model-profile'] })
    },
    onError: (error, { id }) => {
      toast.error(getError(error))
      client.invalidateQueries({ queryKey: ['agent-thread', id] })
      client.invalidateQueries({ queryKey: ['agent-threads'] })
    },
  })

  useEffect(() => {
    if (!send.isPending) {
      setAiRetryState(null)
      return
    }
    const latest = systemLogs.at(-1)
    if (latest && latest.thread_id === selectedId && latest.retry_count) {
      setAiRetryState({
        count: latest.retry_count,
        max: latest.max_retries || 3,
        delaySec: latest.delay_sec || 5,
      })
    }
  }, [systemLogs, send.isPending, selectedId])

  const threadsQuery = useQuery({ queryKey: ['agent-threads'], queryFn: async () => (await agentApi.listThreads()).data.items, refetchInterval: 3000 })
  const threadQuery = useQuery({ queryKey: ['agent-thread', selectedId], queryFn: async () => (await agentApi.getThread(selectedId!)).data, enabled: Boolean(selectedId), refetchInterval: send.isPending ? false : 1500 })
  const referenceableTasksQuery = useQuery({ queryKey: ['agent-referenceable-tasks'], queryFn: async () => (await agentApi.listReferenceableTasks()).data.items, enabled: taskPickerOpen })

  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  const ensureThread = async () => {
    if (selectedId) return selectedId
    const thread = (await agentApi.createThread(undefined, false)).data
    client.setQueryData(['agent-thread', thread.thread_id], thread)
    setSelectedId(thread.thread_id)
    client.invalidateQueries({ queryKey: ['agent-threads'] })
    return thread.thread_id
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const targetId = await ensureThread()
      if (file.size > 8 * 1024 * 1024) throw new Error(`文件 ${file.name} 超过 8MB 限制`)
      const localPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
      const dataBase64 = await fileToBase64(file)
      const res = await agentApi.uploadAttachment(targetId, { fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 })
      return { ...res.data, preview_url: localPreviewUrl }
    },
    onSuccess: (attachment) => setAttachments((current) => [...current, attachment].slice(0, 5)),
    onError: (error) => toast.error(getError(error)),
  })

  const handleFilesToUpload = async (fileList: FileList | File[]) => {
    const rawFiles = Array.from(fileList)
    if (!rawFiles.length) return

    const availableSlots = 5 - attachments.length
    if (availableSlots <= 0) {
      toast.warning('最多绑定 5 个附件')
      return
    }

    const validFiles: File[] = []
    const unsupportedFiles: string[] = []

    for (const file of rawFiles) {
      const name = file.name || 'unnamed'
      const ext = name.includes('.') ? (name.split('.').pop() || '').toLowerCase() : ''
      const mime = (file.type || '').toLowerCase()

      if (mime.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'exe', 'dmg', 'sh', 'bat', 'zip', 'tar', 'gz'].includes(ext)) {
        unsupportedFiles.push(name)
      } else {
        validFiles.push(file)
      }
    }

    if (unsupportedFiles.length > 0) {
      toast.error(`暂不支持视频/压缩包/可执行文件：${unsupportedFiles.slice(0, 2).join(', ')}${unsupportedFiles.length > 2 ? ' 等' : ''}`)
    }

    const filesToUpload = validFiles.slice(0, availableSlots)
    if (filesToUpload.length > 0) {
      try {
        await filesToUpload.reduce((promise, file) =>
          promise.then(() => upload.mutateAsync(file).then(() => undefined)), Promise.resolve()
        )
      } catch {
        // Handled in mutation
      }
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current += 1
    if (e.dataTransfer.types && Array.from(e.dataTransfer.types).includes('Files')) {
      setIsDragOver(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setIsDragOver(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesToUpload(e.dataTransfer.files)
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const files: File[] = []
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file) files.push(file)
      }
    }

    if (files.length > 0) {
      e.preventDefault()
      handleFilesToUpload(files)
    }
  }

  const createNewTask = useMutation({
    mutationFn: async () => (await agentApi.createThread()).data,
    onSuccess: (thread) => {
      client.setQueryData(['agent-thread', thread.thread_id], thread)
      setSelectedId(thread.thread_id)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      window.requestAnimationFrame(() => composerInputRef.current?.focus())
    },
    onError: (error) => toast.error(getError(error)),
  })

  const create = useMutation({
    mutationFn: async (_submission: { content: string; references: Array<{ plan_id: string; platforms: string[] }>; taskReferences: Array<{ plan_id: string; goal: string; platforms: string[] }> }) =>
      (await agentApi.createThread(undefined, false)).data,
    onSuccess: (thread, submission) => {
      const message: AgentMessage = {
        message_id: `pending-${Date.now()}`,
        thread_id: thread.thread_id,
        role: 'user',
        kind: 'text',
        content: submission.content,
        metadata: { optimistic: true, attachments: [], task_references: submission.taskReferences },
        created_at: new Date().toISOString(),
      }
      client.setQueryData(['agent-thread', thread.thread_id], thread)
      setSelectedId(thread.thread_id)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      send.mutate({ id: thread.thread_id, content: submission.content, attachmentIds: [], references: submission.references, message })
    },
    onError: (error, submission) => {
      setInput((current) => current || submission.content)
      setTaskReferences((current) => current.length ? current : submission.taskReferences)
      toast.error(getError(error))
    },
  })
  const remove = useMutation({
    mutationFn: ({ id, withData }: { id: string; withData: boolean }) => agentApi.deleteThread(id, withData),
    onMutate: async ({ id }) => {
      await Promise.all([
        client.cancelQueries({ queryKey: ['agent-threads'] }),
        client.cancelQueries({ queryKey: ['agent-thread', id] }),
      ])
      const previousThreads = client.getQueryData<AgentThreadSummary[]>(['agent-threads'])
      client.setQueryData<AgentThreadSummary[]>(['agent-threads'], (current) => current?.filter((thread) => thread.thread_id !== id))
      client.removeQueries({ queryKey: ['agent-thread', id], exact: true })
      setSelectedId((current) => current === id ? null : current)
      return { previousThreads }
    },
    onSuccess: (_response, { id }) => {
      client.removeQueries({ queryKey: ['agent-thread', id], exact: true })
      client.invalidateQueries({ queryKey: ['agent-threads'] })
    },
    onError: (error, { id }, context) => {
      if (context?.previousThreads) client.setQueryData(['agent-threads'], context.previousThreads)
      setSelectedId(id)
      client.invalidateQueries({ queryKey: ['agent-thread', id] })
      toast.error(getError(error))
    },
  })
  const removeMessagePair = useMutation({
    mutationFn: ({ threadId, messageId }: { threadId: string; messageId: string }) => agentApi.deleteMessagePair(threadId, messageId),
    onSuccess: ({ data }) => {
      client.setQueryData(['agent-thread', data.thread_id], data)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      toast.success('这一轮对话已删除')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => agentApi.renameThread(id, title),
    onSuccess: ({ data }) => {
      client.setQueryData<AgentThreadSummary[]>(['agent-threads'], (current) => current?.map((thread) =>
        thread.thread_id === data.thread_id ? { ...thread, ...data } : thread,
      ))
      client.setQueryData<AgentThread>(['agent-thread', data.thread_id], (current) => current ? {
        ...current,
        title: data.title,
        title_source: data.title_source,
        title_locked: data.title_locked,
      } : current)
      setRenamingThread(null)
      setRenameTitle('')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const pinThread = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => agentApi.setThreadPinned(id, pinned),
    onSuccess: ({ data }, { pinned }) => {
      client.setQueryData<AgentThreadSummary[]>(['agent-threads'], (current) => {
        const updated = current?.map((thread) => thread.thread_id === data.thread_id ? { ...thread, pinned_at: data.pinned_at } : thread)
        return updated?.sort((a, b) => {
          if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) return a.pinned_at ? -1 : 1
          return String(b.pinned_at || b.updated_at).localeCompare(String(a.pinned_at || a.updated_at))
        })
      })
      client.setQueryData<AgentThread>(['agent-thread', data.thread_id], (current) => current ? { ...current, pinned_at: data.pinned_at } : current)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      toast.success(pinned ? '任务已置顶' : '已取消置顶')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const execute = useMutation({
    mutationFn: (planId: string) => agentApi.executePlan(planId),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['agent-thread', selectedId] }); toast.success('任务已进入本地执行队列') },
    onError: (error) => toast.error(getError(error)),
  })
  const updatePlan = useMutation({
    mutationFn: ({ planId, updates }: { planId: string; updates: { keywords?: string[]; analysis?: string[]; collectionDepth?: 'quick' | 'standard' | 'deep' | 'custom' } }) =>
      agentApi.updatePlan(planId, updates),
    onMutate: ({ planId, updates }) => {
      client.setQueryData<AgentThread>(['agent-thread', selectedId], (current) => current?.plan?.plan_id === planId ? {
        ...current,
        plan: {
          ...current.plan,
          plan: {
            ...current.plan.plan,
            ...updates,
            ...(updates.collectionDepth === 'quick' ? { collectComments: false, collectSubComments: false, startPage: 1 } : {}),
            ...(updates.collectionDepth === 'standard' ? { collectComments: true, collectSubComments: false, startPage: 1 } : {}),
            ...(updates.collectionDepth === 'deep' ? { collectComments: true, collectSubComments: true, startPage: 1 } : {}),
          },
        },
      } : current)
    },
    onSuccess: () => { client.invalidateQueries({ queryKey: ['agent-thread', selectedId] }); toast.success('计划参数已更新') },
    onError: (error) => { client.invalidateQueries({ queryKey: ['agent-thread', selectedId] }); toast.error(getError(error)) },
  })

  useEffect(() => {
    setAttachments([])
    setTaskReferences([])
    setAddMenuOpen(false)
    setThreadMenuId(null)
  }, [selectedId])
  useEffect(() => {
    if (!threadMenuId) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setThreadMenuId(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [threadMenuId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [threadQuery.data?.messages.length, send.isPending])
  useEffect(() => () => {
    if (petReactionTimerRef.current !== null) window.clearTimeout(petReactionTimerRef.current)
    if (petReactionFrameRef.current !== null) window.cancelAnimationFrame(petReactionFrameRef.current)
  }, [])

  const submit = () => {
    const content = input.trim()
    if (!content || send.isPending || create.isPending) return
    const references = taskReferences.map(({ plan_id, platforms }) => ({ plan_id, platforms }))
    if (!selectedId) {
      const selectedTaskReferences = [...taskReferences]
      setInput('')
      setTaskReferences([])
      create.mutate({ content, references, taskReferences: selectedTaskReferences })
      return
    }
    const message: AgentMessage = {
      message_id: `pending-${Date.now()}`,
      thread_id: selectedId,
      role: 'user',
      kind: 'text',
      content,
      metadata: { optimistic: true, attachments, task_references: taskReferences },
      created_at: new Date().toISOString(),
    }
    const attachmentIds = attachments.map((attachment) => attachment.attachment_id)
    setInput('')
    setAttachments([])
    setTaskReferences([])
    send.mutate({ id: selectedId, content, attachmentIds, references, message })
  }

  const removeAttachment = async (attachment: AgentAttachment) => {
    setAttachments((current) => current.filter((item) => item.attachment_id !== attachment.attachment_id))
    if (selectedId) agentApi.deleteAttachment(selectedId, attachment.attachment_id).catch(() => undefined)
  }

  const toggleTaskReference = (task: AgentTaskReference) => {
    setTaskReferences((current) => current.some((item) => item.plan_id === task.plan_id)
      ? current.filter((item) => item.plan_id !== task.plan_id)
      : [...current, { plan_id: task.plan_id, goal: task.goal, platforms: [] }].slice(0, 3))
  }

  const setReferencePlatforms = (task: AgentTaskReference, platforms: string[]) => {
    setTaskReferences((current) => current.map((item) => item.plan_id === task.plan_id ? { ...item, platforms } : item))
  }
  const activePlan = threadQuery.data?.plan || null
  const latestPlanMessageId = useMemo(() => [...(threadQuery.data?.messages || [])].reverse().find((message) => message.metadata?.plan_id === activePlan?.plan_id && (message.kind === 'plan' || message.metadata?.action === 'revise_plan'))?.message_id || null, [threadQuery.data?.messages, activePlan?.plan_id])
  const filteredThreads = useMemo(() => {
    const query = threadSearchQuery.trim().toLocaleLowerCase()
    if (!query) return threadsQuery.data || []
    return (threadsQuery.data || []).filter((thread) =>
      thread.title.toLocaleLowerCase().includes(query) || thread.last_message?.toLocaleLowerCase().includes(query)
    )
  }, [threadSearchQuery, threadsQuery.data])
  const runningThreads = useMemo(
    () => (threadsQuery.data || []).filter((thread) => ['queued', 'running'].includes(thread.plan_status || '')),
    [threadsQuery.data],
  )
  const isCollecting = (threadsQuery.data || []).some((thread) => thread.plan_status === 'running')
  const terminalPlatforms = useMemo(() => Array.from(new Set(activePlan?.steps.map((step) => step.platform) || [])), [activePlan])
  const isThinking = send.isPending && send.variables?.id === selectedId
  const toggleThreads = () => {
    setThreadsCollapsed((current) => {
      localStorage.setItem('unisearch-threads-collapsed', String(!current))
      return !current
    })
  }
  const toggleRightSidebar = () => {
    setRightSidebarOpen((current) => {
      localStorage.setItem('unisearch-right-sidebar-open', String(!current))
      return !current
    })
  }
  const openNewTask = () => {
    setInput('')
    setTerminalOpen(false)
    createNewTask.mutate()
  }
  const celebratePet = () => {
    if (petReactionTimerRef.current !== null) window.clearTimeout(petReactionTimerRef.current)
    if (petReactionFrameRef.current !== null) window.cancelAnimationFrame(petReactionFrameRef.current)
    setPetCelebrating(false)
    petReactionFrameRef.current = window.requestAnimationFrame(() => {
      setPetCelebrating(true)
      petReactionTimerRef.current = window.setTimeout(() => setPetCelebrating(false), 800)
    })
  }

  const updateLeftSidebarWidth = (value: number) => {
    const next = Math.round(Math.min(420, Math.max(220, value)))
    setLeftSidebarWidth(next)
    localStorage.setItem('unisearch-left-sidebar-width', String(next))
  }
  const updateRightSidebarWidth = (value: number) => {
    const next = Math.round(Math.min(380, Math.max(210, value)))
    setRightSidebarWidth(next)
    localStorage.setItem('unisearch-right-sidebar-width', String(next))
  }
  const updateTerminalHeight = (value: number) => {
    const next = Math.round(Math.min(480, Math.max(140, value)))
    setTerminalHeight(next)
    localStorage.setItem('unisearch-terminal-height', String(next))
  }
  const beginResize = (event: ReactPointerEvent<HTMLDivElement>, target: 'left' | 'terminal' | 'right', onMove: (event: PointerEvent) => void) => {
    event.preventDefault()
    setActiveResize(target)
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = target === 'terminal' ? 'row-resize' : 'col-resize'
    document.body.style.userSelect = 'none'
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      setActiveResize(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  return (
    <div ref={workspaceRef} className="flex h-full min-h-0 overflow-hidden">
      <aside
        className={`relative hidden shrink-0 flex-col border-r border-cyber-border-subtle bg-cyber-bg-secondary/70 md:flex ${activeResize === 'left' ? '' : 'transition-[width] duration-200'}`}
        style={{ width: threadsCollapsed ? 56 : leftSidebarWidth }}
      >
        <div className={`flex items-center px-2 pb-2 pt-3 ${threadsCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!threadsCollapsed && <div className="pl-3 text-xl font-semibold tracking-tight text-cyber-text-primary">UniSearch</div>}
          <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={toggleThreads} title={threadsCollapsed ? '展开任务栏' : '收起任务栏'}>
            {threadsCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
        <div className="px-2 pb-3">
          <Button className={threadsCollapsed ? 'h-9 w-9 p-0' : 'w-full justify-start'} variant="ghost" onClick={openNewTask} disabled={create.isPending || createNewTask.isPending} title="新建任务">{createNewTask.isPending ? <Loader2 className="animate-spin" /> : <SquarePen />}{!threadsCollapsed && '新建任务'}</Button>
        </div>
        {!threadsCollapsed && <>
          <div className="mx-2 border-t border-cyber-border-subtle" />
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[11px] font-medium text-cyber-text-muted">任务</span>
            <button
              type="button"
              onClick={() => {
                setThreadSearchOpen((open) => !open)
                if (threadSearchOpen) setThreadSearchQuery('')
              }}
              className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary ${threadSearchOpen ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted'}`}
              aria-label={threadSearchOpen ? '关闭任务搜索' : '搜索任务'}
              title={threadSearchOpen ? '关闭搜索' : '搜索任务'}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
          {threadSearchOpen && <div className="px-2 pb-2">
            <Input
              autoFocus
              value={threadSearchQuery}
              onChange={(event) => setThreadSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setThreadSearchOpen(false)
                  setThreadSearchQuery('')
                }
              }}
              placeholder="搜索任务"
              aria-label="搜索任务"
              className="h-8 text-xs"
            />
          </div>}
          <div className="min-h-0 flex-1 flex flex-col gap-1 overflow-y-auto px-2 pb-3">
            {threadMenuId ? <button type="button" className="fixed inset-0 z-30 cursor-default" onClick={() => setThreadMenuId(null)} aria-label="关闭任务菜单" /> : null}
            {filteredThreads.map((thread, index) => (
              <div key={thread.thread_id} className={`group relative ${threadMenuId === thread.thread_id ? 'z-40' : ''}`}>
                <button type="button" onClick={() => setSelectedId(thread.thread_id)}
                  className={`w-full rounded-lg px-3 py-2.5 text-left transition-colors ${selectedId === thread.thread_id ? 'bg-cyber-neon-cyan/10 text-cyber-text-primary' : threadMenuId === thread.thread_id ? 'bg-cyber-bg-tertiary/80 text-cyber-text-primary' : 'text-cyber-text-secondary group-hover:bg-cyber-bg-tertiary/60'}`}>
                  <div className="flex items-center gap-2 pr-6"><span className="min-w-0 flex-1 truncate text-xs font-medium">{thread.title}</span>{thread.plan_status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyber-neon-green" />}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-cyber-text-muted">
                    <span className="min-w-0 flex-1 truncate">
                      {['running', 'queued'].includes(thread.plan_status || '') ? (
                        <span className="font-medium text-cyber-neon-green">⚡ 任务采集分析中...</span>
                      ) : ['completed', 'partially_completed'].includes(thread.plan_status || '') ? (
                        <span className="text-cyber-text-secondary">
                          ✓ {thread.total_items ? `已采集 ${thread.total_items} 条数据` : '采集分析完成'}
                        </span>
                      ) : thread.plan_status === 'failed' ? (
                        <span className="text-cyber-neon-pink">✕ 采集中断</span>
                      ) : (
                        thread.last_message || '暂无消息'
                      )}
                    </span>
                    <span className="shrink-0 text-[9px] text-cyber-text-muted">{timeAgo(thread.updated_at)}</span>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setThreadMenuId((current) => current === thread.thread_id ? null : thread.thread_id);
                  }}
                  className={`absolute right-1.5 top-2 z-40 flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                    threadMenuId === thread.thread_id
                      ? 'bg-white/70 text-cyber-text-primary opacity-100 shadow-sm ring-1 ring-black/5 dark:bg-white/15'
                      : thread.pinned_at
                      ? 'opacity-100 text-cyber-neon-cyan hover:bg-white/60 hover:text-cyber-text-primary dark:hover:bg-white/10'
                      : 'opacity-0 hover:bg-white/60 hover:text-cyber-text-primary dark:hover:bg-white/10 focus:opacity-100 group-hover:opacity-100'
                  }`}
                  aria-label={`管理 ${thread.title}`}
                  aria-haspopup="menu"
                  aria-expanded={threadMenuId === thread.thread_id}
                  title="任务操作"
                >
                  {threadMenuId === thread.thread_id ? (
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  ) : thread.pinned_at ? (
                    <>
                      <Pin className="h-3.5 w-3.5 block group-hover:hidden" />
                      <MoreHorizontal className="h-3.5 w-3.5 hidden group-hover:block text-cyber-text-secondary" />
                    </>
                  ) : (
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  )}
                </button>
                <div role="menu" className={`${threadMenuId === thread.thread_id ? 'absolute' : 'hidden'} right-1.5 z-50 w-32 overflow-hidden rounded-lg border border-cyber-border-default bg-cyber-bg-panel py-1 shadow-xl ${filteredThreads.length > 2 && index >= filteredThreads.length - 2 ? 'bottom-8' : 'top-8'}`}>
                  <button type="button" role="menuitem" disabled={pinThread.isPending} onClick={() => { setThreadMenuId(null); pinThread.mutate({ id: thread.thread_id, pinned: !thread.pinned_at }) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary disabled:opacity-50">
                    {thread.pinned_at ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}{thread.pinned_at ? '取消置顶' : '置顶'}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setThreadMenuId(null); setRenamingThread(thread); setRenameTitle(thread.title) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary">
                    <SquarePen className="h-3.5 w-3.5" />重命名
                  </button>
                  <div className="my-1 border-t border-cyber-border-subtle" />
                  <DeleteConfirmDialog
                    trigger={<button type="button" role="menuitem" disabled={remove.isPending} onClick={() => setThreadMenuId(null)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cyber-neon-pink hover:bg-cyber-neon-pink/10 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 className="h-3.5 w-3.5" />删除</button>}
                    title="删除这个任务？"
                    description="将删除这个任务及其全部对话、计划和附件，此操作无法撤销。"
                    confirmLabel="删除任务"
                    onConfirm={() => remove.mutateAsync({ id: thread.thread_id, withData: deleteAnalyticsData })}
                  >
                    <label className="flex items-center gap-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/60 p-3 text-left text-xs">
                      <Checkbox checked={deleteAnalyticsData} onCheckedChange={setDeleteAnalyticsData} />
                      <span className="font-medium text-cyber-text-primary">同时清理对应看板数据</span>
                    </label>
                  </DeleteConfirmDialog>
                </div>
              </div>
            ))}
            {threadSearchQuery.trim() && !filteredThreads.length ? <p className="px-3 py-6 text-center text-[11px] text-cyber-text-muted">未找到匹配任务</p> : null}
          </div>
        </>}
        <div className="mt-auto space-y-1 border-t border-cyber-border-subtle p-2">
          <SettingsDialog
            compact={threadsCollapsed}
            open={settingsOpen}
            onOpenChange={(open) => {
              setSettingsOpen(open)
              if (!open) setSettingsSection('appearance')
            }}
            initialSection={settingsSection}
          />
        </div>
        {!threadsCollapsed && <div
          className={`absolute -right-[3px] top-0 z-20 h-full w-1.5 touch-none cursor-col-resize transition-colors hover:bg-cyber-neon-cyan/25 ${activeResize === 'left' ? 'bg-cyber-neon-cyan/35' : ''}`}
          onPointerDown={(event) => beginResize(event, 'left', (moveEvent) => {
            const bounds = workspaceRef.current?.getBoundingClientRect()
            if (bounds) updateLeftSidebarWidth(moveEvent.clientX - bounds.left)
          })}
          aria-label="调整左侧边栏宽度"
        />}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-cyber-border-subtle px-4 sm:px-6">
          <div className="min-w-0"><h1 className="truncate text-sm font-medium">{threadQuery.data?.title || '新任务'}</h1></div>
          <div className="flex items-center gap-1">
            {isCollecting && browserWindowQuery.data?.has_views !== false && <Button
              size="icon"
              variant="ghost"
              className={`h-9 w-9 ${browserWindowQuery.data?.visible ? 'bg-cyber-neon-cyan/20 text-cyber-neon-cyan border border-cyber-neon-cyan/40' : 'text-cyber-text-muted hover:text-cyber-text-primary'}`}
              onClick={() => toggleBrowserWindow.mutate()}
              disabled={toggleBrowserWindow.isPending}
              title={browserWindowQuery.data?.visible ? '隐藏内置采集浏览器窗口' : '查看/操控内置采集浏览器窗口'}
              aria-label={browserWindowQuery.data?.visible ? '隐藏内置采集浏览器窗口' : '查看/操控内置采集浏览器窗口'}
              aria-pressed={browserWindowQuery.data?.visible}
            >
              {toggleBrowserWindow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : browserWindowQuery.data?.visible ? <Eye className="h-4 w-4 text-cyber-neon-cyan" /> : <EyeOff className="h-4 w-4" />}
            </Button>}
            <Button className="md:hidden" size="icon" variant="ghost" onClick={openNewTask} disabled={create.isPending || createNewTask.isPending}>{createNewTask.isPending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}</Button>
            {selectedId && <Button
              size="icon"
              variant="ghost"
              className={`h-9 w-9 ${terminalOpen ? 'bg-cyber-bg-tertiary text-cyber-neon-cyan' : ''}`}
              onClick={() => setTerminalOpen((open) => !open)}
              title={terminalOpen ? '隐藏终端' : '显示终端'}
              aria-label={terminalOpen ? '隐藏终端' : '显示终端'}
              aria-pressed={terminalOpen}
            ><PanelBottom /></Button>}
            {selectedId && <Button
              size="icon"
              variant="ghost"
              className={`h-9 w-9 ${rightSidebarOpen ? 'bg-cyber-bg-tertiary text-cyber-neon-cyan' : ''}`}
              onClick={toggleRightSidebar}
              title={rightSidebarOpen ? '隐藏当前任务栏' : '显示当前任务栏'}
              aria-label={rightSidebarOpen ? '隐藏当前任务栏' : '显示当前任务栏'}
              aria-pressed={rightSidebarOpen}
            ><PanelRight /></Button>}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col bg-cyber-bg-primary/40">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedId ? <div className="mx-auto max-w-4xl space-y-7 px-4 py-8 sm:px-8">
                {threadQuery.isLoading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-cyber-neon-cyan" /></div> : null}
                {threadQuery.data?.messages.map((message) => <MessageBubble key={message.message_id} message={message} plan={activePlan} showPlanCard={message.message_id === latestPlanMessageId} executing={execute.isPending} onExecute={() => activePlan && execute.mutate(activePlan.plan_id)} onUpdateKeywords={(keywords) => activePlan && updatePlan.mutate({ planId: activePlan.plan_id, updates: { keywords } })} onUpdateDepth={(collectionDepth) => activePlan && updatePlan.mutate({ planId: activePlan.plan_id, updates: { collectionDepth } })} updatingPlan={updatePlan.isPending} deletingPair={removeMessagePair.isPending || send.isPending} onDeletePair={() => removeMessagePair.mutateAsync({ threadId: message.thread_id, messageId: message.message_id })} onPreviewImage={(url) => setPreviewImageUrl(url)} />)}
                {activePlan && activePlan.status !== 'awaiting_confirmation' && (
                  <ChatCrawlingStatusBanner
                    activePlan={activePlan}
                    rightSidebarOpen={rightSidebarOpen}
                    onToggleRightSidebar={toggleRightSidebar}
                    onTriggerPulse={triggerRightSidebarPulse}
                  />
                )}
                {isThinking && (
                  <div className="flex gap-3 text-xs text-cyber-text-muted">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10">
                      <Bot className="h-4 w-4 text-cyber-neon-cyan" />
                    </div>
                    <div className="flex flex-col justify-center gap-1 leading-5">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-cyber-neon-cyan" />
                        <span>AI 正在思考…</span>
                      </div>
                      {aiRetryState ? (
                        <p className="text-cyber-text-muted">
                          重试计数 {aiRetryState.count} / {aiRetryState.max} (等待 {aiRetryState.delaySec}s)
                        </p>
                      ) : null}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div> : <div className="flex min-h-full items-center justify-center px-6 py-12">
                <div className="flex -translate-y-2 flex-col items-center text-center">
                  <button
                    type="button"
                    className={`codex-pet ${petCelebrating ? 'codex-pet--celebrate' : ''}`}
                    onClick={celebratePet}
                    aria-label="和 UniSearch 宠物助手互动"
                    title="摸摸我"
                  />
                  <h2 className="mt-6 text-2xl font-semibold tracking-tight text-cyber-text-primary sm:text-3xl">今天想研究什么？</h2>
                  <p className="mt-2 text-sm text-cyber-text-muted">可以直接聊天，也可以描述想采集和分析的内容</p>
                  {runningThreads.length ? <button
                    type="button"
                    onClick={() => setSelectedId(runningThreads[0].thread_id)}
                    className="mt-6 inline-flex items-center gap-2 rounded-full border border-cyber-neon-green/30 bg-cyber-neon-green/5 px-3.5 py-2 text-xs text-cyber-text-secondary transition-colors hover:border-cyber-neon-green/60 hover:text-cyber-text-primary"
                  >
                    <span className="h-2 w-2 animate-pulse rounded-full bg-cyber-neon-green" />
                    {runningThreads.length} 个任务正在执行 · 点击查看
                  </button> : null}
                </div>
              </div>}
            </div>

            <div className="shrink-0 bg-cyber-bg-primary/90 px-4 pb-3 pt-4 backdrop-blur sm:px-6">
          <div className="mx-auto max-w-4xl">
              <div
                className="agent-composer relative rounded-2xl border border-cyber-border-default bg-cyber-bg-panel transition-colors focus-within:border-cyber-neon-cyan/50"
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isDragOver ? (
                  <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-cyber-neon-cyan bg-cyber-bg-panel/95 backdrop-blur transition-all pointer-events-none">
                    <Paperclip className="h-7 w-7 animate-bounce text-cyber-neon-cyan" />
                    <p className="text-sm font-medium text-cyber-neon-cyan">松开鼠标即可上传文件 / 图片</p>
                    <p className="text-[11px] text-cyber-text-muted">支持图片 (PNG/JPG/WebP/GIF) 与文本/表格 (TXT/MD/CSV/JSON/XLSX，≤ 8MB)</p>
                  </div>
                ) : null}
                {attachments.length || taskReferences.length ? <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {attachments.map((attachment) => {
                    const isImage = attachment.kind === 'image' || attachment.mime_type?.startsWith('image/')
                    const imgUrl = attachment.preview_url || (selectedId ? agentApi.getAttachmentFileUrl(selectedId, attachment.attachment_id) : '')
                    if (isImage && imgUrl) {
                      return (
                        <div key={attachment.attachment_id} className="relative flex max-w-64 items-center gap-2 rounded-xl border border-cyber-border-default bg-cyber-bg-secondary/80 p-1.5 transition-colors hover:border-cyber-neon-cyan/50">
                          <img
                            src={imgUrl}
                            alt={attachment.file_name}
                            className="h-10 w-10 shrink-0 rounded-lg object-cover border border-cyber-border-subtle cursor-pointer hover:opacity-90"
                            onClick={() => setPreviewImageUrl(imgUrl)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-medium text-cyber-text-primary">{attachment.file_name}</p>
                            <p className="text-[9px] text-cyber-text-muted">{(attachment.size_bytes / 1024).toFixed(0)} KB</p>
                          </div>
                          <button type="button" onClick={() => removeAttachment(attachment)} aria-label={`移除 ${attachment.file_name}`} className="rounded p-1 hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary">
                            <X className="h-3.5 w-3.5 text-cyber-text-muted" />
                          </button>
                        </div>
                      )
                    }
                    return (
                      <span key={attachment.attachment_id} className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-cyber-border-default bg-cyber-bg-secondary px-2.5 py-1.5 text-[11px] text-cyber-text-secondary">
                        {attachment.kind === 'spreadsheet' ? <Table2 className="h-3.5 w-3.5 shrink-0 text-cyber-neon-green" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-cyber-text-muted" />}
                        <span className="truncate">{attachment.file_name}</span>
                        <span className="text-[9px] text-cyber-text-muted">({(attachment.size_bytes / 1024).toFixed(0)}KB)</span>
                        <button type="button" onClick={() => removeAttachment(attachment)} aria-label={`移除 ${attachment.file_name}`} className="rounded p-0.5 hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"><X className="h-3 w-3" /></button>
                      </span>
                    )
                  })}
                  {taskReferences.map((reference) => <span key={reference.plan_id} className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-cyber-neon-green/30 bg-cyber-neon-green/5 px-2.5 py-1.5 text-[11px] text-cyber-text-secondary">
                    <Database className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{reference.goal}{reference.platforms.length ? ` · ${reference.platforms.map((platform) => PLATFORM_LABELS[platform] || platform).join('/')}` : ''}</span>
                    <button type="button" onClick={() => setTaskReferences((current) => current.filter((item) => item.plan_id !== reference.plan_id))} aria-label={`移除 ${reference.goal}`} className="rounded p-0.5 hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"><X className="h-3 w-3" /></button>
                  </span>)}
                </div> : null}
                <CommandPopover
                  isOpen={mentionCommands.isOpen}
                  triggerType={mentionCommands.triggerType}
                  items={mentionCommands.items}
                  selectedIndex={mentionCommands.selectedIndex}
                  onSelect={(item) => {
                    if (composerInputRef.current) {
                      mentionCommands.selectItem(item, composerInputRef.current.selectionStart)
                      composerInputRef.current.focus()
                    }
                  }}
                  onMouseEnterItem={(index) => mentionCommands.setSelectedIndex(index)}
                />
                <textarea
                  ref={composerInputRef}
                  value={input}
                  onChange={(e) => {
                    mentionCommands.handleInputChange(e.target.value, e.target.selectionStart)
                  }}
                  onKeyDown={(e) => {
                    const isHandled = mentionCommands.handleKeyDown(e, e.currentTarget.selectionStart)
                    if (isHandled) return
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault()
                      submit()
                    }
                  }}
                  onPaste={handlePaste}
                  placeholder={!selectedId ? '输入问题，或使用 @ 呼出 Connector、/ 呼出快捷指令…' : activePlan?.status === 'awaiting_confirmation' ? '自然地告诉我是否开始，或继续修改平台、关键词和采集范围…' : activePlan && ['completed', 'partially_completed'].includes(activePlan.status) ? '继续提问，例如：分析负面评价的主要原因…' : '使用 @ 选择 Connector 平台，或使用 / 呼出快捷指令…'}
                  className="min-h-[76px] w-full resize-none bg-transparent px-4 py-3 pb-12 pr-14 text-sm outline-none placeholder:text-cyber-text-muted"
                />
                <div className="absolute bottom-3 left-3">
                  <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => setAddMenuOpen((open) => !open)} disabled={upload.isPending || send.isPending} title="添加内容">
                    {upload.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  </Button>
                  {addMenuOpen ? <div className="absolute bottom-11 left-0 z-30 w-56 overflow-hidden rounded-xl border border-cyber-border-default bg-cyber-bg-panel p-1.5 shadow-xl">
                    <button type="button" onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary">
                      <Paperclip className="h-4 w-4" /><span><span className="block font-medium">上传文件</span><span className="mt-0.5 block text-[10px] text-cyber-text-muted">图片、文本、CSV、XLSX</span></span>
                    </button>
                    <button type="button" onClick={() => { setAddMenuOpen(false); setTaskPickerOpen(true) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary">
                      <Database className="h-4 w-4" /><span><span className="block font-medium">引用采集结果</span><span className="mt-0.5 block text-[10px] text-cyber-text-muted">选择已有任务或平台</span></span>
                    </button>
                  </div> : null}
                  <input ref={fileInputRef} type="file" className="hidden" multiple accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.markdown,.csv,.json,.log,.tsv,.xlsx" onChange={(event) => {
                    if (event.target.files && event.target.files.length > 0) {
                      handleFilesToUpload(event.target.files)
                    }
                    event.target.value = ''
                  }} />
                </div>
                <Button size="icon" className="absolute bottom-3 right-3 h-9 w-9" onClick={submit} disabled={!input.trim() || send.isPending || create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <Send />}</Button>
              </div>
          </div>
            </div>
          </main>

          {rightSidebarOpen && selectedId && <aside className={`relative shrink-0 overflow-y-auto border-l border-cyber-border-subtle bg-cyber-bg-secondary/30 p-4 transition-all duration-300 ${rightSidebarPulsing ? 'ring-2 ring-inset ring-cyber-neon-cyan/80 bg-cyber-neon-cyan/10 shadow-[0_0_25px_rgba(0,240,255,0.25)]' : ''}`} style={{ width: rightSidebarWidth }}>
        <div
          className={`absolute -left-[3px] top-0 z-20 h-full w-1.5 touch-none cursor-col-resize transition-colors hover:bg-cyber-neon-cyan/25 ${activeResize === 'right' ? 'bg-cyber-neon-cyan/35' : ''}`}
          onPointerDown={(event) => beginResize(event, 'right', (moveEvent) => {
            const bounds = workspaceRef.current?.getBoundingClientRect()
            if (bounds) updateRightSidebarWidth(bounds.right - moveEvent.clientX)
          })}
          aria-label="调整右侧边栏宽度"
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyber-text-muted">任务与数据大盘</p>
          {activePlan ? <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[activePlan.status] || activePlan.status}</Badge> : null}
        </div>

        {(() => {
          const allPlans = threadQuery.data?.plans || (activePlan ? [activePlan] : [])

          // 计算全会话累计抓取总量
          const sessionTotalItems = allPlans.reduce((sum, plan) => {
            const count = plan.stats?.content_count ?? plan.steps.reduce((acc, s) => acc + (s.item_count || 0), 0)
            return sum + count
          }, 0)

          const isPending = activePlan?.status === 'awaiting_confirmation'
          const isRunning = activePlan ? ['queued', 'running'].includes(activePlan.status) : false
          const canRetry = activePlan ? ['failed', 'partially_completed'].includes(activePlan.status) : false

          // 汇总各平台累计抓取数据分布
          const platformSummaryMap = new Map<string, {
            platform: string
            count: number
            status: string
            isAI: boolean
            error_message?: string
          }>()

          allPlans.forEach((plan) => {
            plan.steps.forEach((step) => {
              const existing = platformSummaryMap.get(step.platform)
              const isAI = AI_PLATFORMS.has(step.platform)
              const count = step.item_count || 0
              if (!existing) {
                platformSummaryMap.set(step.platform, {
                  platform: step.platform,
                  count,
                  status: step.status,
                  isAI,
                  error_message: step.error_message || undefined,
                })
              } else {
                existing.count += count
                if (step.status === 'running' || existing.status === 'running') {
                  existing.status = 'running'
                } else if (step.status === 'completed') {
                  existing.status = 'completed'
                }
                if (step.error_message) {
                  existing.error_message = step.error_message
                }
              }
            })
          })

          const platformSummaryList = Array.from(platformSummaryMap.values())

          const handleApplyPrompt = (promptText: string) => {
            setInput(promptText)
            setTimeout(() => composerInputRef.current?.focus(), 50)
          }

          const latestFinishedPlanId = [...allPlans].reverse().find((p) => ['completed', 'partially_completed'].includes(p.status))?.plan_id || activePlan?.plan_id

          const handleOpenResults = () => {
            if (selectedId && (sessionTotalItems > 0 || latestFinishedPlanId)) {
              onOpenResults({ threadId: selectedId, planId: latestFinishedPlanId || activePlan?.plan_id || '' })
            }
          }

          return (
            <div className="mt-4 space-y-5 text-xs">
              {/* 区域 A：当前任务状态 / 控制卡片 */}
              {activePlan && isPending ? (
                <div className="rounded-xl border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 p-3.5 shadow-sm ring-1 ring-cyber-neon-cyan/30">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 font-semibold text-cyber-neon-cyan">
                      <Sparkles className="h-3.5 w-3.5" /> 待确认采集任务
                    </span>
                    <Badge variant="outline" className="border-cyber-neon-cyan/50 text-[10px] text-cyber-neon-cyan">等待确认</Badge>
                  </div>
                  <div className="mt-2.5 space-y-1.5 text-xs">
                    {activePlan.plan.keywords.length > 0 ? (
                      <p className="truncate font-medium text-cyber-text-primary" title={activePlan.plan.keywords.join(' / ')}>
                        关键词：<span className="text-cyber-neon-cyan">{activePlan.plan.keywords.join(' / ')}</span>
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1 text-[10px] text-cyber-text-muted">
                      <span>平台：{activePlan.plan.platforms.map((p) => PLATFORM_LABELS[p] || p).join('、')}</span>
                    </div>
                  </div>
                  <Button
                    className="mt-3 w-full h-8.5 text-xs gap-1.5 bg-cyber-neon-cyan text-black hover:bg-cyber-neon-cyan/90 font-medium"
                    onClick={() => execute.mutate(activePlan.plan_id)}
                    disabled={execute.isPending}
                  >
                    {execute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-black" />}
                    确认并开始采集
                  </Button>
                </div>
              ) : activePlan && isRunning ? (
                <div className="rounded-xl border border-cyber-neon-cyan/30 bg-cyber-bg-panel/80 p-3.5 shadow-sm">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1.5 font-semibold text-cyber-neon-cyan">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在执行采集任务...
                    </span>
                    <Badge variant="outline" className="animate-pulse text-[10px]">进行中</Badge>
                  </div>
                  {activePlan.plan.keywords.length ? (
                    <p className="mt-2 truncate text-[10px] text-cyber-text-muted">
                      关键词：{activePlan.plan.keywords.join(' / ')}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/* 区域 B：全会话已采集数据总量 */}
              <button
                type="button"
                onClick={handleOpenResults}
                disabled={sessionTotalItems <= 0}
                aria-label={sessionTotalItems > 0 ? `查看已采集的 ${sessionTotalItems} 条数据` : undefined}
                className={`w-full rounded-xl border border-cyber-border-default bg-cyber-bg-panel/70 p-3.5 text-left shadow-sm transition-colors ${sessionTotalItems > 0 ? 'cursor-pointer hover:border-cyber-neon-cyan/50 hover:bg-cyber-bg-panel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyber-neon-cyan/70' : 'cursor-default'}`}
              >
                <div className="flex items-center justify-between text-[10px] text-cyber-text-muted">
                  <span>全会话已采集总量</span>
                  <span className="flex items-center gap-0.5 font-mono">
                    {sessionTotalItems > 0 ? <ChevronRight className="h-3 w-3" /> : null}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className={`text-3xl font-bold tracking-tight text-cyber-neon-cyan ${isRunning ? 'animate-pulse' : ''}`}>
                    {sessionTotalItems.toLocaleString()}
                  </span>
                  <span className="text-xs text-cyber-text-secondary">条内容</span>
                </div>
              </button>

              {/* 全会话分平台采集分布 */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-cyber-text-muted mb-1.5">
                  <span>数据分布与状态</span>
                  {sessionTotalItems > 0 ? <span>已接入平台</span> : null}
                </div>
                <div className="divide-y divide-cyber-border-subtle/60">
                  {platformSummaryList.length > 0 ? (
                    platformSummaryList.map((item) => {
                      const count = item.count
                      const unit = item.isAI ? '份' : '条'
                      const isZeroSuccess = item.status === 'completed' && count === 0

                      return (
                        <div key={item.platform} className="py-2.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="truncate font-medium text-cyber-text-primary">
                                {PLATFORM_LABELS[item.platform] || item.platform}
                              </span>
                              {item.isAI ? (
                                <span className="rounded bg-cyber-bg-tertiary px-1 py-0.5 text-[9px] font-medium text-cyber-neon-cyan">
                                  AI
                                </span>
                              ) : null}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className={`font-mono text-xs ${isZeroSuccess ? 'text-amber-400 font-normal text-[11px]' : 'text-cyber-text-primary'}`}>
                                {count > 0 ? `${count} ${unit}` : item.status === 'completed' ? `0 ${unit}` : ''}
                              </span>
                              {isZeroSuccess ? (
                                <span title="该平台未采集到数据或可能被风控受限">
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                                </span>
                              ) : (
                                <StepIcon status={item.status} />
                              )}
                            </div>
                          </div>
                          {item.error_message ? <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-cyber-neon-pink" title={item.error_message}>{item.error_message}</p> : null}
                        </div>
                      )
                    })
                  ) : (
                    <div className="py-3 text-center text-[11px] text-cyber-text-muted">
                      尚未发起采集任务
                    </div>
                  )}
                </div>
              </div>

              {/* 动作区 */}
              <div className="space-y-2 border-t border-cyber-border-subtle pt-3">
                {sessionTotalItems > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-9 min-w-0 gap-1.5 px-2 text-xs" onClick={handleOpenResults}>
                      <Database className="h-3.5 w-3.5 shrink-0 text-cyber-neon-cyan" />
                      <span className="truncate">结果看板</span>
                    </Button>
                    {latestFinishedPlanId ? <CsvDownloadLink planId={latestFinishedPlanId} compact /> : null}
                  </div>
                ) : null}
                {canRetry && activePlan ? <Button className="w-full h-9 text-xs" onClick={() => execute.mutate(activePlan.plan_id)} disabled={execute.isPending}><Play />重试失败平台</Button> : null}
              </div>

              {/* AI 快捷提问建议 */}
              {sessionTotalItems > 0 && !isRunning ? (
                <div className="pt-2 border-t border-cyber-border-subtle">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-cyber-text-muted mb-2">
                    <Sparkles className="h-3 w-3 text-cyber-neon-cyan" />
                    <span>继续分析</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {[
                      { label: '跨平台对比', prompt: '分析各平台采集到的数据热度与讨论差异' },
                      { label: '用户评价总结', prompt: '总结抓取数据中用户的主要诉求和评论观点' },
                      { label: '高频热词提取', prompt: '提取已采集数据中频繁出现的高频词与热门话题' },
                    ].map(({ label, prompt }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleApplyPrompt(prompt)}
                        className="group inline-flex items-center gap-0.5 text-[11px] text-cyber-text-secondary transition-colors hover:text-cyber-neon-cyan"
                      >
                        {label}<ChevronRight className="h-3 w-3 opacity-50 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })()}
          </aside>}
        </div>
        {terminalOpen && selectedId && (
          <div className="relative shrink-0 border-t border-cyber-border-subtle bg-cyber-bg-primary" style={{ height: terminalHeight }}>
            <div
              className={`absolute -top-[3px] left-0 z-20 h-1.5 w-full touch-none cursor-row-resize transition-colors hover:bg-cyber-neon-cyan/25 ${activeResize === 'terminal' ? 'bg-cyber-neon-cyan/35' : ''}`}
              onPointerDown={(event) => beginResize(event, 'terminal', (moveEvent) => {
                const bounds = workspaceRef.current?.getBoundingClientRect()
                if (bounds) updateTerminalHeight(Math.min(bounds.height - 260, bounds.bottom - moveEvent.clientY))
              })}
              aria-label="调整执行终端高度"
            />
            <Terminal
              showCollapseButton={false}
              platforms={terminalPlatforms}
              planStatus={activePlan?.status}
              docked
              onClose={() => setTerminalOpen(false)}
              threadId={selectedId}
            />
          </div>
        )}
      </section>
      <Dialog open={Boolean(renamingThread)} onOpenChange={(open) => {
        if (!open && !rename.isPending) {
          setRenamingThread(null)
          setRenameTitle('')
        }
      }}>
        <DialogContent className="max-w-md bg-cyber-bg-panel">
          <DialogHeader>
            <DialogTitle>重命名任务</DialogTitle>
            <DialogDescription>手动命名后，系统不会再自动修改这个标题。</DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={renameTitle}
            maxLength={40}
            onChange={(event) => setRenameTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing && renamingThread && renameTitle.trim() && !rename.isPending) {
                rename.mutate({ id: renamingThread.thread_id, title: renameTitle.trim() })
              }
            }}
            aria-label="任务名称"
            placeholder="输入任务名称"
          />
          <DialogFooter>
            <Button variant="outline" disabled={rename.isPending} onClick={() => { setRenamingThread(null); setRenameTitle('') }}>取消</Button>
            <Button disabled={!renameTitle.trim() || rename.isPending} onClick={() => renamingThread && rename.mutate({ id: renamingThread.thread_id, title: renameTitle.trim() })}>
              {rename.isPending && <Loader2 className="animate-spin" />}保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={taskPickerOpen} onOpenChange={setTaskPickerOpen}>
        <DialogContent className="max-w-2xl bg-cyber-bg-panel">
          <DialogHeader>
            <DialogTitle>引用采集结果</DialogTitle>
            <DialogDescription>最多选择 3 个已完成任务。默认引用全部平台，也可以缩小到某个平台。</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
            {referenceableTasksQuery.isLoading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-cyber-neon-cyan" /></div> : null}
            {!referenceableTasksQuery.isLoading && !referenceableTasksQuery.data?.length ? <div className="rounded-xl border border-dashed border-cyber-border-default px-4 py-10 text-center text-xs text-cyber-text-muted">还没有已完成且可引用的采集任务</div> : null}
            {referenceableTasksQuery.data?.map((task) => {
              const selected = taskReferences.find((item) => item.plan_id === task.plan_id)
              return <div key={task.plan_id} className={`rounded-xl border p-3 ${selected ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/5' : 'border-cyber-border-subtle'}`}>
                <button type="button" onClick={() => toggleTaskReference(task)} className="flex w-full items-start gap-3 text-left">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${selected ? 'border-cyber-neon-cyan bg-cyber-neon-cyan text-cyber-bg-primary' : 'border-cyber-border-default'}`}>{selected ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-cyber-text-primary">{task.goal}</span><span className="mt-1 block text-[10px] text-cyber-text-muted">{task.content_count} 条内容 · {task.platforms.map((platform) => PLATFORM_LABELS[platform] || platform).join('、')}</span></span>
                </button>
                {selected ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-cyber-border-subtle pt-3">
                  <button type="button" onClick={() => setReferencePlatforms(task, [])} className={`rounded-md border px-2 py-1 text-[10px] ${!selected.platforms.length ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/10 text-cyber-neon-cyan' : 'border-cyber-border-default text-cyber-text-muted'}`}>全部平台</button>
                  {task.platforms.map((platform) => <button key={platform} type="button" onClick={() => setReferencePlatforms(task, [platform])} className={`rounded-md border px-2 py-1 text-[10px] ${selected.platforms.includes(platform) ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/10 text-cyber-neon-cyan' : 'border-cyber-border-default text-cyber-text-muted'}`}>{PLATFORM_LABELS[platform] || platform}</button>)}
                </div> : null}
              </div>
            })}
          </div>
          <DialogFooter><Button onClick={() => setTaskPickerOpen(false)}>完成{taskReferences.length ? `（已选 ${taskReferences.length}）` : ''}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(previewImageUrl)} onOpenChange={(open) => { if (!open) setPreviewImageUrl(null) }}>
        <DialogContent className="max-w-4xl border-cyber-border-default bg-cyber-bg-panel p-2 sm:rounded-2xl">
          <div className="relative flex items-center justify-center overflow-hidden rounded-xl bg-black/60 p-2">
            <img src={previewImageUrl || ''} alt="图片预览" className="max-h-[80vh] max-w-full rounded-lg object-contain shadow-2xl" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
