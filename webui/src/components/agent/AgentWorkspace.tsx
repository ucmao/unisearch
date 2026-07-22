import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, Bot, CheckCircle2, ChevronRight, Clock3, Database, Download, Eye, EyeOff, FileText, KeyRound,
  Image, Loader2, MessageSquarePlus, Paperclip, Play, Plus, Search, Send,
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

const PLATFORM_LABELS: Record<string, string> = {
  xhs: '小红书', dy: '抖音', ks: '快手', bili: '哔哩哔哩', wb: '微博', tieba: '百度贴吧', zhihu: '知乎',
}

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
      className={`inline-flex items-center justify-center gap-2 rounded-md border border-cyber-border-default text-xs font-medium transition-colors hover:border-cyber-neon-cyan/60 hover:bg-cyber-neon-cyan/10 hover:text-cyber-neon-cyan ${compact ? 'h-9 min-w-0 px-3' : 'mt-3 h-10 px-4'}`}
    >
      <Download className="h-4 w-4" />下载 CSV
    </a>
  )
}

const DEPTH_LABELS: Record<string, string> = {
  quick: '⚡ 快速 (3页/无评论)',
  standard: '⚖️ 标准 (5页/含一级评论)',
  deep: '🔬 深度 (10页/含回复评论)',
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
              <div className="flex gap-2"><Input value={keywordInput} maxLength={40} className="h-8 text-xs" placeholder="添加关键词" onChange={(event) => setKeywordInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addKeyword() } }} /><Button size="sm" variant="outline" className="h-8" onClick={addKeyword} disabled={!keywordInput.trim() || keywordsDraft.length >= 12}><Plus /></Button></div>
              <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" className="h-7" onClick={() => { setKeywordsDraft(plan.plan.keywords); setEditingKeywords(false) }}>取消</Button><Button size="sm" className="h-7" disabled={!keywordsDraft.length || updatingPlan} onClick={() => { onUpdateKeywords(keywordsDraft); setEditingKeywords(false) }}>{updatingPlan ? <Loader2 className="animate-spin" /> : null}保存</Button></div>
            </div> : null}
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[72px_1fr]">
          <span className="text-cyber-text-muted">采集深度</span>
          <div className="flex flex-wrap gap-1.5">{(['quick', 'standard', 'deep'] as const).map((item) => <button key={item} type="button" disabled={updatingPlan} onClick={() => onUpdateDepth(item)} className={`rounded-md border px-2 py-1 text-[10px] transition-colors ${depth === item ? 'border-cyber-neon-cyan/80 bg-cyber-neon-cyan/15 font-medium text-cyber-neon-cyan' : 'border-cyber-border-subtle text-cyber-text-muted hover:border-cyber-border-default hover:text-cyber-text-primary'}`}>{DEPTH_LABELS[item]}</button>)}</div>
        </div>
        {plan.plan.analysisSource !== 'fallback' && plan.plan.analysis.length ? <div className="grid gap-2 sm:grid-cols-[72px_1fr]"><span className="text-cyber-text-muted">分析方向</span><p className="leading-5 text-cyber-text-secondary">{plan.plan.analysis.join('、')} <span className="text-[10px] text-cyber-text-muted">（根据对话提炼，不影响采集执行）</span></p></div> : null}
        <p className="border-t border-cyber-border-subtle pt-2 text-[10px] text-cyber-text-muted">需要更换平台或补充条件，可以直接在对话中告诉我。</p>
      </div>
      <div className="flex justify-end border-t border-cyber-border-subtle bg-cyber-bg-tertiary/20 px-4 py-3">
        <Button size="sm" onClick={onExecute} disabled={executing}><Play />确认并开始</Button>
      </div>
    </div>
  )
}

