import { useState, useEffect, useRef, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Trash2, RefreshCw, Square, Play } from 'lucide-react'
import { TerminalLine } from './TerminalLine'
import { useCrawlerStore } from '@/store/crawlerStore'
import { Button } from '@/components/ui/button'
import { useStartCrawler, useStopCrawler } from '@/hooks/useCrawler'
import { toast } from 'sonner'

const PLATFORM_LABELS: { [key: string]: string } = {
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  bili: '哔哩哔哩',
  wb: '微博',
  tieba: '百度贴吧',
  zhihu: '知乎',
}

const STATUS_DOTS: { [key: string]: string } = {
  idle: 'bg-zinc-500/80',
  running: 'bg-cyber-neon-green/80 shadow-glow-green-sm animate-pulse-fast',
  stopping: 'bg-cyber-neon-orange/80 shadow-glow-orange-sm animate-pulse',
  error: 'bg-cyber-neon-pink/80 shadow-glow-pink-sm',
}

const BANNER_INNER_WIDTH = 72
const KELOTE_ASCII = String.raw` _  __    _       _         _____                     _____
| |/ /___| | ___ | |_ ___  |_   _|__  __ _ _ __ ___ |___ /
| ' // _ \ |/ _ \| __/ _ \   | |/ _ \/ _' | '_ ' _ \  |_ \
| . \  __/ | (_) | ||  __/   | |  __/ (_| | | | | | |___) |
|_|\_\___|_|\___/ \__\___|   |_|\___|\__'_|_| |_| |_|____/`.split('\n')

function centerBannerLine(text: string) {
  const leftPadding = Math.max(0, Math.floor((BANNER_INNER_WIDTH - text.length) / 2))
  return `${' '.repeat(leftPadding)}${text}`.padEnd(BANNER_INNER_WIDTH)
}

function buildAsciiBanner(platform: string) {
  const horizontalBorder = '═'.repeat(BANNER_INNER_WIDTH)
  const logoWidth = Math.max(...KELOTE_ASCII.map((line) => line.length))
  const logoLeftPadding = Math.max(0, Math.floor((BANNER_INNER_WIDTH - logoWidth) / 2))
  const contentLines = KELOTE_ASCII.map((line) =>
    `${' '.repeat(logoLeftPadding)}${line.padEnd(logoWidth)}`.padEnd(BANNER_INNER_WIDTH)
  )
  const scanLabel = centerBannerLine(`[ INTELLIGENT SCAN: ${platform.toUpperCase()} ]`)

  return [
    `  ╔${horizontalBorder}╗`,
    ...contentLines.map((line) => `  ║${line}║`),
    `  ║${' '.repeat(BANNER_INNER_WIDTH)}║`,
    `  ║${scanLabel}║`,
    `  ╚${horizontalBorder}╝`,
  ].join('\n')
}

