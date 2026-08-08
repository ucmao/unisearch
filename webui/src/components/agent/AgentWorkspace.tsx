import { useCallback, useEffect, memo, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowRight, Bot, Check, CheckCircle2, ChevronRight, Clock3, Copy, Database, Download, FileSpreadsheet, FileText, Globe,
  Loader2, MessageSquare, MessageSquarePlus, MoreHorizontal, Paperclip, Pin, PinOff, Play, Plus, RotateCw, Search,
  Sparkles, Square, SquarePen, Trash2, User, X, XCircle, PanelBottom, PanelLeftClose, PanelLeftOpen, PanelRight,
} from 'lucide-react'
import { agentApi, browserApi, dataApi, type AgentAttachment, type AgentMessage, type AgentPlan, type AgentTaskReference, type AgentThread, type AgentThreadSummary, type AnalysisCoverage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MarkdownContent } from './MarkdownContent'
import { SourceDrawer, type SourceCitation } from './SourceDrawer'
import { CollapsibleSourcesBar } from './CollapsibleSourcesBar'
import { Terminal } from '@/components/console/Terminal'
import { SettingsDialog, type SettingsSection } from '@/components/layout/SettingsDialog'
import { DeleteConfirmDialog } from '@/components/data/DeleteConfirmDialog'
import { PlatformExportIcons, type PlatformConfig } from './PlatformExportIcons'
import { useLogWebSocket } from '@/hooks/useWebSocket'
import { useCrawlerStore } from '@/store/crawlerStore'
import { CommandPopover } from './CommandPopover'
import { useMentionCommands, extractMentionedSkillIds } from '@/hooks/useMentionCommands'
import { usePlatformLabels, useSkillMentionEntities } from '@/hooks/usePlatformCatalog'
import { cn } from '@/lib/utils'
import { resolveComposerMode } from '@/lib/agentTaskState'
import { selectPlanPreviews } from '@/lib/livePreviewScope'

const AI_PLATFORMS = new Set([
  'deepseek', 'doubao', 'kimi', 'nami', 'qwen', 'wenxin', 'yuanbao',
])

