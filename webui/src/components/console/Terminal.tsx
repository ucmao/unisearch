import { useState, useEffect, useRef, useMemo, MouseEvent } from 'react'
import { ChevronDown, ChevronUp, Square, TerminalSquare, X } from 'lucide-react'
import { TerminalLine } from './TerminalLine'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { useStopCrawler, useThreadLogs } from '@/hooks/useCrawler'
import type { LogEntry } from '@/types/crawler'

const PLATFORM_LABELS: { [key: string]: string } = {
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: '哔哩哔哩',
  wb: '微博',
  tieba: '百度贴吧',
  zhihu: '知乎',
  baidu: '百度',
  bing: '必应',
  so360: '360搜索',
  sogou: '搜狗',
  zhaopin: '智联招聘',
  heimao: '黑猫投诉',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
  doubao: '豆包',
  qwen: '通义千问',
  yuanbao: '腾讯元宝',
  nami: '纳米AI',
  wenxin: '文心一言',
}

const STATUS_DOTS: { [key: string]: string } = {
  idle: 'bg-zinc-500/80',
  running: 'bg-cyber-neon-green/80 shadow-glow-green-sm animate-pulse-fast',
  stopping: 'bg-cyber-neon-orange/80 shadow-glow-orange-sm animate-pulse',
  error: 'bg-cyber-neon-pink/80 shadow-glow-pink-sm',
}

interface TerminalProps {
  showCollapseButton?: boolean
  platforms?: string[]
  planStatus?: string
  docked?: boolean
  onClose?: () => void
  threadId?: string
}