function MessageBubble({ message, plan, showPlanCard, onExecute, executing, onUpdateKeywords, onUpdateDepth, updatingPlan }: {
  message: AgentMessage; plan: AgentPlan | null; onExecute: () => void; executing: boolean
  showPlanCard: boolean
  onUpdateKeywords: (keywords: string[]) => void
  onUpdateDepth: (depth: 'quick' | 'standard' | 'deep') => void
  updatingPlan: boolean
}) {
  const isUser = message.role === 'user'
  return (
    <div className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10"><Bot className="h-4 w-4 text-cyber-neon-cyan" /></div>}
      <div className={`max-w-[780px] ${isUser ? 'rounded-2xl rounded-tr-sm bg-cyber-neon-cyan/12 px-4 py-3' : 'min-w-0 flex-1'}`}>
        {isUser && (message.metadata?.attachments?.length || message.metadata?.task_references?.length) ? <div className="mb-2 flex flex-wrap justify-end gap-1.5">
          {(message.metadata.attachments || []).map((attachment: AgentAttachment) => <span key={attachment.attachment_id} className="inline-flex max-w-52 items-center gap-1 rounded-md border border-cyber-border-default bg-cyber-bg-panel/60 px-2 py-1 text-[10px] text-cyber-text-secondary"><Paperclip className="h-3 w-3 shrink-0" /><span className="truncate">{attachment.file_name}</span></span>)}
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
        <p className={`mt-1.5 text-[9px] text-cyber-text-muted ${isUser ? 'text-right' : ''}`}>{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.created_at))}</p>
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const [attachments, setAttachments] = useState<AgentAttachment[]>([])
  const [taskReferences, setTaskReferences] = useState<Array<{ plan_id: string; goal: string; platforms: string[] }>>([])
  const [threadsCollapsed, setThreadsCollapsed] = useState(() => localStorage.getItem('unisearch-threads-collapsed') === 'true')

  const browserWindowQuery = useQuery({
    queryKey: ['browser-window-status'],
    queryFn: async () => (await browserApi.getWindowStatus()).data,
    refetchInterval: 3000,
  })

  const toggleBrowserWindow = useMutation({
    mutationFn: async () => (await browserApi.toggleWindow('toggle')).data,
    onSuccess: (data) => {
      client.setQueryData(['browser-window-status'], data)
      toast.success(data.visible ? '已打开内置采集浏览器窗口' : '已隐藏内置采集浏览器窗口')
    },
    onError: (error) => toast.error(getError(error)),
  })
  const [threadSearchOpen, setThreadSearchOpen] = useState(false)
  const [threadSearchQuery, setThreadSearchQuery] = useState('')
  const [renamingThread, setRenamingThread] = useState<AgentThreadSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [threadSelectionMode, setThreadSelectionMode] = useState(false)
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set())
  const [deleteAnalyticsData, setDeleteAnalyticsData] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(() => localStorage.getItem('unisearch-right-sidebar-open') !== 'false')
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
  const openModelSettings = () => {
    setSettingsSection('models')
    setSettingsOpen(true)
  }
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
  const threadsQuery = useQuery({ queryKey: ['agent-threads'], queryFn: async () => (await agentApi.listThreads()).data.items, refetchInterval: 3000 })
  const threadQuery = useQuery({ queryKey: ['agent-thread', selectedId], queryFn: async () => (await agentApi.getThread(selectedId!)).data, enabled: Boolean(selectedId), refetchInterval: send.isPending ? false : 1500 })
  const modelProfileQuery = useQuery({ queryKey: ['agent-model-profile'], queryFn: async () => (await agentApi.getModelProfile()).data })
  const referenceableTasksQuery = useQuery({ queryKey: ['agent-referenceable-tasks'], queryFn: async () => (await agentApi.listReferenceableTasks()).data.items, enabled: taskPickerOpen })

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!selectedId) throw new Error('请先选择任务')
      if (file.size > 8 * 1024 * 1024) throw new Error('单个文件不能超过 8MB')
      const dataBase64 = await fileToBase64(file)
      return (await agentApi.uploadAttachment(selectedId, { fileName: file.name, mimeType: file.type || 'application/octet-stream', dataBase64 })).data
    },
    onSuccess: (attachment) => setAttachments((current) => [...current, attachment].slice(0, 5)),
    onError: (error) => toast.error(getError(error)),
  })

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
  const removeMany = useMutation({
    mutationFn: ({ ids, withData }: { ids: string[]; withData: boolean }) => agentApi.deleteThreads(ids, withData),
    onSuccess: (_response, { ids, withData }) => {
      const removed = new Set(ids)
      client.setQueryData<AgentThreadSummary[]>(['agent-threads'], (current) => current?.filter((thread) => !removed.has(thread.thread_id)))
      for (const id of ids) client.removeQueries({ queryKey: ['agent-thread', id], exact: true })
      setSelectedId((current) => current && removed.has(current) ? null : current)
      setSelectedThreadIds(new Set())
      setDeleteAnalyticsData(false)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      toast.success(`${ids.length} 个任务已删除${withData ? '，对应看板数据已同步清理' : '，看板数据已保留'}`)
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
  }, [selectedId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [threadQuery.data?.messages.length, send.isPending])
  useEffect(() => () => {
    if (petReactionTimerRef.current !== null) window.clearTimeout(petReactionTimerRef.current)
    if (petReactionFrameRef.current !== null) window.cancelAnimationFrame(petReactionFrameRef.current)
  }, [])

  const submit = () => {
    const content = input.trim()
    if (!content || send.isPending || create.isPending) return
    if (!modelProfileQuery.data?.apiKeyConfigured || !modelProfileQuery.data.connectionVerified || modelProfileQuery.data.lastError) {
      openModelSettings()
      toast.error(modelProfileQuery.data?.lastError
        ? 'AI 模型连接不可用，请先测试连接'
        : modelProfileQuery.data?.apiKeyConfigured
          ? 'AI 模型尚未验证，请先测试连接'
          : '请先配置 AI 模型 API Key')
      return
    }
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
  const selectableThreads = filteredThreads.filter((thread) => !['queued', 'running'].includes(thread.plan_status || ''))
  const toggleSelectedThread = (threadId: string) => setSelectedThreadIds((current) => {
    const next = new Set(current)
    if (next.has(threadId)) next.delete(threadId)
    else next.add(threadId)
    return next
  })
  const terminalPlatforms = useMemo(() => Array.from(new Set(activePlan?.steps.map((step) => step.platform) || [])), [activePlan])
  const modelReady = Boolean(modelProfileQuery.data?.apiKeyConfigured && modelProfileQuery.data.connectionVerified && !modelProfileQuery.data.lastError)
  const modelUnavailableText = modelProfileQuery.data?.lastError
    ? `AI 模型连接不可用：${modelProfileQuery.data.lastError}`
    : modelProfileQuery.data?.apiKeyConfigured
      ? 'AI 模型尚未通过连接测试，无法进行思考和对话'
      : '尚未配置 AI 模型 API，无法进行思考和对话'
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
            <div className="flex items-center gap-1"><button
              type="button"
              onClick={() => { setThreadSelectionMode((current) => !current); setSelectedThreadIds(new Set()); setDeleteAnalyticsData(false) }}
              className={`flex h-7 items-center justify-center rounded-md px-2 text-[10px] transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary ${threadSelectionMode ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted'}`}
              title={threadSelectionMode ? '退出批量管理' : '批量管理任务'}
            >{threadSelectionMode ? '完成' : '批量'}</button><button
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
            </button></div>
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
          {threadSelectionMode ? <div className="flex items-center gap-2 px-2 pb-2">
            <Button variant="ghost" size="sm" className="h-8 flex-1 text-xs" onClick={() => setSelectedThreadIds((current) => current.size === selectableThreads.length ? new Set() : new Set(selectableThreads.map((thread) => thread.thread_id)))}>
              {selectedThreadIds.size === selectableThreads.length && selectableThreads.length ? '取消全选' : '全选可删除任务'}
            </Button>
            <DeleteConfirmDialog
              trigger={<Button variant="destructive" size="sm" className="h-8 text-xs" disabled={!selectedThreadIds.size || removeMany.isPending}>删除 {selectedThreadIds.size || ''}</Button>}
              title={`删除 ${selectedThreadIds.size} 个任务？`}
              description="将删除所选任务的对话、计划和附件。正在采集或排队中的任务不会被选择。"
              confirmLabel="批量删除"
              onConfirm={() => removeMany.mutateAsync({ ids: [...selectedThreadIds], withData: deleteAnalyticsData })}
            >
              <label className="flex items-start gap-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/60 p-3 text-left text-xs">
                <Checkbox checked={deleteAnalyticsData} onCheckedChange={setDeleteAnalyticsData} />
                <span><span className="block font-medium text-cyber-text-primary">同时清理对应看板数据</span><span className="mt-1 block text-cyber-text-muted">删除执行记录、分析数据和日志；平台原始采集数据仍然保留。</span></span>
              </label>
            </DeleteConfirmDialog>
          </div> : null}
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
            {filteredThreads.map((thread) => (
              <div key={thread.thread_id} className="group relative">
                <button type="button" onClick={() => threadSelectionMode ? (!['queued', 'running'].includes(thread.plan_status || '') && toggleSelectedThread(thread.thread_id)) : setSelectedId(thread.thread_id)}
                  className={`w-full rounded-lg px-3 py-2.5 pr-9 text-left transition-colors ${threadSelectionMode ? 'pl-9' : ''} ${selectedId === thread.thread_id ? 'bg-cyber-neon-cyan/10 text-cyber-text-primary' : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary/60'}`}>
                  <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs font-medium">{thread.title}</span>{thread.plan_status === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyber-neon-green" />}</div>
                  <p className="mt-1 truncate text-[10px] text-cyber-text-muted">{thread.last_message || '暂无消息'}</p>
                  <p className="mt-1 text-[9px] text-cyber-text-muted">{timeAgo(thread.updated_at)}</p>
                </button>
                {threadSelectionMode ? <span className="absolute left-2 top-3" onClick={(event) => event.stopPropagation()}><Checkbox checked={selectedThreadIds.has(thread.thread_id)} disabled={['queued', 'running'].includes(thread.plan_status || '')} onCheckedChange={() => toggleSelectedThread(thread.thread_id)} aria-label={`选择任务 ${thread.title}`} /></span> : <button
                  type="button"
                  onClick={() => { setRenamingThread(thread); setRenameTitle(thread.title) }}
                  className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-md text-cyber-text-muted opacity-0 transition-opacity hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary focus:opacity-100 group-hover:opacity-100"
                  aria-label={`重命名 ${thread.title}`}
                  title="重命名任务"
                >
                  <SquarePen className="h-3.5 w-3.5" />
                </button>}
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
            {isCollecting && <Button
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
            {selectedId && <DeleteConfirmDialog
              trigger={<Button size="icon" variant="ghost" className="h-9 w-9 hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink" disabled={remove.isPending || send.isPending} title="删除任务" aria-label="删除任务"><Trash2 /></Button>}
              title="删除这个任务？"
              description="将删除这个任务及其全部对话、计划和附件，此操作无法撤销。"
              confirmLabel="删除任务"
              onConfirm={() => remove.mutateAsync({ id: selectedId, withData: deleteAnalyticsData })}
            >
              <label className="flex items-start gap-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/60 p-3 text-left text-xs">
                <Checkbox checked={deleteAnalyticsData} onCheckedChange={setDeleteAnalyticsData} />
                <span><span className="block font-medium text-cyber-text-primary">同时清理对应看板数据</span><span className="mt-1 block text-cyber-text-muted">不勾选时，看板采集结果会继续保留。</span></span>
              </label>
            </DeleteConfirmDialog>}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col bg-cyber-bg-primary/40">
            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedId ? <div className="mx-auto max-w-4xl space-y-7 px-4 py-8 sm:px-8">
                {threadQuery.isLoading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-cyber-neon-cyan" /></div> : null}
                {threadQuery.data?.messages.map((message) => <MessageBubble key={message.message_id} message={message} plan={activePlan} showPlanCard={message.message_id === latestPlanMessageId} executing={execute.isPending} onExecute={() => activePlan && execute.mutate(activePlan.plan_id)} onUpdateKeywords={(keywords) => activePlan && updatePlan.mutate({ planId: activePlan.plan_id, updates: { keywords } })} onUpdateDepth={(collectionDepth) => activePlan && updatePlan.mutate({ planId: activePlan.plan_id, updates: { collectionDepth } })} updatingPlan={updatePlan.isPending} />)}
                {isThinking && <div className="flex items-center gap-3 text-xs text-cyber-text-muted"><div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10"><Bot className="h-4 w-4 text-cyber-neon-cyan" /></div><Loader2 className="h-4 w-4 animate-spin" />AI 正在思考…</div>}
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
            {modelProfileQuery.isLoading ? <div className="flex min-h-[88px] items-center justify-center rounded-xl border border-cyber-border-default bg-cyber-bg-panel text-xs text-cyber-text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在检查 AI 模型配置…</div> : modelReady ? <>
              <div className="agent-composer relative rounded-2xl border border-cyber-border-default bg-cyber-bg-panel focus-within:border-cyber-neon-cyan/50">
                {attachments.length || taskReferences.length ? <div className="flex flex-wrap gap-2 px-3 pt-3">
                  {attachments.map((attachment) => <span key={attachment.attachment_id} className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-cyber-border-default bg-cyber-bg-secondary px-2.5 py-1.5 text-[11px] text-cyber-text-secondary">
                    {attachment.kind === 'image' ? <Image className="h-3.5 w-3.5 shrink-0" /> : attachment.kind === 'spreadsheet' ? <Table2 className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate">{attachment.file_name}</span>
                    <button type="button" onClick={() => removeAttachment(attachment)} aria-label={`移除 ${attachment.file_name}`} className="rounded p-0.5 hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"><X className="h-3 w-3" /></button>
                  </span>)}
                  {taskReferences.map((reference) => <span key={reference.plan_id} className="inline-flex max-w-60 items-center gap-1.5 rounded-lg border border-cyber-neon-green/30 bg-cyber-neon-green/5 px-2.5 py-1.5 text-[11px] text-cyber-text-secondary">
                    <Database className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{reference.goal}{reference.platforms.length ? ` · ${reference.platforms.map((platform) => PLATFORM_LABELS[platform] || platform).join('/')}` : ''}</span>
                    <button type="button" onClick={() => setTaskReferences((current) => current.filter((item) => item.plan_id !== reference.plan_id))} aria-label={`移除 ${reference.goal}`} className="rounded p-0.5 hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"><X className="h-3 w-3" /></button>
                  </span>)}
                </div> : null}
                <textarea ref={composerInputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
                  placeholder={!selectedId ? '输入问题，或描述想调研的主题…' : activePlan?.status === 'awaiting_confirmation' ? '自然地告诉我是否开始，或继续修改平台、关键词和采集范围…' : activePlan && ['completed', 'partially_completed'].includes(activePlan.status) ? '继续提问，例如：分析负面评价的主要原因…' : '可以先聊聊，也可以描述想调研的主题…'}
                  className="min-h-[76px] w-full resize-none bg-transparent px-4 py-3 pb-12 pr-14 text-sm outline-none placeholder:text-cyber-text-muted" />
                <div className="absolute bottom-3 left-3">
                  <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => setAddMenuOpen((open) => !open)} disabled={upload.isPending || send.isPending} title="添加内容">
                    {upload.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                  </Button>
                  {addMenuOpen ? <div className="absolute bottom-11 left-0 z-30 w-56 overflow-hidden rounded-xl border border-cyber-border-default bg-cyber-bg-panel p-1.5 shadow-xl">
                    <button type="button" disabled={!selectedId} onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent">
                      <Paperclip className="h-4 w-4" /><span><span className="block font-medium">上传文件</span><span className="mt-0.5 block text-[10px] text-cyber-text-muted">{selectedId ? '图片、文本、CSV、XLSX' : '进入任务后即可上传'}</span></span>
                    </button>
                    <button type="button" onClick={() => { setAddMenuOpen(false); setTaskPickerOpen(true) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary">
                      <Database className="h-4 w-4" /><span><span className="block font-medium">引用采集结果</span><span className="mt-0.5 block text-[10px] text-cyber-text-muted">选择已有任务或平台</span></span>
                    </button>
                  </div> : null}
                  <input ref={fileInputRef} type="file" className="hidden" multiple accept="image/png,image/jpeg,image/webp,image/gif,.txt,.md,.markdown,.csv,.json,.log,.tsv,.xlsx" onChange={(event) => {
                    const files = Array.from(event.target.files || []).slice(0, Math.max(0, 5 - attachments.length))
                    files.reduce((promise, file) => promise.then(() => upload.mutateAsync(file).then(() => undefined)), Promise.resolve()).catch(() => undefined)
                    event.target.value = ''
                  }} />
                </div>
                <Button size="icon" className="absolute bottom-3 right-3 h-9 w-9" onClick={submit} disabled={!input.trim() || send.isPending || create.isPending}>{create.isPending ? <Loader2 className="animate-spin" /> : <Send />}</Button>
              </div>
            </> : <div className="flex min-h-[88px] items-center justify-between gap-4 rounded-xl border border-cyber-neon-pink/25 bg-cyber-neon-pink/5 px-4 py-3">
              <div><p className="text-sm text-cyber-text-primary">{modelUnavailableText}</p><p className="mt-1 text-[10px] text-cyber-text-muted">配置并成功测试连接后，才能开始 AI 对话、生成计划和分析结果。</p></div>
              <Button variant="outline" className="shrink-0" onClick={openModelSettings}><KeyRound />配置模型</Button>
            </div>}
          </div>
            </div>
          </main>

          {rightSidebarOpen && selectedId && <aside className="relative shrink-0 overflow-y-auto border-l border-cyber-border-subtle bg-cyber-bg-secondary/30 p-4" style={{ width: rightSidebarWidth }}>
        <div
          className={`absolute -left-[3px] top-0 z-20 h-full w-1.5 touch-none cursor-col-resize transition-colors hover:bg-cyber-neon-cyan/25 ${activeResize === 'right' ? 'bg-cyber-neon-cyan/35' : ''}`}
          onPointerDown={(event) => beginResize(event, 'right', (moveEvent) => {
            const bounds = workspaceRef.current?.getBoundingClientRect()
            if (bounds) updateRightSidebarWidth(bounds.right - moveEvent.clientX)
          })}
          aria-label="调整右侧边栏宽度"
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyber-text-muted">当前任务大盘</p>
          {activePlan ? <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[activePlan.status] || activePlan.status}</Badge> : null}
        </div>

        {activePlan ? (() => {
          const allPlans = threadQuery.data?.plans || [activePlan]
          const currentRound = allPlans.find((plan) => plan.plan_id === activePlan.plan_id)?.round_number || allPlans.length
          const previousPlans = allPlans.filter((plan) => plan.plan_id !== activePlan.plan_id).slice().reverse()
          const totalItems = activePlan.stats?.content_count ?? activePlan.steps.reduce((acc, s) => acc + (s.item_count || 0), 0)
          const isPending = activePlan.status === 'awaiting_confirmation'
          const isRunning = ['queued', 'running'].includes(activePlan.status)
          const isFinished = ['completed', 'partially_completed'].includes(activePlan.status)
          const canRetry = ['failed', 'partially_completed'].includes(activePlan.status)
          const keywordsStr = activePlan.plan.keywords.join(' / ')
          const depth = activePlan.plan.collectionDepth || (activePlan.plan.collectSubComments ? 'deep' : activePlan.plan.collectComments ? 'standard' : 'quick')
          const rangeText = depth === 'deep' ? '深度 · 100 条/词 · 含回复评论' : depth === 'standard' ? '标准 · 50 条/词 · 含一级评论' : '快速 · 30 条/词 · 不含评论'

          const handleApplyPrompt = (promptText: string) => {
            setInput(promptText)
            setTimeout(() => composerInputRef.current?.focus(), 50)
          }

          const handleOpenResults = () => {
            if (selectedId && totalItems > 0) onOpenResults({ threadId: selectedId, planId: activePlan.plan_id })
          }

          return (
            <div className="mt-4 space-y-5 text-xs">
              {/* 总数据汇总卡片 */}
              <button
                type="button"
                onClick={handleOpenResults}
                disabled={totalItems <= 0}
                aria-label={totalItems > 0 ? `查看第 ${currentRound} 轮的 ${totalItems} 条采集结果` : undefined}
                className={`w-full rounded-xl border border-cyber-border-default bg-cyber-bg-panel/70 p-3.5 text-left shadow-sm transition-colors ${totalItems > 0 ? 'cursor-pointer hover:border-cyber-neon-cyan/50 hover:bg-cyber-bg-panel focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyber-neon-cyan/70' : 'cursor-default'}`}
              >
                <div className="flex items-center justify-between text-[10px] text-cyber-text-muted">
                  <span>第 {currentRound} 轮 · {isPending ? '待确认采集范围' : isRunning ? '当前已采集' : '已采集数据总量'}</span>
                  <span className="flex items-center gap-0.5 font-mono">
                    {activePlan.steps.length} 平台 · {activePlan.plan.keywords.length} 词
                    {totalItems > 0 ? <ChevronRight className="h-3 w-3" /> : null}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className={`text-2xl font-bold tracking-tight text-cyber-neon-cyan ${isRunning ? 'animate-pulse' : ''}`}>
                    {totalItems.toLocaleString()}
                  </span>
                  <span className="text-xs text-cyber-text-secondary">{isPending ? '条（尚未开始）' : '条内容'}</span>
                </div>
                {keywordsStr ? (
                  <p className="mt-2 truncate text-[10px] text-cyber-text-muted" title={keywordsStr}>
                    关键词：{keywordsStr}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] text-cyber-text-muted">范围：{rangeText}</p>
              </button>

              {/* 分平台采集明细与占比 */}
              <div>
                <div className="flex items-center justify-between text-[10px] text-cyber-text-muted">
                  <span>数据分布与状态</span>
                  {totalItems > 0 ? <span>占比</span> : null}
                </div>
                <div className="mt-1 divide-y divide-cyber-border-subtle/60">
                  {activePlan.steps.map((step) => {
                    const count = step.item_count || 0
                    const percent = totalItems > 0 ? Math.round((count / totalItems) * 100) : 0
                    const isZeroSuccess = step.status === 'completed' && count === 0

                    return (
                      <div key={step.step_id} className="py-2.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="truncate font-medium text-cyber-text-primary">
                              {PLATFORM_LABELS[step.platform] || step.platform}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`font-mono text-xs ${isZeroSuccess ? 'text-amber-400 font-normal text-[11px]' : 'text-cyber-text-primary'}`}>
                              {count > 0 ? `${count} 条` : step.status === 'completed' ? '0 条' : ''}
                            </span>
                            {isZeroSuccess ? (
                              <span title="该平台未采集到数据或可能被风控受限">
                                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                              </span>
                            ) : (
                              <StepIcon status={step.status} />
                            )}
                          </div>
                        </div>
                        {step.status === 'completed' && totalItems > 0 && count > 0 ? (
                          <div className="mt-2 flex items-center gap-2">
                            <div className="h-1 flex-1 overflow-hidden rounded-full bg-cyber-bg-tertiary">
                              <div className="h-full rounded-full bg-cyber-neon-cyan/70 transition-all duration-300" style={{ width: `${percent}%` }} />
                            </div>
                            <span className="w-7 text-right font-mono text-[9px] text-cyber-text-muted">{percent}%</span>
                          </div>
                        ) : null}
                        {step.error_message ? <p className="mt-2 line-clamp-2 text-[10px] leading-4 text-cyber-neon-pink" title={step.error_message}>{step.error_message}</p> : null}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 动作区 */}
              <div className="space-y-2 border-t border-cyber-border-subtle pt-3">
                {isPending ? <Button className="w-full h-9 text-xs" onClick={() => execute.mutate(activePlan.plan_id)} disabled={execute.isPending}><Play />确认并开始</Button> : null}
                {totalItems > 0 || activePlan.steps.some((step) => step.run_id) ? (
                  <div className="grid grid-cols-2 gap-2">
                    {totalItems > 0 ? <Button variant="outline" className="h-9 min-w-0 gap-1.5 px-2 text-xs" onClick={handleOpenResults}>
                      <Database className="h-3.5 w-3.5 shrink-0 text-cyber-neon-cyan" />
                      <span className="truncate">结果看板</span>
                    </Button> : <span />}
                    {activePlan.steps.some((step) => step.run_id) ? <CsvDownloadLink planId={activePlan.plan_id} compact /> : null}
                  </div>
                ) : null}
                {canRetry ? <Button className="w-full h-9 text-xs" onClick={() => execute.mutate(activePlan.plan_id)} disabled={execute.isPending}><Play />重试失败平台</Button> : null}
              </div>

              {previousPlans.length ? <div className="border-t border-cyber-border-subtle pt-3">
                <div className="flex items-center justify-between text-[10px] text-cyber-text-muted"><span>历史采集轮次</span><span>{previousPlans.length} 轮</span></div>
                <div className="mt-2 space-y-1.5">
                  {previousPlans.map((plan) => {
                    const count = plan.stats?.content_count ?? plan.steps.reduce((total, step) => total + (step.item_count || 0), 0)
                    return <div key={plan.plan_id} className="rounded-lg border border-cyber-border-subtle/60 bg-cyber-bg-panel/30 px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-medium text-cyber-text-primary">第 {plan.round_number || 1} 轮</span>
                        <span className="text-[9px] text-cyber-text-muted">{STATUS_LABELS[plan.status] || plan.status} · {count} 条</span>
                      </div>
                      <p className="mt-1 truncate text-[10px] text-cyber-text-muted" title={plan.plan.keywords.join(' / ')}>{plan.plan.keywords.join(' / ')}</p>
                    </div>
                  })}
                </div>
              </div> : null}

              {/* AI 快捷提问建议：保持提示词能力，但避免重复的长文案卡片割裂侧栏。 */}
              {isFinished ? (
                <div className="pt-2 border-t border-cyber-border-subtle">
                  <div className="flex items-center gap-1.5 text-[10px] font-medium text-cyber-text-muted mb-2">
                    <Sparkles className="h-3 w-3 text-cyber-neon-cyan" />
                    <span>继续分析</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1.5">
                    {[
                      { label: '跨平台对比', prompt: `分析 ${activePlan.plan.keywords[0] || '关键词'} 各平台的热度与讨论差异` },
                      { label: '用户诉求', prompt: '总结抓取数据中用户的主要诉求和评价' },
                      { label: '热点话题', prompt: '提取数据中频繁出现的高频词与热门话题' },
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
        })() : <div className="mt-8 text-center"><FileText className="mx-auto h-8 w-8 text-cyber-text-muted" /><p className="mt-3 text-xs text-cyber-text-muted">发送需求后，这里会显示任务范围和执行状态。</p></div>}
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
              if (event.key === 'Enter' && renamingThread && renameTitle.trim() && !rename.isPending) {
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
    </div>
  )
}