export function Terminal() {
  const { t } = useTranslation('terminal')
  const [isCollapsed, setIsCollapsed] = useState(false)

  // Store variables
  const logs = useCrawlerStore((state) => state.logs)
  const statuses = useCrawlerStore((state) => state.statuses)
  const clearedAfterLogId = useCrawlerStore((state) => state.clearedAfterLogId)
  const selectedPlatforms = useCrawlerStore((state) => state.selectedPlatforms)
  const activePlatformTab = useCrawlerStore((state) => state.activePlatformTab)
  const config = useCrawlerStore((state) => state.config)
  const platformCookies = useCrawlerStore((state) => state.platformCookies)

  // Actions
  const clearLogs = useCrawlerStore((state) => state.clearLogs)
  const restoreLogs = useCrawlerStore((state) => state.restoreLogs)
  const setActivePlatformTab = useCrawlerStore((state) => state.setActivePlatformTab)

  const { mutate: startPlatform } = useStartCrawler()
  const { mutate: stopPlatform } = useStopCrawler()

  const scrollRef = useRef<HTMLDivElement>(null)

  const activeLogs = logs[activePlatformTab] || []
  const activeStatus = statuses[activePlatformTab] || 'idle'
  const activeClearedId = clearedAfterLogId[activePlatformTab]

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

  const handleStartSingle = (e: MouseEvent, p: string) => {
    e.stopPropagation()
    if (config.login_type === 'cookie' && !platformCookies[p]?.trim()) {
      toast.error(`请先填写 ${PLATFORM_LABELS[p] || p} 的 Cookie`)
      return
    }
    startPlatform({
      ...config,
      platform: p,
      cookies: config.login_type === 'cookie' ? platformCookies[p] || '' : '',
    })
  }

  return (
    <div className={`flex flex-col rounded-xl overflow-hidden transition-all duration-300 border border-cyber-border-subtle bg-[#0d1117] ${isCollapsed ? 'h-12' : 'h-full'}`}>
      
      {/* Tab bar header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between bg-[#161b22] border-b border-[#30363d] flex-shrink-0 min-h-12 px-2 py-1.5 gap-2">
        {/* Left Side: Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-2 scrollbar-none">
          <div className="flex gap-1.5 mr-2">
            <span className="w-2.5 h-2.5 rounded-full bg-cyber-neon-pink/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-cyber-neon-orange/80" />
            <span className="w-2.5 h-2.5 rounded-full bg-cyber-neon-green/80" />
          </div>
          
          {selectedPlatforms.map((p) => {
            const isActive = activePlatformTab === p
            const pStatus = statuses[p] || 'idle'
            const isRunning = pStatus === 'running'
            const isStopping = pStatus === 'stopping'

            return (
              <div
                key={p}
                onClick={() => setActivePlatformTab(p)}
                className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-medium cursor-pointer transition-all ${
                  isActive
                    ? 'bg-[#21262d] text-cyber-neon-cyan border border-[#30363d]'
                    : 'text-[#8b949e] hover:text-[#c9d1d9] hover:bg-[#21262d]/50 border border-transparent'
                }`}
              >
                {/* Status Dot */}
                <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOTS[pStatus]}`} />
                <span>{PLATFORM_LABELS[p] || p}</span>

                {/* Micro Actions */}
                {isRunning ? (
                  <button
                    onClick={(e) => handleStopSingle(e, p)}
                    className="p-0.5 rounded hover:bg-cyber-neon-pink/20 text-[#8b949e] hover:text-cyber-neon-pink transition-colors ml-1"
                    title="停止爬虫"
                  >
                    <Square className="w-2.5 h-2.5 fill-current" />
                  </button>
                ) : isStopping ? (
                  <span className="w-2 h-2 border border-t-transparent border-cyber-neon-orange rounded-full animate-spin ml-1" />
                ) : (
                  <button
                    onClick={(e) => handleStartSingle(e, p)}
                    className="p-0.5 rounded hover:bg-cyber-neon-cyan/20 text-[#8b949e] hover:text-cyber-neon-cyan opacity-0 group-hover:opacity-100 transition-all ml-1"
                    title="启动爬虫"
                  >
                    <Play className="w-2.5 h-2.5 fill-current" />
                  </button>
                )}
              </div>
            )
          })}
        </div>

        {/* Right Side: Actions & Status */}
        <div className="flex items-center justify-end gap-3 px-2">
          {/* Active Log count & status */}
          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="text-[#8b949e]">
              {activePlatformTab.toUpperCase()}: {t('header.entries', { count: activeLogs.length })}
            </span>
            {activeStatus === 'running' && (
              <div className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 bg-cyber-neon-green rounded-full shadow-glow-green-sm animate-pulse-fast" />
                <span className="text-cyber-neon-green font-bold text-[10px] uppercase">运行中</span>
              </div>
            )}
          </div>

          {/* Restore logs */}
          {activeClearedId !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => restoreLogs(activePlatformTab)}
              className="h-7 w-7 p-0 text-[#8b949e] hover:text-cyber-neon-cyan hover:bg-[#00ffff]/10"
              title={t('header.restore')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          )}

          {/* Clear logs */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => clearLogs(activePlatformTab)}
            disabled={activeLogs.length === 0}
            className="h-7 w-7 p-0 text-[#8b949e] hover:text-cyber-neon-pink hover:bg-[#ff0080]/10 disabled:opacity-30"
            title={t('header.clear')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>

          {/* Collapse toggle */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="h-7 w-7 p-0 text-[#8b949e] hover:text-cyber-neon-cyan hover:bg-[#00ffff]/10"
          >
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Terminal Content - only show when not collapsed */}
      {!isCollapsed && (
        <>
          <div
            ref={scrollRef}
            className="flex-1 overflow-auto p-4 font-mono text-xs terminal-scroll bg-[#0d1117] min-h-0 select-text"
          >
            {/* Empty view / ASCI Banner */}
            {activeLogs.length === 0 ? (
              <div className="space-y-4 py-4">
                <pre className="text-cyber-neon-cyan/60 text-[10px] leading-tight select-none">
{buildAsciiBanner(activePlatformTab)}
                </pre>
                <div className="text-[#c9d1d9] text-[11px] space-y-1">
                  <p className="text-cyber-neon-green/70">
                    &gt;_ 控制台已就绪，等待操作...
                  </p>
                  <p className="text-[#8b949e]">
                    &gt;_ 请选择目标，然后点击“开始扫描”执行采集。
                  </p>
                </div>
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
                <span className="text-cyber-neon-green/80">root@{activePlatformTab}-crawler:~$</span>
                <span className="w-1.5 h-3 bg-cyber-neon-green/80 cursor-blink" />
              </div>
            )}
          </div>

          {/* Terminal Footer */}
          <div className="px-4 py-1.5 border-t border-[#30363d] bg-[#161b22] flex items-center justify-between flex-shrink-0 select-none">
            <span className="text-[10px] font-mono text-[#8b949e]">
              循环模式：{config.loop_execution ? '已开启' : '已关闭'}
            </span>
            <div className="text-[10px] font-mono text-[#8b949e] font-bold uppercase tracking-wider">
              {{ idle: '空闲', running: '运行中', stopping: '停止中', error: '错误' }[activeStatus] || activeStatus}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