export function Terminal({ showCollapseButton = true, platforms, planStatus, docked = false, onClose, threadId }: TerminalProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Store variables
  const logs = useCrawlerStore((state) => state.logs)
  const statuses = useCrawlerStore((state) => state.statuses)
  const storedPlatforms = useCrawlerStore((state) => state.selectedPlatforms)
  const activePlatformTab = useCrawlerStore((state) => state.activePlatformTab)

  // Actions
  const setActivePlatformTab = useCrawlerStore((state) => state.setActivePlatformTab)

  const { mutate: stopPlatform } = useStopCrawler()

  const scrollRef = useRef<HTMLDivElement>(null)

  const visiblePlatforms = platforms ?? storedPlatforms
  const activePlatform = visiblePlatforms.includes(activePlatformTab) ? activePlatformTab : visiblePlatforms[0] || ''

  // Fetch historical logs for current thread & active platform
  const { data: threadLogs = [] } = useThreadLogs(threadId, activePlatform)

  // Real-time logs from crawlerStore
  const storeLogs = useMemo(() => (activePlatform ? logs[activePlatform] || [] : []), [logs, activePlatform])

  // Filter store logs by threadId if threadId is provided
  const filteredStoreLogs = useMemo(() => {
    if (!threadId) return storeLogs
    return storeLogs.filter((log) => !log.thread_id || log.thread_id === threadId)
  }, [storeLogs, threadId])

  // Combine and deduplicate logs
  const activeLogs = useMemo(() => {
    if (!threadId) return filteredStoreLogs
    const logMap = new Map<number, LogEntry>()
    threadLogs.forEach((log) => logMap.set(log.id, log))
    filteredStoreLogs.forEach((log) => logMap.set(log.id, log))
    return Array.from(logMap.values()).sort((a, b) => a.id - b.id)
  }, [threadId, threadLogs, filteredStoreLogs])

  const activeStatus = activePlatform ? statuses[activePlatform] || 'idle' : 'idle'

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [activeLogs, isCollapsed])

  const handleStopSingle = (e: MouseEvent, p: string) => {
    e.stopPropagation()
    stopPlatform(p)
  }

  const emptyMessage = !visiblePlatforms.length
    ? ['尚无执行任务。', '向 AI 描述调研需求；计划经你确认后，执行日志会显示在这里。']
    : planStatus === 'awaiting_confirmation'
      ? ['AI 已生成执行计划。', '确认计划后，所选平台的执行日志会显示在这里。']
      : planStatus === 'queued'
        ? ['任务已进入执行队列。', '正在等待本机采集进程启动…']
        : planStatus === 'running'
          ? ['采集任务正在执行。', '正在等待该平台输出日志…']
          : ['当前平台暂无执行日志。', '新的日志产生后会自动显示在这里。']

  return (
    <div className={`flex flex-col overflow-hidden bg-cyber-bg-panel transition-all duration-300 ${docked ? 'h-full' : `rounded-xl border border-cyber-border-subtle ${isCollapsed ? 'h-12' : 'h-full'}`}`}>
      
      {/* Tab bar header */}
      <div className={`flex h-11 shrink-0 items-center justify-between gap-2 px-2 py-1 ${docked ? 'bg-cyber-bg-panel' : 'border-b border-cyber-border-subtle bg-cyber-bg-secondary'}`}>
        {/* Left Side: Tabs */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-2 scrollbar-none">
          <div className="mr-1 flex h-8 shrink-0 items-center gap-1.5 px-2 text-cyber-text-secondary select-none">
            <TerminalSquare className="h-4 w-4 shrink-0" />
            <span className="text-[11px] font-medium whitespace-nowrap">执行终端</span>
          </div>
          
          {visiblePlatforms.map((p) => {
            const isActive = activePlatform === p
            const pStatus = statuses[p] || 'idle'
            const isRunning = pStatus === 'running'
            const isStopping = pStatus === 'stopping'

            return (
              <div
                key={p}
                onClick={() => setActivePlatformTab(p)}
                className={`group flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium cursor-pointer transition-all whitespace-nowrap select-none ${
                  isActive
                    ? 'border border-cyber-border-default bg-cyber-bg-panel text-cyber-neon-cyan'
                    : 'border border-transparent text-cyber-text-muted hover:bg-cyber-bg-tertiary/70 hover:text-cyber-text-primary'
                }`}
              >
                {/* Status Dot */}
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOTS[pStatus]}`} />
                <span className="whitespace-nowrap">{PLATFORM_LABELS[p] || p}</span>

                {/* Micro Actions */}
                {isRunning ? (
                  <button
                    onClick={(e) => handleStopSingle(e, p)}
                    className="ml-0.5 rounded p-0.5 text-cyber-text-muted transition-colors hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink"
                    title="停止爬虫"
                  >
                    <Square className="w-2.5 h-2.5 fill-current" />
                  </button>
                ) : isStopping ? (
                  <span className="w-2 h-2 border border-t-transparent border-cyber-neon-orange rounded-full animate-spin ml-0.5 shrink-0" />
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Right Side: Actions & Status */}
        <div className="flex shrink-0 items-center justify-end gap-2 px-2">
          {/* Active status */}
          {activeStatus === 'running' && (
            <div className="flex shrink-0 items-center gap-1 text-[11px] font-mono whitespace-nowrap">
              <span className="w-1.5 h-1.5 bg-cyber-neon-green rounded-full shadow-glow-green-sm animate-pulse-fast shrink-0" />
              <span className="text-cyber-neon-green font-bold text-[10px] uppercase">运行中</span>
            </div>
          )}

          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 shrink-0 text-cyber-text-muted hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary" title="隐藏终端">
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* Collapse toggle */}
          {showCollapseButton && <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-7 w-7 p-0 shrink-0 text-cyber-text-muted hover:bg-cyber-neon-cyan/10 hover:text-cyber-neon-cyan"
          >
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </Button>}
        </div>
      </div>

      {/* Terminal Content - only show when not collapsed */}
      {!isCollapsed && (
        <>
          <div
            ref={scrollRef}
            className="terminal-scroll min-h-0 flex-1 select-text overflow-auto bg-cyber-bg-panel px-4 pb-4 pt-2 font-mono text-xs"
          >
            {/* AI task-aware empty view */}
            {activeLogs.length === 0 ? (
              <div className="space-y-1 text-[11px]">
                <p className="text-cyber-text-primary">&gt;_ {emptyMessage[0]}</p>
                <p className="text-cyber-text-muted">&gt;_ {emptyMessage[1]}</p>
              </div>
            ) : (
              <div className="space-y-0.5">
                {activeLogs.map((log) => (
                  <TerminalLine key={log.id} log={log} />
                ))}
              </div>
            )}

            {/* Active Cursor */}
            {activeStatus === 'running' && (
              <div className="flex items-center gap-1 mt-3">
                <span className="text-cyber-neon-green/80">agent@{activePlatform}:~$</span>
                <span className="w-1.5 h-3 bg-cyber-neon-green/80 cursor-blink" />
              </div>
            )}
          </div>

        </>
      )}
    </div>
  )
}
