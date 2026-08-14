import { useState, useEffect, useRef, useMemo, MouseEvent } from 'react'
import { ChevronDown, ChevronUp, Square, TerminalSquare, X } from 'lucide-react'
import { TerminalLine } from './TerminalLine'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectSeparator,
} from '@/components/ui/select'
import { useStopCrawler, useThreadLogs } from '@/hooks/useCrawler'
import type { LogEntry } from '@/types/crawler'
import { usePlatformLabels } from '@/hooks/usePlatformCatalog'

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
  plans?: any[]
}

export function Terminal({
  showCollapseButton = true,
  platforms,
  planStatus,
  docked = false,
  onClose,
  threadId,
  plans,
}: TerminalProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [selectedRound, setSelectedRound] = useState<'all' | number>('all')
  const platformLabels = usePlatformLabels()

  // Store variables
  const logs = useCrawlerStore((state) => state.logs)
  const statuses = useCrawlerStore((state) => state.statuses)
  const storedPlatforms = useCrawlerStore((state) => state.selectedPlatforms)
  const activePlatformTab = useCrawlerStore((state) => state.activePlatformTab)

  // Actions
  const setActivePlatformTab = useCrawlerStore((state) => state.setActivePlatformTab)
  const { mutate: stopPlatform } = useStopCrawler()
  const scrollRef = useRef<HTMLDivElement>(null)

  // Extract all deduplicated platforms across all rounds
  const allUniquePlatforms = useMemo(() => {
    const set = new Set<string>()
    if (plans && plans.length > 0) {
      plans.forEach((p) => {
        p.steps?.forEach((s: any) => {
          if (s.platform) set.add(s.platform)
        })
      })
    }
    if (platforms) {
      platforms.forEach((p) => {
        if (p) set.add(p)
      })
    }
    if (set.size === 0 && storedPlatforms) {
      storedPlatforms.forEach((p) => {
        if (p) set.add(p)
      })
    }
    return Array.from(set)
  }, [plans, platforms, storedPlatforms])

  // Filter visible platform tabs based on selectedRound
  const visiblePlatforms = useMemo(() => {
    if (selectedRound === 'all') {
      return allUniquePlatforms.length > 0 ? allUniquePlatforms : (platforms ?? storedPlatforms)
    }
    const targetPlan = plans?.find((p, idx) => (p.round_number || idx + 1) === selectedRound)
    if (targetPlan?.steps && targetPlan.steps.length > 0) {
      const set = new Set<string>()
      targetPlan.steps.forEach((s: any) => {
        if (s.platform) set.add(s.platform)
      })
      return Array.from(set)
    }
    return allUniquePlatforms.length > 0 ? allUniquePlatforms : (platforms ?? storedPlatforms)
  }, [selectedRound, allUniquePlatforms, plans, platforms, storedPlatforms])

  const activePlatform = useMemo(() => {
    if (visiblePlatforms.includes(activePlatformTab)) {
      return activePlatformTab
    }
    // Prefer running platform if available in visible tabs
    const runningPlat = visiblePlatforms.find((p) => statuses[p] === 'running')
    if (runningPlat) return runningPlat
    return visiblePlatforms[0] || ''
  }, [visiblePlatforms, activePlatformTab, statuses])

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

  // Helper to map a log entry to its round number
  const getLogRound = useMemo(() => {
    return (log: LogEntry): number => {
      if (!plans || plans.length === 0) return 1
      if (log.plan_id) {
        const found = plans.find((p) => p.workflow_id === log.plan_id || p.plan_id === log.plan_id)
        if (found) return found.round_number || (plans.indexOf(found) + 1)
      }
      if (log.run_id) {
        for (let i = 0; i < plans.length; i++) {
          const p = plans[i]
          if (p.steps?.some((s: any) => s.run_id === log.run_id)) {
            return p.round_number || (i + 1)
          }
        }
      }
      // Fallback: match by created_at timestamp
      if (log.timestamp) {
        const logTime = new Date(log.timestamp).getTime()
        if (!isNaN(logTime)) {
          for (let i = plans.length - 1; i >= 0; i--) {
            const pTime = new Date(plans[i].created_at).getTime()
            if (!isNaN(pTime) && logTime >= pTime) {
              return plans[i].round_number || (i + 1)
            }
          }
        }
      }
      return 1
    }
  }, [plans])

  // Build rendered list with optional round dividers
  const displayItems = useMemo(() => {
    if (activeLogs.length === 0) return []
    if (selectedRound !== 'all') {
      return activeLogs
        .filter((log) => getLogRound(log) === selectedRound)
        .map((log) => ({ type: 'log' as const, key: `log-${log.id}`, log }))
    }

    // 'all' mode: add round dividers if multiple plans exist
    const items: Array<{
      type: 'divider' | 'log'
      key: string
      round?: number
      plan?: any
      log?: LogEntry
      timestamp?: string
    }> = []

    let lastRound = -1
    for (const log of activeLogs) {
      const round = getLogRound(log)
      if (plans && plans.length > 1 && round !== lastRound) {
        const plan = plans.find((p) => (p.round_number || 1) === round)
        items.push({
          type: 'divider',
          key: `divider-r${round}-${log.id}`,
          round,
          plan,
          timestamp: log.timestamp || '',
        })
        lastRound = round
      }
      items.push({
        type: 'log',
        key: `log-${log.id}`,
        log,
      })
    }
    return items
  }, [activeLogs, selectedRound, getLogRound, plans])

  const activeStatus = activePlatform ? statuses[activePlatform] || 'idle' : 'idle'

  // Auto scroll to bottom
  useEffect(() => {
    if (scrollRef.current && !isCollapsed) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [displayItems, isCollapsed])

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
    <div
      className={`flex flex-col overflow-hidden bg-cyber-bg-panel transition-all duration-300 ${docked ? 'h-full' : `rounded-xl border border-cyber-border-subtle ${isCollapsed ? 'h-12' : 'h-full'}`}`}
    >
      {/* Tab bar header */}
      <div
        className={`flex h-11 shrink-0 items-center justify-between gap-2 px-2 py-1 ${docked ? 'bg-cyber-bg-panel' : 'border-b border-cyber-border-subtle bg-cyber-bg-secondary'}`}
      >
        {/* Left Side: Title + Minimal Round Pill + Platform Tabs */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto px-2 scrollbar-none">
          <div className="mr-1 flex h-8 shrink-0 items-center gap-1.5 px-1.5 text-cyber-text-secondary select-none">
            <TerminalSquare className="h-4 w-4 shrink-0 text-cyber-neon-cyan/80" />
            <span className="text-[11px] font-medium whitespace-nowrap">执行终端</span>
          </div>

          {/* Ultra-compact Round Selector Capsule with Portal (Never gets clipped by overflow) */}
          {plans && plans.length > 1 && (
            <div className="flex shrink-0 items-center mr-1">
              <Select
                value={String(selectedRound)}
                onValueChange={(val) => setSelectedRound(val === 'all' ? 'all' : Number(val))}
              >
                <SelectTrigger className="h-6.5 w-auto gap-1 rounded-md border-cyber-border-subtle bg-cyber-bg-tertiary/70 px-2 py-0 font-mono text-[11px] text-cyber-text-secondary hover:border-cyber-border-default hover:text-cyber-text-primary focus:ring-0 focus:shadow-none focus:border-cyber-neon-cyan select-none transition-all">
                  <span className="font-medium whitespace-nowrap">
                    {selectedRound === 'all' ? '全部轮次' : `第 ${selectedRound} 轮`}
                  </span>
                </SelectTrigger>

                <SelectContent className="min-w-[96px] border-cyber-border-default bg-cyber-bg-panel text-cyber-text-primary shadow-xl backdrop-blur-md">
                  <SelectItem value="all">
                    全部轮次
                  </SelectItem>

                  <SelectSeparator />

                  {plans.map((p, idx) => {
                    const rNum = p.round_number || idx + 1
                    return (
                      <SelectItem
                        key={p.workflow_id || p.plan_id || idx}
                        value={String(rNum)}
                      >
                        第 {rNum} 轮
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Platform Tabs */}
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
                <span className="whitespace-nowrap">{platformLabels[p] || p}</span>

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
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0 shrink-0 text-cyber-text-muted hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary"
              title="隐藏终端"
            >
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* Collapse toggle */}
          {showCollapseButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsCollapsed(!isCollapsed)}
              className="h-7 w-7 p-0 shrink-0 text-cyber-text-muted hover:bg-cyber-neon-cyan/10 hover:text-cyber-neon-cyan"
            >
              {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </Button>
          )}
        </div>
      </div>

      {/* Terminal Content - only show when not collapsed */}
      {!isCollapsed && (
        <div
          ref={scrollRef}
          className="terminal-scroll min-h-0 flex-1 select-text overflow-auto bg-cyber-bg-panel px-4 pb-4 pt-2 font-mono text-xs"
        >
          {/* AI task-aware empty view */}
          {displayItems.length === 0 ? (
            <div className="space-y-1 text-[11px]">
              <p className="text-cyber-text-primary">&gt;_ {emptyMessage[0]}</p>
              <p className="text-cyber-text-muted">&gt;_ {emptyMessage[1]}</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {displayItems.map((item) => {
                if (item.type === 'divider') {
                  const goalText = item.plan?.goal ? item.plan.goal.replace(/（增量更新.*$/, '').trim() : ''
                  const timeStr = item.timestamp
                    ? item.timestamp
                    : item.plan?.created_at
                      ? new Date(item.plan.created_at).toLocaleTimeString('zh-CN', { hour12: false })
                      : ''

                  return (
                    <div
                      key={item.key}
                      className="group -mx-1 flex gap-2 rounded px-1 font-mono text-xs leading-relaxed transition-colors hover:bg-cyber-bg-tertiary/50 my-1"
                    >
                      {/* Timestamp */}
                      <span className="flex-shrink-0 text-cyber-text-muted opacity-70 transition-opacity group-hover:opacity-100">
                        [{timeStr || '00:00:00'}]
                      </span>

                      {/* Level badge */}
                      <span className="flex-shrink-0 w-14 px-1 rounded text-center bg-cyber-neon-cyan/15 text-cyber-neon-cyan shadow-[0_0_3px_rgba(0,255,255,0.2)] font-medium">
                        [阶段]
                      </span>

                      {/* Message */}
                      <span className="break-all text-cyber-neon-cyan font-medium">
                        ─── 启动第 {item.round} 轮采集{goalText ? ` (${goalText})` : ''} ───
                      </span>
                    </div>
                  )
                }

                return item.log ? <TerminalLine key={item.key} log={item.log} /> : null
              })}
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
      )}
    </div>
  )
}