const STATUS_LABELS: Record<string, string> = {
  awaiting_confirmation: '等待确认', queued: '排队中', running: '采集中', completed: '已完成',
  partially_completed: '部分完成', failed: '失败', stopped: '已停止',
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string; dot: string }> = {
  running: { label: '采集中', bg: 'bg-sky-500/10', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/20', dot: 'bg-sky-500 animate-pulse' },
  analyzing: { label: '分析中', bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-500 animate-pulse' },
  completed: { label: '已完成', bg: 'bg-emerald-500/10', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/20', dot: 'bg-emerald-500' },
  partially_completed: { label: '部分完成', bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/20', dot: 'bg-amber-500' },
  failed: { label: '失败', bg: 'bg-rose-500/10', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/20', dot: 'bg-rose-500' },
  stopped: { label: '已停止', bg: 'bg-slate-500/10', text: 'text-slate-500 dark:text-slate-400', border: 'border-slate-500/20', dot: 'bg-slate-400' },
  awaiting_confirmation: { label: '等待确认', bg: 'bg-purple-500/10', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/20', dot: 'bg-purple-500 animate-pulse' },
  queued: { label: '排队中', bg: 'bg-slate-500/10', text: 'text-slate-500 dark:text-slate-400', border: 'border-slate-500/20', dot: 'bg-slate-400 animate-pulse' },
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
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d`
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatElapsed(milliseconds: number) {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

function PlanElapsedTime({ plan, className = '' }: { plan: AgentPlan; className?: string }) {
  const [now, setNow] = useState(() => Date.now())
  const isActive = ['queued', 'running'].includes(plan.status)

  useEffect(() => {
    if (!isActive) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [isActive, plan.plan_id])

  const baseTime = plan.created_at || plan.started_at || plan.updated_at
  const startedAt = new Date(baseTime).getTime()
  const endTime = isActive ? now : (plan.finished_at ? new Date(plan.finished_at).getTime() : (plan.updated_at ? new Date(plan.updated_at).getTime() : now))
  const elapsed = Number.isFinite(startedAt) && Number.isFinite(endTime) ? formatElapsed(Math.max(0, endTime - startedAt)) : '0s'

  return <span className={`whitespace-nowrap font-mono tabular-nums ${className}`}>{elapsed}</span>
}

type AiProgressStatus = { phase: 'web_search' | 'reasoning'; message: string }

function ThinkingIndicator({ retryState, progress }: {
  retryState: { count: number; max: number; delaySec: number } | null
  progress: AiProgressStatus | null
}) {
  const [startedAt] = useState(() => Date.now())
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  useEffect(() => {
    const updateElapsed = () => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000))
    updateElapsed()
    const timer = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const isWebSearching = progress?.phase === 'web_search'

  // 下方弱提示：只在联网搜索、网络重试或有特定进度消息时展示
  const subStatusText = retryState
    ? `连接不稳定，正在自动重试 ${retryState.count}/${retryState.max}（${retryState.delaySec}s 后继续）`
    : progress?.message
      ? progress.message
      : isWebSearching
        ? '正在联网检索最新网页与参考资料…'
        : null

  return (
    <div className="flex gap-3 text-xs text-cyber-text-muted" role="status" aria-live="polite">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10">
        <Bot className="h-3.5 w-3.5 text-cyber-neon-cyan animate-pulse" />
      </div>
      <div className="flex flex-col justify-center gap-0.5 leading-5">
        {/* 第一行：只有三个点不停跳动，保持绝对纯粹 */}
        <div className="flex items-center gap-1.5 h-5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-cyber-neon-cyan animate-typing-dot animate-typing-dot-1" />
          <span className="h-1.5 w-1.5 rounded-full bg-cyber-neon-cyan animate-typing-dot animate-typing-dot-2" />
          <span className="h-1.5 w-1.5 rounded-full bg-cyber-neon-cyan animate-typing-dot animate-typing-dot-3" />
        </div>

        {/* 第二行（弱提示 + 读秒）：只在有联网/重试状态或超时>10s时展开展示 */}
        {(subStatusText || elapsedSeconds >= 10) && (
          <p className="truncate text-[11px] text-cyber-text-muted/65 transition-all duration-300 flex items-center gap-1.5 animate-fade-in">
            {isWebSearching && (
              <Globe className="h-3 w-3 text-cyber-neon-cyan/70 animate-spin shrink-0" style={{ animationDuration: '6s' }} />
            )}
            {subStatusText && <span>{subStatusText}</span>}
            {elapsedSeconds >= 10 && (
              <span className="font-mono tabular-nums opacity-80">
                ({elapsedSeconds}s)
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  )
}

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.size < 400 * 1024 || file.type === 'image/gif') {
    return file
  }
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const maxDim = 2048
      let { width, height } = img
      if (width <= maxDim && height <= maxDim && file.size < 1024 * 1024) {
        resolve(file)
        return
      }
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width)
          width = maxDim
        } else {
          width = Math.round((width * maxDim) / height)
          height = maxDim
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(file)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      canvas.toBlob(
        (blob) => {
          if (!blob || blob.size >= file.size) {
            resolve(file)
            return
          }
          const newFile = new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() })
          resolve(newFile)
        },
        'image/jpeg',
        0.8
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(file)
    }
    img.src = url
  })
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

function cleanAndFormatPlanConfig(rawConfig: string): string {
  if (!rawConfig) return ''
  const text = rawConfig.replace(/<\/?details>/gi, '').replace(/<summary>.*?<\/summary>/gi, '').trim()
  const lines = text.split(/\r?\n/)
  const statusPatterns = [
    /^已创建任务/,
    /^任务已进入/,
    /^如需调整/,
    /^已开始/,
    /^已完成/,
    /^已暂停/,
    /^已停止/,
    /^正在/,
    /^自动完成/,
  ]

  const configLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (statusPatterns.some((pattern) => pattern.test(trimmed))) continue
    configLines.push(trimmed)
  }

  if (configLines.length === 0) return ''

  return `> **采集配置信息**\n` + configLines.map((l) => `> ${l}`).join('\n')
}

function flattenDetailsInMarkdown(text: string): string {
  return text.replace(/<details>\s*<summary>(.*?)<\/summary>([\s\S]*?)<\/details>/gi, (_, summary, body) => {
    const cleanSummary = summary.replace(/›\s*$/, '').trim()
    const cleanBody = body.trim()
    if (!cleanBody) return `> **${cleanSummary}**`
    return `> **${cleanSummary}**\n` + cleanBody.split(/\r?\n/).map((l: string) => (l.trim() ? `> ${l}` : '>')).join('\n')
  })
}

function StepIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-cyber-neon-cyan" />
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-cyber-neon-green" />
  if (status === 'failed' || status === 'stopped') return <XCircle className="h-4 w-4 text-cyber-neon-pink" />
  return <Clock3 className="h-4 w-4 text-cyber-text-muted" />
}

function SpreadsheetDownloadLink({ planId, threadId, compact = false }: { planId?: string; threadId?: string; compact?: boolean }) {
  const exportUrl = dataApi.getAnalyticsExportUrl({
    ...(threadId ? { thread_id: threadId } : planId ? { workflow_id: planId } : {}),
    format: 'xlsx',
    field_mode: 'recommended',
  })

  return (
    <a
      href={exportUrl}
      download
      className={`inline-flex items-center justify-center rounded-md border border-cyber-border-default text-xs font-medium transition-colors hover:border-cyber-neon-cyan/60 hover:bg-cyber-neon-cyan/10 hover:text-cyber-neon-cyan ${compact ? 'h-9 min-w-0 gap-1.5 px-2' : 'mt-3 h-10 min-w-0 gap-2 px-4'}`}
    >
      <Download className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 text-cyber-neon-cyan`} />
      <span className="truncate">下载 Excel</span>
    </a>
  )
}

function SinglePassPacedThreeLineStream({ isRunning, planId }: { isRunning: boolean; planId: string }) {
  const liveItemPreviews = useCrawlerStore((state) => state.liveItemPreviews)
  const platformLabels = usePlatformLabels()

  const [, setQueue] = useState<any[]>([])
  const [displayed, setDisplayed] = useState<Array<{ item: any; displayTime: number }>>([])
  const processedSeqRef = useRef(0)

  // Each stream owns only its local queue. The shared preview store may contain
  // other concurrently running plans and must never be cleared globally here.
  useEffect(() => {
    if (!isRunning) {
      setQueue([])
      setDisplayed([])
      processedSeqRef.current = 0
    }
  }, [isRunning])

  // Ingest new items from liveItemPreviews that have seq > processedSeqRef.current
  useEffect(() => {
    const newItems = selectPlanPreviews(liveItemPreviews, planId, processedSeqRef.current)
    if (newItems.length > 0) {
      const maxSeq = Math.max(...newItems.map((i) => i.seq || 0))
      processedSeqRef.current = maxSeq
      setQueue((prev) => [...prev, ...newItems])
    }
  }, [liveItemPreviews, planId])

  // Dequeue 1 item every 1500ms into displayed list (max 3 items), tagging displayTime
  useEffect(() => {
    const timer = setInterval(() => {
      setQueue((prevQueue) => {
        if (prevQueue.length === 0) return prevQueue
        const [nextItem, ...remaining] = prevQueue
        const entry = { item: nextItem, displayTime: Date.now() }
        setDisplayed((prevDisp) => [...prevDisp.slice(-2), entry])
        return remaining
      })
    }, 1500)

    return () => clearInterval(timer)
  }, [])

  // Auto-expire items older than 4500ms (checked every 300ms)
  useEffect(() => {
    if (!isRunning || displayed.length === 0) return
    const timer = setInterval(() => {
      const now = Date.now()
      setDisplayed((prev) => prev.filter((d) => now - d.displayTime < 4500))
    }, 300)
    return () => clearInterval(timer)
  }, [isRunning, displayed.length])

  if (!isRunning || displayed.length === 0) return null

  return (
    <div className="ml-11 flex flex-col gap-1 max-w-xl transition-all duration-300">
      {displayed.map(({ item, displayTime }, idx) => {
        const platformName = item.source ? (platformLabels[item.source] || item.source) : ''
        const content = item.title || item.text || '解析到新数据'

        return (
          <div
            key={item.id || `${item.source}-${displayTime}-${idx}`}
            className="flex items-center gap-1.5 text-[11px] leading-tight text-cyber-text-muted/80 font-normal transition-all duration-300 animate-in fade-in slide-in-from-bottom-1"
          >
            {platformName && (
              <span className="shrink-0 select-none">
                {platformName} ·
              </span>
            )}
            <span className="truncate flex-1">
              {content}
            </span>
            {item.author && (
              <span className="shrink-0 text-[10px] opacity-75 select-none">
                @{item.author}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ChatCrawlingStatusBanner({
  activePlan,
  onStop,
  stopping,
  hasStreamingAnswer,
}: {
  activePlan: AgentPlan
  onStop: () => void
  stopping: boolean
  hasStreamingAnswer: boolean
}) {
  if (!activePlan) return null

  const isRunning = ['queued', 'running'].includes(activePlan.status)
  if (!isRunning) return null

  const connectorSteps = activePlan.steps.filter((s) => s.kind === 'connector' || (s.kind !== 'processor' && s.step_key !== 'business-analysis'))
  const totalSteps = connectorSteps.length || activePlan.steps.length
  const completedSteps = connectorSteps.length
    ? connectorSteps.filter((s) => ['completed', 'failed', 'stopped', 'skipped'].includes(s.status)).length
    : activePlan.steps.filter((s) => s.status === 'completed').length
  const contentCount = activePlan.stats?.content_count ?? 0
  const isPostProcessing = activePlan.status === 'running' && totalSteps > 0 && completedSteps === totalSteps

  // 第一段报告正文出现后，由草稿消息接管展示；在此之前保留分析状态
  // 和中止入口，避免模型首字等待期间界面没有反馈。
  if (isPostProcessing && hasStreamingAnswer) return null

  const isStreamActive = isRunning && !isPostProcessing

  return (
    <div className={`relative mt-2.5 text-xs text-cyber-text-muted transition-all duration-300 ${isStreamActive ? 'pb-14' : 'pb-0'}`}>
      <div className="flex items-center gap-2 py-1">
        <div className="inline-flex items-center gap-1.5 text-cyber-text-secondary">
          <Search className="h-3.5 w-3.5 text-cyber-neon-cyan animate-pulse" />
          <span>{isPostProcessing ? '正在分析采集结果...' : `正在采集数据，已入库 ${contentCount} 条（平台 ${completedSteps}/${totalSteps}）`}</span>
          <span className="text-cyber-border-default">·</span>
          <PlanElapsedTime plan={activePlan} className="text-cyber-text-secondary" />
        </div>
        <button
          type="button"
          onClick={onStop}
          disabled={stopping}
          className="inline-flex items-center gap-1 rounded-md border border-cyber-border-default px-1.5 py-0.5 text-[10px] text-cyber-text-muted transition-colors hover:border-cyber-neon-pink/60 hover:text-cyber-neon-pink disabled:opacity-40 shrink-0"
          title="中止本次采集"
        >
          {stopping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-2.5 w-2.5 fill-current" />}
          中止
        </button>
      </div>

      <div className="absolute top-9 left-0 right-0 z-10 pointer-events-none">
        <SinglePassPacedThreeLineStream isRunning={isStreamActive} planId={activePlan.plan_id} />
      </div>
    </div>
  )
}

function renderMentionText(text: string) {
  if (!text) return null
  // Slash commands are standalone tokens. Requiring whitespace (or the start of
  // the message) keeps URL path segments such as https://36kr.com/feed plain.
  const regex = /(@[\u4e00-\u9fa5\w-]+|(?<!\S)\/[\w-]+)/g
  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const matchText = match[0]
    const matchIndex = match.index

    if (matchIndex > lastIndex) {
      parts.push(text.slice(lastIndex, matchIndex))
    }

    if (matchText.startsWith('@')) {
      parts.push(
        <span
          key={`${matchIndex}-${matchText}`}
          className="font-semibold text-sky-500"
        >
          {matchText}
        </span>
      )
    } else if (matchText.startsWith('/')) {
      parts.push(
        <span
          key={`${matchIndex}-${matchText}`}
          className="font-semibold text-purple-400"
        >
          {matchText}
        </span>
      )
    }

    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts.length > 0 ? parts : text
}

function getAttachmentCategoryInfo(name: string, kind?: string, mimeType?: string) {
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['xlsx', 'xls', 'csv', 'tsv'].includes(ext) || kind === 'spreadsheet' || mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || mimeType?.includes('csv')) {
    return {
      label: '电子表格',
      type: 'spreadsheet' as const,
    }
  }
  if (['txt', 'md', 'markdown', 'json', 'log', 'pdf', 'doc', 'docx'].includes(ext) || kind === 'text' || kind === 'document' || mimeType?.startsWith('text/')) {
    return {
      label: '文本文档',
      type: 'text' as const,
    }
  }
  return {
    label: '文本文档',
    type: 'text' as const,
  }
}

function truncateMiddle(str: string, maxLength: number = 16): string {
  if (!str) return ''
  const clean = str.trim()
  if (clean.length <= maxLength) return clean
  const keepFront = Math.ceil((maxLength - 3) / 2)
  const keepEnd = Math.floor((maxLength - 3) / 2)
  return `${clean.slice(0, keepFront)}...${clean.slice(clean.length - keepEnd)}`
}

function AttachmentDisplayCard({
  title,
  categoryLabel,
  type,
  onRemove,
  sizeBytes,
  compact = false,
}: {
  title: string
  categoryLabel: string
  type: 'spreadsheet' | 'text' | 'data'
  onRemove?: () => void
  sizeBytes?: number
  compact?: boolean
}) {
  const displayTitle = truncateMiddle(title, compact ? 12 : 16)
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border border-cyber-border-subtle/70 bg-cyber-bg-panel/75 backdrop-blur-xs shadow-2xs transition-all hover:bg-cyber-bg-panel/90 hover:border-cyber-border-highlight ${
        compact ? 'w-fit max-w-[210px] min-w-0 px-2 py-1' : 'w-fit min-w-[160px] max-w-[230px] px-2.5 py-1.5'
      }`}
      title={title}
    >
      {type === 'spreadsheet' && (
        <div className={`flex shrink-0 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-500 border border-emerald-500/25 dark:bg-emerald-500/20 ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}>
          <FileSpreadsheet className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-emerald-500`} />
        </div>
      )}
      {type === 'text' && (
        <div className={`flex shrink-0 items-center justify-center rounded-lg bg-blue-500/15 text-blue-500 border border-blue-500/25 dark:bg-blue-500/20 ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}>
          <FileText className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-blue-500`} />
        </div>
      )}
      {type === 'data' && (
        <div className={`flex shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-500 border border-cyan-500/25 dark:bg-cyan-500/20 ${compact ? 'h-6 w-6' : 'h-7 w-7'}`}>
          <Database className={`${compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} text-cyan-500`} />
        </div>
      )}
      <div className="flex flex-1 flex-col min-w-0 justify-center text-left">
        <span
          className="truncate text-[11px] sm:text-xs font-medium text-cyber-text-primary leading-tight"
        >
          {displayTitle}
        </span>
        <span className="truncate text-[10px] font-normal text-cyber-text-muted mt-0.5 leading-none">
          {categoryLabel}
          {sizeBytes ? ` · ${(sizeBytes / 1024).toFixed(0)}KB` : ''}
        </span>
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`移除 ${title}`}
          className="rounded p-0.5 hover:bg-cyber-bg-tertiary text-cyber-text-muted hover:text-cyber-text-primary transition-colors shrink-0"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

function isPlanLikeMessage(message?: AgentMessage | null): boolean {
  if (!message || message.role === 'user') return false
  if (message.kind === 'plan') return true
  const planId = message.metadata?.plan_id
  const action = message.metadata?.action
  return Boolean(planId) && ['execute', 'create_plan', 'plan'].includes(String(action || ''))
}

function parsePlanText(rawText: string) {
  if (!rawText) return { configText: '', noticeText: '' }
  const lines = rawText.split(/\r?\n/)
  const configLines: string[] = []
  const noticeLines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // 1. Filter out redundant status lead headers (already represented by card status summary)
    if (/^已(创建任务|按.*创建任务|按你的补充|识别并创建)/.test(trimmed)) {
      continue
    }

    // 2. Classify transient operational notices / execution prompts
    if (/^(任务已进入|如果确认无误|采集完成后|采集结束后)/.test(trimmed)) {
      noticeLines.push(trimmed)
    } else {
      // 3. All other lines are task config metadata (平台, 关键词, 范围, 正文, 分析维度, 分析重点, Skill, etc.)
      configLines.push(trimmed)
    }
  }

  return {
    configText: configLines.join('\n'),
    noticeText: noticeLines.join('\n'),
  }
}

function PlanMessageContent({
  cleanContent,
  isPlanRunning,
}: {
  cleanContent: string
  isPlanRunning: boolean
}) {
  const [runningDetailsOpen, setRunningDetailsOpen] = useState(true)
  const { configText, noticeText } = parsePlanText(cleanContent)
  const displayConfig = configText || cleanContent

  // Transient execution queue notices (e.g., "任务已进入执行队列...") are only meaningful
  // while the task is active. Once completed or folded into an analysis report, hide them.
  const hasExecutionNotice = noticeText ? /^任务已进入|^如果确认无误|^采集完成|^采集结束/.test(noticeText.trim()) : false
  const shouldShowNotice = isPlanRunning
    ? Boolean(noticeText)
    : Boolean(noticeText && !hasExecutionNotice)

  return (
    <div className="space-y-3">
      {isPlanRunning ? (
        <details
          open={runningDetailsOpen}
          onToggle={(event) => setRunningDetailsOpen(event.currentTarget.open)}
          className="group my-1 text-xs text-cyber-text-muted"
        >
          <summary className="inline-flex cursor-pointer items-center gap-2 font-medium text-cyber-neon-cyan transition-colors select-none">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            <span>已创建任务并开始采集</span>
            <ChevronRight className="h-3.5 w-3.5 text-cyber-text-muted transition-transform group-open:rotate-90 shrink-0" />
          </summary>
          <div className="mt-2 rounded-lg border border-cyber-border-subtle/50 bg-cyber-bg-tertiary/30 p-3 text-[12px] leading-relaxed text-cyber-text-muted whitespace-pre-wrap">
            {displayConfig}
          </div>
        </details>
      ) : (
        <details className="group my-1 text-xs text-cyber-text-muted">
          <summary className="inline-flex cursor-pointer items-center gap-1 text-[13px] text-cyber-text-secondary hover:text-cyber-neon-cyan transition-colors select-none">
            <span>采集任务原始配置信息</span>
            <ChevronRight className="h-3.5 w-3.5 text-cyber-text-muted transition-transform group-open:rotate-90 shrink-0" />
          </summary>
          <div className="mt-2 rounded-lg border border-cyber-border-subtle/40 bg-cyber-bg-tertiary/20 p-3 text-[12px] leading-relaxed text-cyber-text-muted whitespace-pre-wrap">
            {displayConfig}
          </div>
        </details>
      )}

      {shouldShowNotice ? (
        <div className="text-sm leading-relaxed text-cyber-text-primary whitespace-pre-wrap">
          {noticeText}
        </div>
      ) : null}
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({ message, plan, activePlan, planConfigContent, onStopPlan, stoppingPlan, hasStreamingAnswer, isPlanInitiator, onDeletePair, deletingPair, onRegenerate, regenerating, disabled, isLatestAssistant, onPreviewImage, onCitationClick }: {
  message: AgentMessage
  /** Only used to fall back to the plan's keywords when a message carries none. */
  plan: AgentPlan | null
  activePlan?: AgentPlan | null
  /** The originating plan is folded into the completed analysis bubble. */
  planConfigContent?: string
  onStopPlan?: (planId: string) => void
  stoppingPlan?: boolean
  hasStreamingAnswer?: boolean
  isPlanInitiator?: boolean
  onDeletePair: (threadId: string, messageId: string) => Promise<unknown>
  deletingPair: boolean
  onRegenerate?: (threadId: string, messageId: string) => Promise<unknown>
  regenerating?: boolean
  disabled?: boolean
  isLatestAssistant?: boolean
  onPreviewImage?: (url: string) => void
  onCitationClick?: (sourceId: string) => void
}) {
  const isUser = message.role === 'user'
  const platformLabels = usePlatformLabels()
  const isTargetPlanMessage = !isUser && isPlanInitiator && activePlan && activePlan.status !== 'awaiting_confirmation' && ['queued', 'running'].includes(activePlan.status)
  const isPlanMessage = !isUser && isPlanLikeMessage(message)
  const isPlanRunning = Boolean(
    (isTargetPlanMessage || (activePlan && activePlan.plan_id === message.metadata?.plan_id && ['queued', 'running'].includes(activePlan.status))) &&
    isPlanLikeMessage(message)
  )
  const [copied, setCopied] = useState(false)
  const copyMarkdown = async () => {
    try {
      let contentToCopy = message.content.replace(/\n\s*---\s*\n\s*##?\s*📚?\s*(?:参考资料|资料来源|References|来源列表)[\s\S]*$/, '').trim()
      contentToCopy = flattenDetailsInMarkdown(contentToCopy)

      if (planConfigContent) {
        const formattedConfig = cleanAndFormatPlanConfig(planConfigContent)
        if (formattedConfig) {
          contentToCopy = `${formattedConfig}\n\n${contentToCopy}`
        }
      }
      const sources = message.metadata?.sources
      if (Array.isArray(sources) && sources.length > 0) {
        const isTransientWeb = ['live_search', 'direct_web_read'].includes(message.metadata?.retrieval)
        const keywords = isTransientWeb
          ? []
          : message.metadata?.keywords || plan?.plan?.keywords || []
        const kwText = keywords.length > 0 ? keywords.map((k: string) => `“${k}”`).join('、、') : ''
        const listItems = sources.map((s: any, idx: number) => {
          const title = (s.title || '未命名资料').replace(/\r?\n/g, ' ')
          const link = s.sourceUrl ? `[${title}](${s.sourceUrl})` : `${title} [${s.id}]`
          return `${idx + 1}. ${link}`
        })
        const refBlock = [
          '',
          '---',
          '',
          '## 参考来源',
          '',
          kwText ? `关键词：${kwText}` : '',
          ...listItems,
        ].filter(Boolean).join('\n')
        contentToCopy += `\n${refBlock}`
      }
      await copyText(contentToCopy)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch (error) {
      toast.error(getError(error))
    }
  }
  const cleanContent = !isUser
    ? message.content.replace(/\n\s*---\s*\n\s*##?\s*📚?\s*(?:参考资料|资料来源|References|来源列表)[\s\S]*$/, '').trim()
    : message.content

  return (
    <div className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyber-neon-cyan/25 bg-cyber-neon-cyan/10"><Bot className="h-4 w-4 text-cyber-neon-cyan" /></div>}
      <div className={`max-w-[780px] ${isUser ? 'rounded-2xl rounded-tr-sm bg-cyber-neon-cyan/12 px-4 py-3' : 'min-w-0 flex-1'}`}>
        {isUser && (message.metadata?.attachments?.length || message.metadata?.task_references?.length) ? <div className="mb-3 flex flex-col gap-2.5 items-end">
          {(message.metadata.attachments || []).map((attachment: AgentAttachment) => {
            const isImage = attachment.kind === 'image' || attachment.mime_type?.startsWith('image/')
            const imgUrl = attachment.preview_url || agentApi.getAttachmentFileUrl(message.thread_id, attachment.attachment_id)
            if (isImage) {
              return (
                <div key={attachment.attachment_id} className="overflow-hidden rounded-xl border border-cyber-border-subtle/70 bg-cyber-bg-panel/75 backdrop-blur-xs p-1 shadow-2xs transition-all hover:bg-cyber-bg-panel/90 hover:border-cyber-border-highlight group/img">
                  <img
                    src={imgUrl}
                    alt={attachment.file_name}
                    className="max-h-60 max-w-[230px] rounded-lg object-contain transition-transform hover:scale-[1.01] cursor-pointer"
                    onClick={() => onPreviewImage?.(imgUrl)}
                  />
                </div>
              )
            }
            const categoryInfo = getAttachmentCategoryInfo(attachment.file_name, attachment.kind, attachment.mime_type)
            return (
              <AttachmentDisplayCard
                key={attachment.attachment_id}
                title={attachment.file_name}
                categoryLabel={categoryInfo.label}
                type={categoryInfo.type}
              />
            )
          })}
          {(message.metadata.task_references || []).map((reference: { plan_id: string; goal: string; platforms?: string[] }) => (
            <AttachmentDisplayCard
              key={reference.plan_id}
              title={reference.goal}
              categoryLabel={`引用数据${reference.platforms?.length ? ` · ${reference.platforms.map((p) => platformLabels[p] || p).join('/')}` : ''}`}
              type="data"
            />
          ))}
        </div> : null}
        {!isUser && planConfigContent ? (
          <div className="mb-4">
            <PlanMessageContent cleanContent={planConfigContent} isPlanRunning={false} />
          </div>
        ) : null}
        {!isUser && (message.metadata?.analysis_coverage || (Array.isArray(message.metadata?.sources) && message.metadata.sources.length > 0)) ? (
          <CollapsibleSourcesBar
            sources={message.metadata?.sources}
            keywords={['live_search', 'direct_web_read'].includes(message.metadata?.retrieval) ? [] : message.metadata?.keywords || plan?.plan?.keywords}
            retrieval={message.metadata?.retrieval}
            coverage={message.metadata?.analysis_coverage as AnalysisCoverage}
            onCitationClick={onCitationClick}
          />
        ) : null}
        {isUser
          ? <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-sm leading-6 text-cyber-text-primary">{renderMentionText(cleanContent)}</div>
          : isPlanMessage
            ? <PlanMessageContent cleanContent={cleanContent} isPlanRunning={isPlanRunning} />
            : <MarkdownContent content={cleanContent} sources={message.metadata?.sources} onCitationClick={onCitationClick} />}
        {(message.kind === 'export' || message.metadata?.action === 'export') && typeof message.metadata?.plan_id === 'string'
          ? <SpreadsheetDownloadLink planId={message.metadata.plan_id} />
          : null}
        {isTargetPlanMessage && activePlan && onStopPlan ? (
          <ChatCrawlingStatusBanner
            activePlan={activePlan}
            onStop={() => onStopPlan(activePlan.plan_id)}
            stopping={Boolean(stoppingPlan)}
            hasStreamingAnswer={Boolean(hasStreamingAnswer)}
          />
        ) : null}
        <div className={`mt-1.5 flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
          <p className="text-[9px] text-cyber-text-muted">{new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(message.created_at))}</p>
          <div className="flex items-center opacity-60 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
            <button type="button" onClick={copyMarkdown} className="flex h-6 w-6 items-center justify-center rounded text-cyber-text-muted transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary" title="复制 Markdown 原文" aria-label="复制 Markdown 原文">
              {copied ? <Check className="h-3 w-3 text-cyber-neon-green" /> : <Copy className="h-3 w-3" />}
            </button>
            {!isUser ? <>
              {isLatestAssistant ? (
                <button
                  type="button"
                  disabled={disabled || regenerating}
                  onClick={() => onRegenerate?.(message.thread_id, message.message_id)}
                  className="flex h-6 w-6 items-center justify-center rounded text-cyber-text-muted transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-neon-cyan disabled:opacity-40"
                  title="重新回答"
                  aria-label="重新回答"
                >
                  <RotateCw className={`h-3 w-3 ${regenerating ? 'animate-spin' : ''}`} />
                </button>
              ) : null}
              <DeleteConfirmDialog
                trigger={<button type="button" disabled={deletingPair} className="flex h-6 w-6 items-center justify-center rounded text-cyber-text-muted transition-colors hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink disabled:opacity-40" title="删除这一轮对话" aria-label="删除这一轮对话"><Trash2 className="h-3 w-3" /></button>}
                title="删除这一轮对话？"
                description="将删除这条用户消息及其对应的全部 AI 回复；关联的采集任务和看板数据会保留。此操作无法撤销。"
                confirmLabel="删除这一轮"
                onConfirm={() => onDeletePair(message.thread_id, message.message_id)}
              />
            </> : null}
          </div>
        </div>
      </div>
      {isUser && <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyber-bg-tertiary"><User className="h-4 w-4 text-cyber-text-secondary" /></div>}
    </div>
  )
})

type AgentWorkspaceProps = {
  selectedId: string | null
  onSelectedIdChange: Dispatch<SetStateAction<string | null>>
  onOpenResults: (context: { threadId: string; planId: string }) => void
}

export function AgentWorkspace({ selectedId, onSelectedIdChange: setSelectedId, onOpenResults }: AgentWorkspaceProps) {
  const client = useQueryClient()
  useLogWebSocket()
  const [input, setInput] = useState('')

  const platformLabels = usePlatformLabels()
  const skillEntities = useSkillMentionEntities()
  const mentionCommands = useMentionCommands({
    value: input,
    onChange: setInput,
    mentionEntities: skillEntities,
  })
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [aiRetryStates, setAiRetryStates] = useState<Record<string, { count: number; max: number; delaySec: number }>>({})
  const [aiProgressByThread, setAiProgressByThread] = useState<Record<string, AiProgressStatus>>({})
  const [pendingMessageThreadIds, setPendingMessageThreadIds] = useState<Set<string>>(() => new Set())
  const [stoppingMessageThreadIds, setStoppingMessageThreadIds] = useState<Set<string>>(() => new Set())
  const [stoppingPlanIds, setStoppingPlanIds] = useState<Set<string>>(() => new Set())
  const [regeneratingMessageByThread, setRegeneratingMessageByThread] = useState<Record<string, string>>({})
  const sendAbortControllersRef = useRef(new Map<string, AbortController>())
  const selectedThreadIdRef = useRef<string | null>(selectedId)

  useEffect(() => {
    selectedThreadIdRef.current = selectedId
  }, [selectedId])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const addMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!addMenuOpen) return
    const handlePointerDown = (e: PointerEvent) => {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target as Node)) {
        setAddMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAddMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [addMenuOpen])

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
      if (data.can_open === false) {
        toast.info('当前没有可查看的采集浏览器窗口（该任务为后台 HTTP 接口采集）')
      }
    },
    onError: (error) => toast.error(getError(error)),
  })
  const [threadSearchOpen, setThreadSearchOpen] = useState(false)
  const [threadSearchQuery, setThreadSearchQuery] = useState('')
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null)
  const [renamingThread, setRenamingThread] = useState<AgentThreadSummary | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [deleteAnalyticsData, setDeleteAnalyticsData] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(() => storedPanelSize('unisearch-left-sidebar-width', 270))
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => storedPanelSize('unisearch-right-sidebar-width', 300))
  const [terminalHeight, setTerminalHeight] = useState(() => storedPanelSize('unisearch-terminal-height', 220))
  const [activeResize, setActiveResize] = useState<'left' | 'terminal' | 'right' | null>(null)

  const threadPanelStatesRef = useRef<Record<string, {
    rightSidebarOpen: boolean
    terminalOpen: boolean
    rightSidebarWidth: number
    terminalHeight: number
  }>>({})

  useEffect(() => {
    if (!selectedId) {
      setRightSidebarOpen(false)
      setTerminalOpen(false)
      return
    }

    const saved = threadPanelStatesRef.current[selectedId]
    if (saved) {
      setRightSidebarOpen(saved.rightSidebarOpen)
      setTerminalOpen(saved.terminalOpen)
      setRightSidebarWidth(saved.rightSidebarWidth)
      setTerminalHeight(saved.terminalHeight)
    } else {
      const defaultRightWidth = storedPanelSize('unisearch-right-sidebar-width', 300)
      const defaultTerminalHeight = storedPanelSize('unisearch-terminal-height', 220)
      setRightSidebarOpen(false)
      setTerminalOpen(false)
      setRightSidebarWidth(defaultRightWidth)
      setTerminalHeight(defaultTerminalHeight)
      threadPanelStatesRef.current[selectedId] = {
        rightSidebarOpen: false,
        terminalOpen: false,
        rightSidebarWidth: defaultRightWidth,
        terminalHeight: defaultTerminalHeight,
      }
    }
  }, [selectedId])
  const [petCelebrating, setPetCelebrating] = useState(false)
  const [activeCitation, setActiveCitation] = useState<SourceCitation | null>(null)
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false)

  const threadDocumentsQuery = useQuery({
    queryKey: ['thread-documents', selectedId],
    queryFn: async () => {
      if (!selectedId) return []
      const res = await fetch(`/api/knowledge/documents?thread_id=${encodeURIComponent(selectedId)}`)
      const data = await res.json()
      return data.documents || []
    },
    enabled: !!selectedId,
    refetchInterval: 3000,
  })

  // 归档量必须和"数据分布"同口径：正文与评论分开数，否则两个数字永远对不上
  const knowledgeCounts = useMemo(() => {
    const docs = (threadDocumentsQuery.data || []) as Array<{ kind?: string }>
    const comments = docs.filter((doc) => doc.kind === 'comment').length
    return { articles: docs.length - comments, comments }
  }, [threadDocumentsQuery.data])

  const [exportConfirmPlatform, setExportConfirmPlatform] = useState<PlatformConfig | null>(null)

  const handleExecuteDownload = (exporterId: string) => {
    const activeWorkflowId = (activePlan as any)?.workflow_id || activePlan?.plan_id
    const params = new URLSearchParams({ exporterId })
    if (activeWorkflowId) params.append('workflowId', activeWorkflowId)
    const downloadUrl = `/api/exporters/download?${params.toString()}`

    const link = document.createElement('a')
    link.href = downloadUrl
    link.setAttribute('download', '')
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCitationClick = useCallback((sourceId: string) => {
    const num = parseInt(sourceId.replace(/\D/g, ''), 10)
    const docs = client.getQueryData<any[]>(['thread-documents', selectedId]) || []
    const doc = (num > 0 && docs[num - 1]) ? docs[num - 1] : docs[0]
    if (doc) {
      setActiveCitation({
        id: sourceId.startsWith('S') ? sourceId : `S${sourceId}`,
        documentId: doc.documentId || doc.canonical_key || 'doc-1',
        title: doc.title || '规范化数据文档',
        source: doc.provenance?.source || doc.metadata?.source || 'UniSearch 知识库',
        sourceUrl: doc.sourceUrl || doc.metadata?.source_url,
        excerpt: doc.markdown ? doc.markdown.slice(0, 600) : '已归档存入本地 SQLite 知识库引擎。',
        score: 0.95,
      })
    } else {
      setActiveCitation({
        id: sourceId.startsWith('S') ? sourceId : `S${sourceId}`,
        documentId: 'doc-unknown',
        title: `参考资料片段 [${sourceId}]`,
        source: 'UniSearch 知识库',
        excerpt: `出处标签为 [${sourceId}] 的原始采样本段。数据已落地于 SQLite 全文及向量索引库。`,
        score: 0.90,
      })
    }
    setSourceDrawerOpen(true)
  }, [client, selectedId])
  const workspaceRef = useRef<HTMLDivElement>(null)
  const messagesScrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const composerBackdropRef = useRef<HTMLDivElement>(null)
  const petReactionTimerRef = useRef<number | null>(null)
  const petReactionFrameRef = useRef<number | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const scrollMessagesToBottom = useCallback((behavior: ScrollBehavior = 'auto', force = false) => {
    if (!force && !shouldStickToBottomRef.current) return
    window.requestAnimationFrame(() => {
      const container = messagesScrollRef.current
      if (!container) return
      if (!force && !shouldStickToBottomRef.current) return
      if (behavior === 'auto') {
        container.scrollTop = container.scrollHeight
      } else {
        container.scrollTo({ top: container.scrollHeight, behavior })
      }
      shouldStickToBottomRef.current = true
    })
  }, [])
  const handleMessagesScroll = useCallback(() => {
    const container = messagesScrollRef.current
    if (!container) return
    shouldStickToBottomRef.current = container.scrollHeight - container.scrollTop - container.clientHeight <= 150
  }, [])
  const send = useMutation({
    mutationFn: async ({ id, content, attachmentIds, references }: { id: string; content: string; attachmentIds: string[]; references: Array<{ plan_id: string; platforms: string[] }>; message: AgentMessage }) => {
      const controller = new AbortController()
      sendAbortControllersRef.current.set(id, controller)
      const mentionedSkills = extractMentionedSkillIds(content, skillEntities)
      const streamingMessageId = `streaming-${id}`
      let streamedContent = ''
      let renderedContent = ''
      let streamedSources: any[] | undefined = undefined
      let streamedRetrieval: string | undefined = undefined
      let streamedCoverage: any | undefined = undefined
      let lastRenderedSources: any[] | undefined = undefined
      let lastRenderedCoverage: any | undefined = undefined
      let renderTimer: number | null = null
      let lastRenderTime = 0
      const renderDelta = () => {
        renderTimer = null
        lastRenderTime = Date.now()
        if (renderedContent === streamedContent && lastRenderedSources === streamedSources && lastRenderedCoverage === streamedCoverage) return
        renderedContent = streamedContent
        lastRenderedSources = streamedSources
        lastRenderedCoverage = streamedCoverage
        client.setQueryData<AgentThread>(['agent-thread', id], (current) => {
          if (!current) return current
          const streamedMessage: AgentMessage = {
            message_id: streamingMessageId,
            thread_id: id,
            role: 'assistant',
            kind: 'text',
            content: renderedContent,
            metadata: {
              streaming: true,
              ...(streamedSources ? { sources: streamedSources } : {}),
              ...(streamedRetrieval ? { retrieval: streamedRetrieval } : {}),
              ...(streamedCoverage ? { analysis_coverage: streamedCoverage } : {}),
            },
            created_at: new Date().toISOString(),
          }
          const existingIndex = current.messages.findIndex((item) => item.message_id === streamingMessageId)
          return {
            ...current,
            messages: existingIndex >= 0
              ? current.messages.map((item, index) => index === existingIndex ? streamedMessage : item)
              : [...current.messages, streamedMessage],
          }
        })
        if (selectedThreadIdRef.current === id) scrollMessagesToBottom('auto')
      }
      const scheduleRender = () => {
        if (renderTimer !== null) return
        const elapsed = Date.now() - lastRenderTime
        const delay = Math.max(0, 40 - elapsed)
        renderTimer = window.setTimeout(renderDelta, delay)
      }
      try {
        return await agentApi.sendMessageStream(id, content, {
          attachment_ids: attachmentIds,
          task_references: references,
          ...(mentionedSkills.length ? { mentioned_skills: mentionedSkills } : {}),
        }, (delta) => {
          streamedContent += delta
          scheduleRender()
        }, controller.signal, (status) => {
          setAiProgressByThread((current) => ({ ...current, [id]: status }))
          if ((status.sources && Array.isArray(status.sources)) || status.analysis_coverage) {
            streamedSources = status.sources
            streamedRetrieval = status.retrieval
            streamedCoverage = status.analysis_coverage
            scheduleRender()
          }
        })
      } finally {
        if (renderTimer !== null) window.clearTimeout(renderTimer)
        renderDelta()
      }
    },
    onMutate: async ({ id, message }) => {
      setPendingMessageThreadIds((current) => new Set(current).add(id))
      setAiProgressByThread((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      await client.cancelQueries({ queryKey: ['agent-thread', id] })
      client.setQueryData<AgentThread>(['agent-thread', id], (current) => current ? {
        ...current,
        last_message: message.content,
        updated_at: message.created_at,
        messages: [...current.messages, message],
      } : current)
      if (selectedThreadIdRef.current === id) scrollMessagesToBottom('smooth', true)
    },
    onSuccess: ({ data }) => {
      client.setQueryData(['agent-thread', data.thread_id], data)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      client.invalidateQueries({ queryKey: ['agent-model-profile'] })
    },
    onError: (error, { id }) => {
      if ((error as any)?.code !== 'ERR_CANCELED' && (error as any)?.name !== 'AbortError') toast.error(getError(error))
      client.invalidateQueries({ queryKey: ['agent-thread', id] })
      client.invalidateQueries({ queryKey: ['agent-threads'] })
    },
    onSettled: (_data, _error, { id }) => {
      sendAbortControllersRef.current.delete(id)
      setPendingMessageThreadIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
      setAiProgressByThread((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
      setAiRetryStates((current) => {
        const next = { ...current }
        delete next[id]
        return next
      })
    },
  })

  const isCurrentMessagePending = Boolean(selectedId && pendingMessageThreadIds.has(selectedId))

  useEffect(() => {
    if (!selectedId) return
    if (!pendingMessageThreadIds.has(selectedId)) {
      setAiRetryStates((current) => {
        if (!current[selectedId]) return current
        const next = { ...current }
        delete next[selectedId]
        return next
      })
      return
    }
    const latest = systemLogs.at(-1)
    if (latest && latest.thread_id === selectedId && latest.retry_count) {
      setAiRetryStates((current) => ({
        ...current,
        [selectedId]: {
          count: Number(latest.retry_count),
          max: latest.max_retries || 3,
          delaySec: latest.delay_sec || 5,
        },
      }))
    }
  }, [systemLogs, pendingMessageThreadIds, selectedId])

  const threadsQuery = useQuery({ queryKey: ['agent-threads'], queryFn: async () => (await agentApi.listThreads()).data.items, refetchInterval: 3000 })
  const threadQuery = useQuery({
    queryKey: ['agent-thread', selectedId],
    queryFn: async () => (await agentApi.getThread(selectedId!)).data,
    enabled: Boolean(selectedId),
    refetchInterval: (query) => (isCurrentMessagePending ? false : (query.state.data?.plan && ['queued', 'running'].includes(query.state.data.plan.status) ? 600 : 1500)),
  })
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
    mutationFn: async (rawFile: File) => {
      const file = await compressImage(rawFile)
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
      await Promise.allSettled(filesToUpload.map((file) => upload.mutateAsync(file)))
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
  const regenerate = useMutation({
    mutationFn: async ({ threadId, messageId }: { threadId: string; messageId: string }) => {
      const controller = new AbortController()
      sendAbortControllersRef.current.set(threadId, controller)
      let streamedContent = ''
      let renderedContent = ''
      let streamedSources: any[] | undefined = undefined
      let streamedRetrieval: string | undefined = undefined
      let streamedCoverage: any | undefined = undefined
      let lastRenderedSources: any[] | undefined = undefined
      let lastRenderedCoverage: any | undefined = undefined
      const streamingMessageId = `streaming-${Date.now()}`
      let renderTimer: number | null = null
      let lastRenderTime = 0

      const renderDelta = () => {
        renderTimer = null
        lastRenderTime = Date.now()
        if (renderedContent === streamedContent && lastRenderedSources === streamedSources && lastRenderedCoverage === streamedCoverage) return
        renderedContent = streamedContent
        lastRenderedSources = streamedSources
        lastRenderedCoverage = streamedCoverage
        client.setQueryData<AgentThread>(['agent-thread', threadId], (current) => {
          if (!current) return current
          const streamedMessage: AgentMessage = {
            message_id: streamingMessageId,
            thread_id: threadId,
            role: 'assistant',
            kind: 'text',
            content: renderedContent,
            metadata: {
              streaming: true,
              ...(streamedSources ? { sources: streamedSources } : {}),
              ...(streamedRetrieval ? { retrieval: streamedRetrieval } : {}),
              ...(streamedCoverage ? { analysis_coverage: streamedCoverage } : {}),
            },
            created_at: new Date().toISOString(),
          }
          const existingIndex = current.messages.findIndex((item) => item.message_id === streamingMessageId)
          return {
            ...current,
            messages: existingIndex >= 0
              ? current.messages.map((item, index) => index === existingIndex ? streamedMessage : item)
              : [...current.messages, streamedMessage],
          }
        })
        if (selectedThreadIdRef.current === threadId) scrollMessagesToBottom('auto')
      }
      const scheduleRender = () => {
        if (renderTimer !== null) return
        const elapsed = Date.now() - lastRenderTime
        const delay = Math.max(0, 40 - elapsed)
        renderTimer = window.setTimeout(renderDelta, delay)
      }
      try {
        return await agentApi.regenerateMessageStream(threadId, messageId, (delta) => {
          streamedContent += delta
          scheduleRender()
        }, controller.signal, (status) => {
          setAiProgressByThread((current) => ({ ...current, [threadId]: status }))
          if ((status.sources && Array.isArray(status.sources)) || status.analysis_coverage) {
            streamedSources = status.sources
            streamedRetrieval = status.retrieval
            streamedCoverage = status.analysis_coverage
            scheduleRender()
          }
        })
      } finally {
        if (renderTimer !== null) window.clearTimeout(renderTimer)
        renderDelta()
      }
    },
    onMutate: async ({ threadId, messageId }) => {
      setPendingMessageThreadIds((current) => new Set(current).add(threadId))
      setRegeneratingMessageByThread((current) => ({ ...current, [threadId]: messageId }))
      setAiProgressByThread((current) => {
        const next = { ...current }
        delete next[threadId]
        return next
      })
      await client.cancelQueries({ queryKey: ['agent-thread', threadId] })
      client.setQueryData<AgentThread>(['agent-thread', threadId], (current) => {
        if (!current) return current
        const targetIndex = current.messages.findIndex((msg) => msg.message_id === messageId)
        if (targetIndex < 0) return current
        return {
          ...current,
          messages: current.messages.slice(0, targetIndex),
        }
      })
      if (selectedThreadIdRef.current === threadId) scrollMessagesToBottom('auto', true)
    },
    onSuccess: ({ data }) => {
      client.setQueryData(['agent-thread', data.thread_id], data)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
      client.invalidateQueries({ queryKey: ['agent-model-profile'] })
    },
    onError: (error, { threadId }) => {
      if ((error as any)?.code !== 'ERR_CANCELED' && (error as any)?.name !== 'AbortError') toast.error(getError(error))
      client.invalidateQueries({ queryKey: ['agent-thread', threadId] })
      client.invalidateQueries({ queryKey: ['agent-threads'] })
    },
    onSettled: (_data, _error, { threadId }) => {
      sendAbortControllersRef.current.delete(threadId)
      setPendingMessageThreadIds((current) => {
        const next = new Set(current)
        next.delete(threadId)
        return next
      })
      setRegeneratingMessageByThread((current) => {
        const next = { ...current }
        delete next[threadId]
        return next
      })
      setAiProgressByThread((current) => {
        const next = { ...current }
        delete next[threadId]
        return next
      })
      setAiRetryStates((current) => {
        const next = { ...current }
        delete next[threadId]
        return next
      })
    },
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
    onSuccess: ({ data }) => {
      client.setQueryData<AgentThreadSummary[]>(['agent-threads'], (current) => {
        const updated = current?.map((thread) => thread.thread_id === data.thread_id ? { ...thread, pinned_at: data.pinned_at } : thread)
        return updated?.sort((a, b) => {
          if (Boolean(a.pinned_at) !== Boolean(b.pinned_at)) return a.pinned_at ? -1 : 1
          return String(b.pinned_at || b.updated_at).localeCompare(String(a.pinned_at || a.updated_at))
        })
      })
      client.setQueryData<AgentThread>(['agent-thread', data.thread_id], (current) => current ? { ...current, pinned_at: data.pinned_at } : current)
      client.invalidateQueries({ queryKey: ['agent-threads'] })
    },
    onError: (error) => toast.error(getError(error)),
  })
  const execute = useMutation({
    mutationFn: (planId: string) => agentApi.executePlan(planId),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['agent-thread', selectedId] }) },
    onError: (error) => toast.error(getError(error)),
  })
  const stopPlan = useMutation({
    mutationFn: (planId: string) => agentApi.stopPlan(planId),
    onMutate: (planId) => {
      setStoppingPlanIds((current) => new Set(current).add(planId))
    },
    onSuccess: ({ data }) => {
      if (data.stopped) toast.success('采集已中止')
      else toast.info('任务已经结束，无需中止')
    },
    onError: (error) => toast.error(getError(error)),
    onSettled: (_data, _error, planId) => {
      setStoppingPlanIds((current) => {
        const next = new Set(current)
        next.delete(planId)
        return next
      })
      client.invalidateQueries({ queryKey: ['agent-thread', selectedId] })
      client.invalidateQueries({ queryKey: ['agent-threads'] })
    },
  })
  const stopPlanMutate = stopPlan.mutate
  const removeMessagePairMutateAsync = removeMessagePair.mutateAsync
  const regenerateMutateAsync = regenerate.mutateAsync
  const handleStopPlan = useCallback((planId: string) => {
    stopPlanMutate(planId)
  }, [stopPlanMutate])
  const handleDeleteMessagePair = useCallback((threadId: string, messageId: string) => (
    removeMessagePairMutateAsync({ threadId, messageId })
  ), [removeMessagePairMutateAsync])
  const handleRegenerateMessage = useCallback((threadId: string, messageId: string) => (
    regenerateMutateAsync({ threadId, messageId })
  ), [regenerateMutateAsync])
  const handlePreviewImage = useCallback((url: string) => {
    setPreviewImageUrl(url)
  }, [])
  useEffect(() => {
    shouldStickToBottomRef.current = true
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
  const streamingContentLength = threadQuery.data?.messages.reduce(
    (length, message) => message.metadata?.streaming ? message.content.length : length,
    0,
  ) ?? 0
  useEffect(() => {
    scrollMessagesToBottom(streamingContentLength > 0 ? 'auto' : 'smooth')
  }, [threadQuery.data?.messages.length, isCurrentMessagePending, streamingContentLength, scrollMessagesToBottom])
  useEffect(() => () => {
    if (petReactionTimerRef.current !== null) window.clearTimeout(petReactionTimerRef.current)
    if (petReactionFrameRef.current !== null) window.cancelAnimationFrame(petReactionFrameRef.current)
  }, [])

  const submit = () => {
    const content = input.trim()
    if (!content || isCurrentMessagePending || (selectedId && stoppingMessageThreadIds.has(selectedId)) || create.isPending) return
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

  const stopGenerating = () => {
    const threadId = selectedId
    if (!threadId || stoppingMessageThreadIds.has(threadId)) return
    setStoppingMessageThreadIds((current) => new Set(current).add(threadId))
    sendAbortControllersRef.current.get(threadId)?.abort()
    agentApi.stopMessage(threadId)
      .catch((error) => toast.error(getError(error)))
      .finally(() => {
        setStoppingMessageThreadIds((current) => {
          const next = new Set(current)
          next.delete(threadId)
          return next
        })
        client.invalidateQueries({ queryKey: ['agent-thread', threadId] })
        client.invalidateQueries({ queryKey: ['agent-threads'] })
      })
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
  const displayMessages = useMemo<Array<{ message: AgentMessage; planConfigContent?: string }>>(() => {
    const messages = threadQuery.data?.messages || []
    const planMessages = new Map<string, AgentMessage>()
    for (const message of messages) {
      const planId = typeof message.metadata?.plan_id === 'string' ? message.metadata.plan_id : ''
      if (message.role === 'assistant' && isPlanLikeMessage(message) && planId) {
        if (!planMessages.has(planId) || message.kind === 'plan') {
          planMessages.set(planId, message)
        }
      }
    }

    // A completed report/status notice and its original crawl configuration are one logical
    // assistant reply. Keep both database records intact, but render the plan
    // inside the first analysis or status response for that plan instead of as a separate bubble.
    const mergedPlanIds = new Set<string>()
    const isPlanOutcomeMessage = (candidate: AgentMessage, planId: string) =>
      candidate.role === 'assistant'
      && candidate.metadata?.plan_id === planId
      && (candidate.kind === 'analysis' || candidate.kind === 'status' || String(candidate.metadata?.action || '').includes('analysis'))

    return messages.flatMap((message) => {
      const planId = typeof message.metadata?.plan_id === 'string' ? message.metadata.plan_id : ''
      if (message.role === 'assistant' && isPlanLikeMessage(message) && planId) {
        const hasOutcome = messages.some((candidate) => isPlanOutcomeMessage(candidate, planId))
        return hasOutcome ? [] : [{ message }]
      }
      if (message.role === 'assistant' && isPlanOutcomeMessage(message, planId) && planId && !mergedPlanIds.has(planId)) {
        const planMessage = planMessages.get(planId)
        if (planMessage) {
          mergedPlanIds.add(planId)
          return [{ message, planConfigContent: planMessage.content }]
        }
      }
      return [{ message }]
    })
  }, [threadQuery.data?.messages])
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
  // Collection and message generation are independent and scoped to the selected task.
  const isPlanRunning = activePlan ? ['queued', 'running'].includes(activePlan.status) : false
  const isCurrentPlanStopping = Boolean(activePlan && stoppingPlanIds.has(activePlan.plan_id))
  const isCurrentMessageStopping = Boolean(selectedId && stoppingMessageThreadIds.has(selectedId))
  const currentRegeneratingMessageId = selectedId ? regeneratingMessageByThread[selectedId] : undefined
  const aiRetryState = selectedId ? aiRetryStates[selectedId] || null : null
  const aiProgress = selectedId ? aiProgressByThread[selectedId] || null : null
  const terminalPlatforms = useMemo(() => Array.from(new Set(activePlan?.steps.map((step) => step.platform) || [])), [activePlan])
  const lastAssistantMessageId = useMemo(() => {
    const messages = threadQuery.data?.messages || []
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].message_id
    }
    return null
  }, [threadQuery.data?.messages])
  const planInitiatorMessageId = useMemo(() => {
    if (!activePlan || !['queued', 'running'].includes(activePlan.status)) return null
    const msgs = threadQuery.data?.messages || []
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === 'assistant' && m.metadata?.plan_id === activePlan.plan_id && isPlanLikeMessage(m)) {
        return m.message_id
      }
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role === 'assistant' && (m.metadata?.action === 'execute' || m.metadata?.plan_id === activePlan.plan_id)) {
        return m.message_id
      }
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'assistant') return msgs[i].message_id
    }
    return null
  }, [activePlan, threadQuery.data?.messages])
  const hasStreamingAnswer = Boolean(threadQuery.data?.messages.some((message) => message.metadata?.streaming))
  const isThinking = isCurrentMessagePending && !hasStreamingAnswer
  const toggleThreads = () => {
    setThreadsCollapsed((current) => {
      localStorage.setItem('unisearch-threads-collapsed', String(!current))
      return !current
    })
  }
  const updateCurrentThreadPanelState = (patch: Partial<{ rightSidebarOpen: boolean; terminalOpen: boolean; rightSidebarWidth: number; terminalHeight: number }>) => {
    if (!selectedId) return
    const current = threadPanelStatesRef.current[selectedId] || {
      rightSidebarOpen,
      terminalOpen,
      rightSidebarWidth,
      terminalHeight,
    }
    threadPanelStatesRef.current[selectedId] = {
      ...current,
      ...patch,
    }
  }

  const toggleRightSidebar = () => {
    setRightSidebarOpen((current) => {
      const next = !current
      updateCurrentThreadPanelState({ rightSidebarOpen: next })
      return next
    })
  }

  const toggleTerminal = () => {
    setTerminalOpen((current) => {
      const next = !current
      updateCurrentThreadPanelState({ terminalOpen: next })
      return next
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
    updateCurrentThreadPanelState({ rightSidebarWidth: next })
  }
  const updateTerminalHeight = (value: number) => {
    const next = Math.round(Math.min(480, Math.max(140, value)))
    setTerminalHeight(next)
    localStorage.setItem('unisearch-terminal-height', String(next))
    updateCurrentThreadPanelState({ terminalHeight: next })
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
      {!threadsCollapsed && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs md:hidden"
          onClick={toggleThreads}
          aria-hidden="true"
        />
      )}
      <aside
        className={`shrink-0 flex-col border-r border-cyber-border-subtle bg-cyber-bg-panel md:bg-cyber-bg-secondary/70 ${
          threadsCollapsed
            ? 'hidden'
            : 'fixed inset-y-0 left-0 z-50 flex shadow-2xl md:relative md:z-auto md:shadow-none'
        }`}
        style={{ width: leftSidebarWidth }}
      >
        <div className="flex h-9 shrink-0 items-center justify-end pl-[74px] pr-2 app-drag">
          <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0 rounded-lg text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary app-no-drag" onClick={toggleThreads} title="收起任务栏">
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        </div>
        <div className="pl-6 pr-3 pt-2 pb-2.5">
          <span className="text-xl font-bold tracking-tight text-cyber-text-primary">
            UniSearch
          </span>
        </div>
        <div className="px-2 pb-1.5">
          <Button className="w-full justify-start gap-2 h-9 text-sm font-medium rounded-xl" variant="ghost" onClick={openNewTask} disabled={create.isPending || createNewTask.isPending} title="新建任务">
            {createNewTask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquarePen className="h-4 w-4" />}新建任务
          </Button>
        </div>
        {!threadsCollapsed && <>
          <div className="mx-2 border-t border-cyber-border-subtle" />
          <div className="flex items-center justify-between px-2.5 py-1">
            <span className="text-[11px] font-medium text-cyber-text-muted">任务</span>
            <button
              type="button"
              onClick={() => {
                setThreadSearchOpen((open) => !open)
                if (threadSearchOpen) setThreadSearchQuery('')
              }}
              className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary ${threadSearchOpen ? 'text-cyber-neon-cyan' : 'text-cyber-text-muted'}`}
              aria-label={threadSearchOpen ? '关闭任务搜索' : '搜索任务'}
              title={threadSearchOpen ? '关闭搜索' : '搜索任务'}
            >
              <Search className="h-3.5 w-3.5" />
            </button>
          </div>
          {threadSearchOpen && <div className="px-2 pb-1.5">
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
              className="h-7 text-xs"
            />
          </div>}
          <div className="min-h-0 flex-1 flex flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5">
            {threadMenuId ? <button type="button" className="fixed inset-0 z-30 cursor-default" onClick={() => setThreadMenuId(null)} aria-label="关闭任务菜单" /> : null}
            {filteredThreads.map((thread, index) => {
              const isRunning = ['running', 'queued'].includes(thread.plan_status || '')
              const isFailed = thread.plan_status === 'failed'
              const hasData = Boolean(thread.total_items && thread.total_items > 0)
              // Strictly display Database icon ONLY when non-zero items are collected
              const isDataTask = hasData

              return (
                <div key={thread.thread_id} className={`group relative ${threadMenuId === thread.thread_id ? 'z-40' : ''}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(thread.thread_id)
                      if (window.innerWidth < 768) {
                        setThreadsCollapsed(true)
                      }
                    }}
                    title={`${thread.title}${hasData ? ` (已采集 ${thread.total_items} 条数据)` : ''}`}
                    className={`flex h-[34px] w-full items-center gap-2 rounded-xl px-2.5 text-left transition-colors ${
                      selectedId === thread.thread_id
                        ? 'bg-cyber-neon-cyan/10 font-medium text-cyber-text-primary/95 border border-cyber-neon-cyan/20'
                        : threadMenuId === thread.thread_id
                          ? 'bg-cyber-bg-tertiary/80 text-cyber-text-primary/95'
                          : 'font-medium text-cyber-text-primary/75 hover:bg-cyber-bg-tertiary/70 hover:text-cyber-text-primary/85'
                    }`}
                  >
                    {/* Fixed 20x20 Slot: Category Icon + Top-Right Data Count Badge */}
                    <div className="relative shrink-0 flex h-5 w-5 items-center justify-center text-cyber-text-muted/65">
                      {isRunning ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-cyber-text-muted/80" />
                      ) : isFailed ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-cyber-text-muted/75" />
                      ) : isDataTask ? (
                        <Database className="h-3.5 w-3.5 text-cyber-text-muted/65" />
                      ) : (
                        <MessageSquare className="h-3.5 w-3.5 text-cyber-text-muted/65" />
                      )}
                      {hasData ? (
                        <span
                          className="absolute -top-1 -right-2 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-cyber-bg-panel px-1 font-mono text-[8.5px] font-medium text-cyber-neon-cyan border border-cyber-neon-cyan/40 shadow-sm leading-none"
                          title={`已采集 ${thread.total_items} 条数据`}
                        >
                          {thread.total_items && thread.total_items > 999
                            ? `${(thread.total_items / 1000).toFixed(thread.total_items >= 10000 ? 0 : 1)}k`
                            : thread.total_items}
                        </span>
                      ) : null}
                    </div>

                    {/* Task Title (Slightly larger 13.5px font) */}
                    <span className="min-w-0 flex-1 truncate text-[13.5px] leading-snug">
                      {thread.title}
                    </span>

                    {/* Right Metadata Area */}
                    <div className="shrink-0 flex items-center gap-1.5 ml-auto text-right">
                      {/* Status Indicator */}
                      {isRunning ? (
                        <span className="relative flex h-2 w-2 shrink-0 items-center justify-center" title="任务运行中">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyber-neon-green/60 opacity-75" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyber-neon-green shadow-glow-green-sm" />
                        </span>
                      ) : isFailed ? (
                        <span className="font-mono text-[9.5px] text-cyber-text-muted/50 shrink-0">
                          failed
                        </span>
                      ) : null}

                      {/* Ultra-compact English Time (now, 1m, 5m, 2h, 1d) & Pin badge */}
                      <div className={`flex items-center gap-1 shrink-0 ${threadMenuId === thread.thread_id ? 'hidden' : 'group-hover:hidden'}`}>
                        {thread.pinned_at && <Pin className="h-3 w-3 text-cyber-neon-cyan/80" />}
                        <span className="font-mono text-[10.5px] text-cyber-text-muted/65">{timeAgo(thread.updated_at)}</span>
                      </div>

                      {/* 3-Dots Action Button (Visible on hover OR menu open) */}
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setThreadMenuId((current) => (current === thread.thread_id ? null : thread.thread_id))
                        }}
                        className={`items-center justify-center rounded-md p-1 transition-colors text-cyber-text-muted hover:bg-cyber-bg-panel hover:text-cyber-text-primary ${
                          threadMenuId === thread.thread_id ? 'flex text-cyber-text-primary' : 'hidden group-hover:flex'
                        }`}
                        aria-label={`管理 ${thread.title}`}
                        aria-haspopup="menu"
                        aria-expanded={threadMenuId === thread.thread_id}
                        title="任务操作"
                      >
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </button>

                  <div
                    role="menu"
                    className={`${
                      threadMenuId === thread.thread_id ? 'absolute' : 'hidden'
                    } right-1.5 z-50 w-32 overflow-hidden rounded-lg border border-cyber-border-default bg-cyber-bg-panel py-1 shadow-xl ${
                      filteredThreads.length > 2 && index >= filteredThreads.length - 2 ? 'bottom-8' : 'top-8'
                    }`}
                  >
                    <button
                      type="button"
                      role="menuitem"
                      disabled={pinThread.isPending}
                      onClick={() => {
                        setThreadMenuId(null)
                        pinThread.mutate({ id: thread.thread_id, pinned: !thread.pinned_at })
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary disabled:opacity-50"
                    >
                      {thread.pinned_at ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      {thread.pinned_at ? '取消置顶' : '置顶'}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setThreadMenuId(null)
                        setRenamingThread(thread)
                        setRenameTitle(thread.title)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"
                    >
                      <SquarePen className="h-3.5 w-3.5" />
                      重命名
                    </button>
                    <div className="my-1 border-t border-cyber-border-subtle" />
                    <DeleteConfirmDialog
                      trigger={
                        <button
                          type="button"
                          role="menuitem"
                          disabled={remove.isPending}
                          onClick={() => setThreadMenuId(null)}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-cyber-neon-pink hover:bg-cyber-neon-pink/10 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </button>
                      }
                      title="删除这个任务？"
                      description="将删除这个任务及其全部对话、计划和附件，此操作无法撤销。"
                      confirmLabel="删除任务"
                      onConfirm={() => remove.mutateAsync({ id: thread.thread_id, withData: deleteAnalyticsData })}
                    >
                      <label className="flex items-center gap-3 rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/60 p-3 text-left text-xs">
                        <Checkbox checked={deleteAnalyticsData} onCheckedChange={setDeleteAnalyticsData} />
                        <span className="font-medium text-cyber-text-primary">同时彻底删除该任务的全部采集数据</span>
                      </label>
                    </DeleteConfirmDialog>
                  </div>
                </div>
              )
            })}
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
        <div className={`flex h-11 shrink-0 items-center justify-between border-b border-cyber-border-subtle pr-2 sm:pr-2.5 app-drag ${threadsCollapsed ? 'pl-[74px]' : 'pl-[74px] md:pl-4 sm:md:pl-6'}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            <div className={`items-center gap-1.5 app-no-drag ${threadsCollapsed ? 'flex' : 'flex md:hidden'}`}>
              <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0 rounded-xl text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary" onClick={toggleThreads} title="展开任务栏">
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
              <div className="mx-1 h-3.5 w-[1px] bg-cyber-border-subtle" />
            </div>
            <h1 className="truncate text-sm font-medium">{threadQuery.data?.title || '新任务'}</h1>
          </div>
          <div className="flex items-center gap-1 app-no-drag">
            {/* 采集结束后依然保留入口：失败平台要回看页面，下次任务前要预登录 */}
            {(isCollecting || browserWindowQuery.data?.can_open) && <Button
              size="icon"
              variant="ghost"
              className={`h-8 w-8 rounded-xl transition-all focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${browserWindowQuery.data?.visible ? 'bg-cyber-bg-tertiary/30 text-cyber-neon-cyan' : 'text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary'}`}
              onClick={() => toggleBrowserWindow.mutate()}
              disabled={toggleBrowserWindow.isPending}
              title={browserWindowQuery.data?.visible ? '隐藏内置采集浏览器窗口' : '查看/操控内置采集浏览器窗口'}
              aria-label={browserWindowQuery.data?.visible ? '隐藏内置采集浏览器窗口' : '查看/操控内置采集浏览器窗口'}
              aria-pressed={browserWindowQuery.data?.visible}
            >
              {toggleBrowserWindow.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
            </Button>}
            {selectedId && <Button
              size="icon"
              variant="ghost"
              className={`h-8 w-8 rounded-xl transition-all text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${threadsCollapsed ? 'flex' : 'flex md:hidden'}`}
              onClick={openNewTask}
              disabled={create.isPending || createNewTask.isPending}
              title="新建任务"
              aria-label="新建任务"
            >
              {createNewTask.isPending ? <Loader2 className="h-4 w-4 animate-spin text-cyber-neon-cyan" /> : <MessageSquarePlus strokeWidth={1.75} className="h-4 w-4" />}
            </Button>}
            {selectedId && <Button
              size="icon"
              variant="ghost"
              className={`h-8 w-8 rounded-xl transition-all focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${terminalOpen ? 'bg-cyber-bg-tertiary/30 text-cyber-neon-cyan' : 'text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary'}`}
              onClick={toggleTerminal}
              title={terminalOpen ? '隐藏终端' : '显示终端'}
              aria-label={terminalOpen ? '隐藏终端' : '显示终端'}
              aria-pressed={terminalOpen}
            ><PanelBottom className="h-4 w-4" /></Button>}
            {selectedId && <Button
              size="icon"
              variant="ghost"
              className={`h-8 w-8 rounded-xl transition-all focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 ${rightSidebarOpen ? 'bg-cyber-bg-tertiary/30 text-cyber-neon-cyan' : 'text-cyber-text-muted hover:bg-cyber-bg-tertiary/25 hover:text-cyber-text-primary'}`}
              onClick={toggleRightSidebar}
              title={rightSidebarOpen ? '隐藏当前任务栏' : '显示当前任务栏'}
              aria-label={rightSidebarOpen ? '隐藏当前任务栏' : '显示当前任务栏'}
              aria-pressed={rightSidebarOpen}
            ><PanelRight className="h-4 w-4" /></Button>}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="flex min-w-0 flex-1 flex-col bg-cyber-bg-primary/40">
            <div ref={messagesScrollRef} onScroll={handleMessagesScroll} className="min-h-0 flex-1 overflow-y-auto">
              {selectedId ? <div className="mx-auto max-w-4xl space-y-7 px-4 py-8 sm:px-8">
                {threadQuery.isLoading ? <div className="flex justify-center py-20"><Loader2 className="animate-spin text-cyber-neon-cyan" /></div> : null}
                {displayMessages.map(({ message, planConfigContent }) => (
                  <MessageBubble
                    key={message.message_id}
                    message={message}
                    plan={activePlan}
                    activePlan={activePlan}
                    planConfigContent={planConfigContent}
                    onStopPlan={handleStopPlan}
                    stoppingPlan={isCurrentPlanStopping}
                    hasStreamingAnswer={hasStreamingAnswer}
                    isPlanInitiator={message.message_id === planInitiatorMessageId}
                    deletingPair={removeMessagePair.isPending || isCurrentMessagePending}
                    onDeletePair={handleDeleteMessagePair}
                    onRegenerate={handleRegenerateMessage}
                    regenerating={currentRegeneratingMessageId === message.message_id}
                    disabled={isCurrentMessagePending}
                    isLatestAssistant={message.role === 'assistant' && message.message_id === lastAssistantMessageId}
                    onPreviewImage={handlePreviewImage}
                    onCitationClick={handleCitationClick}
                  />
                ))}
                {isThinking && (
                  <ThinkingIndicator retryState={aiRetryState} progress={aiProgress} />
                )}
                <div />
              </div> : <div className="flex min-h-full items-center justify-center px-6 py-12">
                <div className="flex -translate-y-2 flex-col items-center text-center">
                  <div className="codex-pet-container">
                    <button
                      type="button"
                      className={`codex-pet ${petCelebrating ? 'codex-pet--celebrate' : ''}`}
                      onClick={celebratePet}
                      aria-label="和 UniSearch 宠物助手互动"
                      title="摸摸我"
                    />
                    <div className="codex-pet-shadow" />
                  </div>
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
              <div className="mx-auto max-w-3xl">
                <div
                  className="agent-composer relative rounded-3xl border border-cyber-border-default bg-cyber-bg-panel transition-colors"
                  onDragEnter={handleDragEnter}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {isDragOver ? (
                    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-1.5 rounded-3xl border-2 border-dashed border-cyber-neon-cyan bg-cyber-bg-panel/95 backdrop-blur transition-all pointer-events-none">
                      <Paperclip className="h-7 w-7 animate-bounce text-cyber-neon-cyan" />
                      <p className="text-sm font-medium text-cyber-neon-cyan">松开鼠标即可上传文件 / 图片</p>
                      <p className="text-[11px] text-cyber-text-muted">支持图片 (PNG/JPG/WebP/GIF) 与文本/表格 (TXT/MD/CSV/JSON/XLSX，≤ 8MB)</p>
                    </div>
                  ) : null}
                  {attachments.length || taskReferences.length ? <div className="flex flex-wrap items-center gap-2 px-3 pt-3 max-h-36 overflow-y-auto">
                    {attachments.map((attachment) => {
                      const isImage = attachment.kind === 'image' || attachment.mime_type?.startsWith('image/')
                      const imgUrl = attachment.preview_url || (selectedId ? agentApi.getAttachmentFileUrl(selectedId, attachment.attachment_id) : '')
                      if (isImage && imgUrl) {
                        return (
                          <div
                            key={attachment.attachment_id}
                            className="relative flex w-fit max-w-[210px] items-center gap-2 rounded-xl border border-cyber-border-subtle/70 bg-cyber-bg-panel/75 backdrop-blur-xs p-1 px-2 shadow-2xs transition-all hover:bg-cyber-bg-panel/90 hover:border-cyber-border-highlight"
                            title={attachment.file_name}
                          >
                            <img
                              src={imgUrl}
                              alt={attachment.file_name}
                              className="h-7 w-7 shrink-0 rounded-lg object-cover border border-cyber-border-subtle cursor-pointer hover:opacity-90"
                              onClick={() => setPreviewImageUrl(imgUrl)}
                            />
                            <div className="min-w-0 flex-1 text-left">
                              <p className="truncate text-[11px] sm:text-xs font-medium text-cyber-text-primary leading-tight">{attachment.file_name}</p>
                              <p className="text-[10px] text-cyber-text-muted mt-0.5 leading-none">{(attachment.size_bytes / 1024).toFixed(0)} KB</p>
                            </div>
                            <button type="button" onClick={() => removeAttachment(attachment)} aria-label={`移除 ${attachment.file_name}`} className="rounded p-0.5 hover:bg-cyber-bg-tertiary text-cyber-text-muted hover:text-cyber-text-primary transition-colors shrink-0">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        )
                      }
                      const categoryInfo = getAttachmentCategoryInfo(attachment.file_name, attachment.kind, attachment.mime_type)
                      return (
                        <AttachmentDisplayCard
                          key={attachment.attachment_id}
                          title={attachment.file_name}
                          categoryLabel={categoryInfo.label}
                          type={categoryInfo.type}
                          sizeBytes={attachment.size_bytes}
                          compact
                          onRemove={() => removeAttachment(attachment)}
                        />
                      )
                    })}
                    {taskReferences.map((reference) => (
                      <AttachmentDisplayCard
                        key={reference.plan_id}
                        title={reference.goal}
                        categoryLabel={`引用数据${reference.platforms.length ? ` · ${reference.platforms.map((platform) => platformLabels[platform] || platform).join('/')}` : ''}`}
                        type="data"
                        compact
                        onRemove={() => setTaskReferences((current) => current.filter((item) => item.plan_id !== reference.plan_id))}
                      />
                    ))}
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
                    onClose={mentionCommands.closePopover}
                    anchorRef={composerInputRef}
                  />
                  <div className="relative w-full">
                    <div
                      ref={composerBackdropRef}
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 min-h-[60px] w-full overflow-hidden whitespace-pre-wrap break-words px-3.5 py-2.5 pb-11 pr-14 text-sm leading-6 font-sans text-cyber-text-primary"
                    >
                      {renderMentionText(input)}
                      {input.endsWith('\n') ? '\u200b' : null}
                    </div>
                    <textarea
                      ref={composerInputRef}
                      value={input}
                      onScroll={(e) => {
                        if (composerBackdropRef.current) {
                          composerBackdropRef.current.scrollTop = e.currentTarget.scrollTop
                        }
                      }}
                      onChange={(e) => {
                        mentionCommands.handleInputChange(e.target.value, e.target.selectionStart)
                      }}
                      onKeyDown={(e) => {
                        const isHandled = mentionCommands.handleKeyDown(e, e.currentTarget.selectionStart)
                        if (isHandled) return
                        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          if (isCurrentMessagePending || isCurrentMessageStopping) return
                          submit()
                        }
                      }}
                      onPaste={handlePaste}
                      placeholder={isPlanRunning ? '采集在后台进行中，你可以继续提问…' : !selectedId ? '输入问题，或使用 @ 呼出 Skill、/ 呼出快捷指令…' : activePlan?.status === 'awaiting_confirmation' ? '自然地告诉我是否开始，或继续修改平台、关键词和采集范围…' : activePlan && ['completed', 'partially_completed'].includes(activePlan.status) ? '继续提问，例如：分析负面评价的主要原因…' : '使用 @ 选择 Skill，或使用 / 呼出快捷指令…'}
                      className="min-h-[60px] w-full resize-none bg-transparent px-3.5 py-2.5 pb-11 pr-14 text-sm leading-6 font-sans outline-none placeholder:text-cyber-text-muted text-transparent caret-cyber-neon-cyan"
                      spellCheck={false}
                    />
                  </div>
                  <div ref={addMenuRef} className="absolute bottom-2.5 left-3">
                    <Button size="icon" variant="ghost" className="h-9 w-9 rounded-full" onClick={() => setAddMenuOpen((open) => !open)} disabled={upload.isPending || isCurrentMessagePending} title="添加内容">
                      {upload.isPending ? <Loader2 className="animate-spin" /> : <Plus className="h-4.5 w-4.5" />}
                    </Button>
                    {addMenuOpen ? <div className="absolute bottom-11 left-0 z-30 w-56 overflow-hidden rounded-xl border border-cyber-border-default bg-cyber-bg-panel p-1.5 shadow-xl">
                      <button type="button" onClick={() => { setAddMenuOpen(false); fileInputRef.current?.click() }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-cyber-text-secondary hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
                        <Paperclip className="h-4 w-4" /><span><span className="block font-medium">上传文件</span><span className="mt-0.5 block text-[10px] text-cyber-text-muted">图片、文本、CSV、XLSX</span></span>
                      </button>
                      <button type="button" onClick={() => { setAddMenuOpen(false); setTaskPickerOpen(true) }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-xs text-cyber-text-secondary hover:bg-slate-100 dark:hover:bg-slate-800/80 hover:text-slate-900 dark:hover:text-slate-100 transition-colors">
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
                  {(() => {
                    // 三态：生成中 → 停止生成；采集中 → 中止采集；其余 → 发送
                    // 输入框有内容时仍然优先发送，采集期间照样可以继续追问
                    const mode = resolveComposerMode({
                      messagePending: isCurrentMessagePending,
                      planRunning: isPlanRunning,
                      hasInput: Boolean(input.trim()),
                    })
                    const label = mode === 'stop-message' ? '停止生成' : mode === 'stop-plan' ? '中止采集' : '发送'
                    const busy = mode === 'stop-message' ? isCurrentMessageStopping : mode === 'stop-plan' ? isCurrentPlanStopping : create.isPending
                    const isDisabled = mode === 'send' && (!input.trim() || create.isPending || isCurrentMessageStopping)

                    const isStopMode = mode === 'stop-message' || mode === 'stop-plan'
                    const buttonStyles = isStopMode
                      ? 'bg-slate-200/90 hover:bg-slate-300 dark:bg-slate-700/80 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'
                      : !isDisabled
                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                        : 'bg-slate-200/70 dark:bg-slate-800/60 text-slate-400 dark:text-slate-500 cursor-not-allowed'

                    return (
                      <button
                        type="button"
                        className={`absolute bottom-2.5 right-3 flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150 focus:outline-none ${buttonStyles}`}
                        onClick={() => {
                          if (mode === 'stop-message') stopGenerating()
                          else if (mode === 'stop-plan') { if (activePlan) stopPlan.mutate(activePlan.plan_id) }
                          else submit()
                        }}
                        disabled={isDisabled || busy}
                        aria-label={label}
                        title={label}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                        ) : isStopMode ? (
                          <Square className="h-3.5 w-3.5 fill-rose-500 text-rose-500 rounded-[1px]" />
                        ) : (
                          <ArrowRight className="h-4 w-4 stroke-[1.5]" />
                        )}
                      </button>
                    )
                  })()}
                </div>
              </div>
            </div>
          </main>

          {rightSidebarOpen && selectedId && <aside className="relative shrink-0 flex flex-col border-l border-cyber-border-subtle bg-cyber-bg-secondary/30" style={{ width: rightSidebarWidth }}>
            <div
              className={`absolute -left-[3px] top-0 z-20 h-full w-1.5 touch-none cursor-col-resize transition-colors hover:bg-cyber-neon-cyan/25 ${activeResize === 'right' ? 'bg-cyber-neon-cyan/35' : ''}`}
              onPointerDown={(event) => beginResize(event, 'right', (moveEvent) => {
                const bounds = workspaceRef.current?.getBoundingClientRect()
                if (bounds) updateRightSidebarWidth(bounds.right - moveEvent.clientX)
              })}
              aria-label="调整右侧边栏宽度"
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-4 space-y-4">
              {(() => {
                const allPlans = threadQuery.data?.plans || (activePlan ? [activePlan] : [])

                // 计算全会话累计抓取总量
                const sessionTotalItems = allPlans.reduce((sum, plan) => {
                  const count = plan.stats?.content_count ?? plan.steps.reduce((acc, s) => acc + (s.item_count || 0), 0)
                  return sum + count
                }, 0)

                const isPending = activePlan?.status === 'awaiting_confirmation'
                const isRunning = activePlan ? ['queued', 'running'].includes(activePlan.status) : false
                const activeConnectorSteps = activePlan
                  ? activePlan.steps.filter((s) => s.kind === 'connector' || (s.kind !== 'processor' && s.step_key !== 'business-analysis'))
                  : []
                const activeConnectorsCompleted = activePlan
                  ? activeConnectorSteps.length > 0 && activeConnectorSteps.every((step) => ['completed', 'failed', 'stopped', 'skipped'].includes(step.status))
                  : false
                // 正常退出但 0 条的平台同样计入可重试，否则它会被算作“已完成”而失去补救入口
                const emptyStepCount = activePlan
                  ? activePlan.steps.filter((s) => s.status === 'completed' && !(s.item_count || 0)).length
                  : 0
                const canRetry = activePlan
                  ? ['failed', 'partially_completed', 'stopped'].includes(activePlan.status)
                  || (activePlan.status === 'completed' && emptyStepCount > 0)
                  : false

                // 汇总各平台累计抓取数据分布
                const platformSummaryMap = new Map<string, {
                  platform: string
                  count: number
                  commentCount: number
                  status: string
                  isAI: boolean
                  error_message?: string
                }>()

                allPlans.forEach((plan) => {
                  plan.steps.forEach((step) => {
                    const existing = platformSummaryMap.get(step.platform)
                    const isAI = AI_PLATFORMS.has(step.platform)
                    const count = step.item_count || 0
                    const commentCount = step.comment_count || 0
                    if (!existing) {
                      platformSummaryMap.set(step.platform, {
                        platform: step.platform,
                        count,
                        commentCount,
                        status: step.status,
                        isAI,
                        error_message: step.error_message || undefined,
                      })
                    } else {
                      existing.count += count
                      existing.commentCount += commentCount
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
                  <div className="space-y-5 text-xs">
                    <div className="flex items-center justify-between">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyber-text-muted">任务与数据大盘</p>
                      {activePlan ? (() => {
                        const isAnalyzing = activePlan.status === 'running' && activeConnectorsCompleted
                        const statusKey = isAnalyzing ? 'analyzing' : activePlan.status
                        const cfg = STATUS_CONFIG[statusKey] || {
                          label: STATUS_LABELS[activePlan.status] || activePlan.status,
                          bg: 'bg-slate-500/10',
                          text: 'text-cyber-text-secondary',
                          border: 'border-cyber-border-DEFAULT/50',
                          dot: 'bg-slate-400',
                        }
                        return (
                          <span className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium select-none cursor-default pointer-events-none",
                            cfg.bg, cfg.text, cfg.border
                          )}>
                            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
                            <span>{cfg.label}</span>
                          </span>
                        )
                      })() : null}
                    </div>
                    {/* 区域 A：当前任务状态 / 控制卡片 */}
                    {activePlan && isPending ? (
                      <div className="rounded-xl border border-cyber-neon-cyan/40 bg-cyber-neon-cyan/10 p-3.5 shadow-sm ring-1 ring-cyber-neon-cyan/30">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1.5 font-semibold text-cyber-neon-cyan">
                            <Sparkles className="h-3.5 w-3.5" /> 待确认采集任务
                          </span>
                        </div>
                        <div className="mt-2.5 space-y-1.5 text-xs">
                          {activePlan.plan.keywords.length > 0 ? (
                            <p className="truncate font-medium text-cyber-text-primary" title={activePlan.plan.keywords.join(' / ')}>
                              关键词：<span className="text-cyber-neon-cyan">{activePlan.plan.keywords.join(' / ')}</span>
                            </p>
                          ) : null}
                          <div className="flex flex-wrap items-center gap-1 text-[10px] text-cyber-text-muted">
                            <span>平台：{activePlan.plan.platforms.map((p) => platformLabels[p] || p).join('、')}</span>
                          </div>
                        </div>
                        <Button
                          className="mt-3 w-full h-8.5 text-xs gap-1.5 bg-cyber-neon-cyan text-white hover:bg-cyber-neon-cyan/90 font-medium shadow-xs"
                          onClick={() => execute.mutate(activePlan.plan_id)}
                          disabled={execute.isPending}
                        >
                          {execute.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
                          确认并开始采集
                        </Button>
                      </div>
                    ) : activePlan && isRunning ? (
                      <div className="rounded-xl border border-cyber-neon-cyan/30 bg-cyber-bg-panel/80 p-3.5 shadow-sm">
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="flex items-center gap-1.5 font-semibold text-cyber-neon-cyan">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {activePlan.status === 'queued'
                              ? '采集任务排队中...'
                              : activeConnectorsCompleted
                                ? '正在分析采集结果...'
                                : '正在执行采集任务...'}
                          </span>
                          <PlanElapsedTime plan={activePlan} className="text-cyber-text-secondary" />
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
                                      {platformLabels[item.platform] || item.platform}
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
                                      {item.commentCount > 0 ? <span className="ml-1 text-[10px] font-normal text-cyber-text-muted">+{item.commentCount} 评论</span> : null}
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
                          {selectedId ? <SpreadsheetDownloadLink threadId={selectedId} compact /> : latestFinishedPlanId ? <SpreadsheetDownloadLink planId={latestFinishedPlanId} compact /> : null}
                        </div>
                      ) : null}
                      {isRunning && sessionTotalItems > 0 ? (
                        <Button
                          variant="outline"
                          className="h-9 w-full gap-1.5 text-xs"
                          onClick={() => handleApplyPrompt('先分析目前已采集的结果')}
                        >
                          <Sparkles className="h-3.5 w-3.5 text-cyber-neon-cyan" />
                          分析当前结果（阶段性）
                        </Button>
                      ) : null}
                      {canRetry && activePlan ? <Button className="w-full h-9 text-xs" onClick={() => execute.mutate(activePlan.plan_id)} disabled={execute.isPending}><Play />{activePlan.status === 'completed' ? '重试无结果平台' : activePlan.status === 'stopped' ? '继续采集未完成平台' : '重试失败/无结果平台'}</Button> : null}
                    </div>

                    {/* 知识资产与一键导出 (8 平台图标栏) */}
                    <div className="space-y-2 border-t border-cyber-border-subtle pt-3">
                      <div className="flex items-center justify-between text-[10px] text-cyber-text-muted">
                        <span>知识资产导出</span>
                        <span className="font-mono text-cyber-neon-cyan" title={`正文 ${knowledgeCounts.articles} 篇，评论 ${knowledgeCounts.comments} 条`}>
                          {knowledgeCounts.articles} 篇已归档
                          {knowledgeCounts.comments > 0 ? <span className="ml-1 text-cyber-text-muted">+{knowledgeCounts.comments} 评论</span> : null}
                        </span>
                      </div>
                      <PlatformExportIcons
                        onSelectPlatform={(platform) => setExportConfirmPlatform(platform)}
                      />
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
            </div>
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
              onClose={toggleTerminal}
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
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${selected ? 'border-cyber-neon-cyan bg-cyber-neon-cyan text-white' : 'border-cyber-border-default'}`}>{selected ? '✓' : ''}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-cyber-text-primary">{task.goal}</span><span className="mt-1 block text-[10px] text-cyber-text-muted">{task.content_count} 条内容 · {task.platforms.map((platform) => platformLabels[platform] || platform).join('、')}</span></span>
                </button>
                {selected ? <div className="mt-3 flex flex-wrap gap-1.5 border-t border-cyber-border-subtle pt-3">
                  <button type="button" onClick={() => setReferencePlatforms(task, [])} className={`rounded-md border px-2 py-1 text-[10px] ${!selected.platforms.length ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/10 text-cyber-neon-cyan' : 'border-cyber-border-default text-cyber-text-muted'}`}>全部平台</button>
                  {task.platforms.map((platform) => <button key={platform} type="button" onClick={() => setReferencePlatforms(task, [platform])} className={`rounded-md border px-2 py-1 text-[10px] ${selected.platforms.includes(platform) ? 'border-cyber-neon-cyan/50 bg-cyber-neon-cyan/10 text-cyber-neon-cyan' : 'border-cyber-border-default text-cyber-text-muted'}`}>{platformLabels[platform] || platform}</button>)}
                </div> : null}
              </div>
            })}
          </div>
          <DialogFooter><Button onClick={() => setTaskPickerOpen(false)}>完成{taskReferences.length ? `（已选 ${taskReferences.length}）` : ''}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {/* 图片全屏预览 — 纯 Portal，完全绕开 Radix Dialog 的 focus-trap 和 overlay 事件拦截 */}
      {previewImageUrl && createPortal(
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 9999 }}
          className="flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setPreviewImageUrl(null)}
        >
          {/* 右上角按钮组 */}
          <div
            style={{ position: 'absolute', top: 20, right: 24, zIndex: 10000 }}
            className="flex items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 下载按钮 */}
            <button
              type="button"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-slate-100/90 text-slate-900 shadow-2xl backdrop-blur-md transition-all select-none hover:scale-110 hover:bg-white active:scale-95 focus:outline-none"
              onClick={async (e) => {
                e.stopPropagation()
                if (!previewImageUrl) return
                try {
                  const res = await fetch(previewImageUrl)
                  const blob = await res.blob()
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  const ext = blob.type.split('/')[1] || 'png'
                  a.download = `image-preview-${Date.now()}.${ext}`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                  URL.revokeObjectURL(url)
                } catch {
                  window.open(previewImageUrl, '_blank')
                }
              }}
              title="下载图片"
              aria-label="下载图片"
            >
              <Download style={{ width: 20, height: 20, pointerEvents: 'none', cursor: 'pointer', display: 'block', flexShrink: 0 }} />
            </button>
            {/* 关闭按钮 */}
            <button
              type="button"
              className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-none bg-slate-100/90 text-slate-900 shadow-2xl backdrop-blur-md transition-all select-none hover:scale-110 hover:bg-white active:scale-95 focus:outline-none"
              onClick={(e) => {
                e.stopPropagation()
                setPreviewImageUrl(null)
              }}
              title="关闭预览"
              aria-label="关闭预览"
            >
              <X style={{ width: 20, height: 20, pointerEvents: 'none', cursor: 'pointer', display: 'block', flexShrink: 0 }} />
            </button>
          </div>
          {/* 图片 */}
          <img
            src={previewImageUrl}
            alt="图片预览"
            className="max-h-[85vh] max-w-[90vw] rounded-xl object-contain shadow-2xl select-none"
            onClick={(e) => e.stopPropagation()}
          />
        </div>,
        document.body
      )}

      {/* 知识库导出二次确认弹窗 (高对比度深色文本) */}
      <Dialog open={!!exportConfirmPlatform} onOpenChange={(open) => !open && setExportConfirmPlatform(null)}>
        <DialogContent className="border border-slate-200 bg-white shadow-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2.5 text-slate-900 text-base font-bold">
              {exportConfirmPlatform ? (
                <img src={exportConfirmPlatform.icon} alt="" className="h-6 w-6 object-contain rounded-md overflow-hidden" />
              ) : null}
              <span>导出至 {exportConfirmPlatform?.name} 知识库</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-600 pt-1 leading-relaxed">
              {exportConfirmPlatform?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="my-2 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-700">
              <span className="font-medium">归档文档总数：</span>
              <span className="font-mono font-bold text-cyan-600">
                {knowledgeCounts.articles} 篇正文
                {knowledgeCounts.comments > 0 ? ` + ${knowledgeCounts.comments} 条评论` : ''}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-700 border-t border-slate-200/80 pt-2">
              <span className="font-medium">预估文件名：</span>
              <span className="font-mono text-xs font-bold text-slate-900 bg-slate-200/60 px-1.5 py-0.5 rounded">
                {exportConfirmPlatform?.id === 'obsidian'
                  ? 'UniSearch_Obsidian_Vault.zip'
                  : exportConfirmPlatform?.id === 'ima'
                    ? 'UniSearch_IMA.zip'
                    : exportConfirmPlatform?.id === 'notion'
                      ? 'UniSearch_Notion.zip'
                      : exportConfirmPlatform?.id === 'logseq'
                        ? 'UniSearch_Logseq.zip'
                        : exportConfirmPlatform?.id === 'dify'
                          ? 'UniSearch_Dify.zip'
                          : exportConfirmPlatform?.id === 'yuque'
                            ? 'UniSearch_Yuque.zip'
                            : exportConfirmPlatform?.id === 'feishu'
                              ? 'UniSearch_Feishu.zip'
                              : exportConfirmPlatform?.id === 'markdown'
                                ? 'UniSearch_Markdown_Collection.md'
                                : 'UniSearch_Export.zip'}
              </span>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExportConfirmPlatform(null)}
              className="text-xs border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              取消
            </Button>
            <Button
              size="sm"
              onClick={() => {
                if (exportConfirmPlatform) {
                  handleExecuteDownload(exportConfirmPlatform.id)
                  setExportConfirmPlatform(null)
                  toast.success(`已开始生成 ${exportConfirmPlatform.name} 导出包并下载`, { duration: 3000 })
                }
              }}
              className="text-xs bg-cyan-600 text-white hover:bg-cyan-700 font-medium"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              确认导出并下载
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SourceDrawer
        isOpen={sourceDrawerOpen}
        onClose={() => setSourceDrawerOpen(false)}
        citation={activeCitation}
      />
    </div>
  )
}
