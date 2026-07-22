import { useState, useEffect, useRef, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Square, TerminalSquare, X } from 'lucide-react'
import { TerminalLine } from './TerminalLine'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { useStopCrawler } from '@/hooks/useCrawler'

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
}

export function Terminal({ showCollapseButton = true, platforms, planStatus, docked = false, onClose }: TerminalProps) {
  const { t } = useTranslation('terminal')
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
  const activeLogs = activePlatform ? logs[activePlatform] || [] : []
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
      <div className={`flex min-h-11 flex-shrink-0 flex-col justify-between gap-2 px-2 py-1 md:flex-row md:items-center ${docked ? 'bg-cyber-bg-panel' : 'border-b border-cyber-border-subtle bg-cyber-bg-secondary'}`}>
        {/* Left Side: Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-2 scrollbar-none">
          <div className="mr-2 flex h-8 items-center gap-2 px-2.5 text-cyber-text-secondary">
            <TerminalSquare className="h-4 w-4" />
            <span className="text-[11px] font-medium">执行终端</span>
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
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-medium cursor-pointer transition-all ${
                  isActive
                    ? 'border border-cyber-border-default bg-cyber-bg-panel text-cyber-neon-cyan'
                    : 'border border-transparent text-cyber-text-muted hover:bg-cyber-bg-tertiary/70 hover:text-cyber-text-primary'
                }`}
              >
                {/* Status Dot */}
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[pStatus]}`} />
                <span>{PLATFORM_LABELS[p] || p}</span>

                {/* Micro Actions */}
                {isRunning ? (
                  <button
                    onClick={(e) => handleStopSingle(e, p)}
                    className="ml-1 rounded p-0.5 text-cyber-text-muted transition-colors hover:bg-cyber-neon-pink/10 hover:text-cyber-neon-pink"
                    title="停止爬虫"
                  >
                    <Square className="w-2.5 h-2.5 fill-current" />
                  </button>
                ) : isStopping ? (
                  <span className="w-2 h-2 border border-t-transparent border-cyber-neon-orange rounded-full animate-spin ml-1" />
                ) : null}
              </div>
            )
          })}
        </div>

        {/* Right Side: Actions & Status */}
        <div className="flex items-center justify-end gap-3 px-2">
          {/* Active Log count & status */}
          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="text-cyber-text-muted">
              {activePlatform ? `${activePlatform.toUpperCase()}: ${t('header.entries', { count: activeLogs.length })}` : null}
            </span>
            {activeStatus === 'running' && (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-cyber-neon-green rounded-full shadow-glow-green-sm animate-pulse-fast" />
                <span className="text-cyber-neon-green font-bold text-[10px] uppercase">运行中</span>
              </div>
            )}
          </div>

          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-cyber-text-muted hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary" title="隐藏终端">
              <X className="h-4 w-4" />
            </Button>
          )}

          {/* Collapse toggle */}
          {showCollapseButton && <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-7 w-7 p-0 text-cyber-text-muted hover:bg-cyber-neon-cyan/10 hover:text-cyber-neon-cyan"
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
