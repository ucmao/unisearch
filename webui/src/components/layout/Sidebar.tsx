import { BarChart3, Bug, Settings2, Wifi } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { useCrawlerStore } from '@/store/crawlerStore'
import { useCrawlerStatus } from '@/hooks/useCrawler'
import { ThemeToggle } from './ThemeToggle'

interface SidebarProps {
  activeView: 'crawler' | 'results'
  onViewChange: (view: 'crawler' | 'results') => void
}

export function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { t } = useTranslation()
  const statuses = useCrawlerStore((state) => state.statuses)

  // Poll status
  useCrawlerStatus()

  const isRunning = Object.values(statuses).some((s) => s === 'running')

  return (
    <header className="h-14 flex-shrink-0 glass-panel border-b border-cyber-border-subtle relative z-10">
      <div className="relative flex h-full items-center justify-between px-3 sm:px-4">
        {/* Left: Logo */}
        <div className="flex items-center gap-3">
          <Bug className="w-5 h-5 text-cyber-neon-cyan" />
          <span className="hidden font-mono text-sm font-bold tracking-wider text-cyber-text-primary sm:inline">
            科莱特三组Up
          </span>
          {isRunning && (
            <Badge variant="running" className="text-[10px]">
              {t('status.active')}
            </Badge>
          )}
          {isRunning && (
            <span className="w-2 h-2 bg-cyber-neon-green rounded-full shadow-glow-green-sm animate-pulse-fast" />
          )}
        </div>

        {/* Center: Primary navigation */}
        <nav
          aria-label="主导航"
          className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center rounded-lg border border-cyber-border-subtle bg-cyber-bg-secondary/80 p-1 shadow-sm"
        >
          <button
            type="button"
            aria-current={activeView === 'crawler' ? 'page' : undefined}
            aria-label="采集控制"
            title="采集控制"
            onClick={() => onViewChange('crawler')}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-mono transition-all sm:px-3 ${
              activeView === 'crawler'
                ? 'bg-cyber-neon-cyan/15 text-cyber-neon-cyan shadow-sm'
                : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary'
            }`}
          >
            <Settings2 className="h-4 w-4" />
            <span className="hidden sm:inline">采集控制</span>
          </button>
          <button
            type="button"
            aria-current={activeView === 'results' ? 'page' : undefined}
            aria-label="结果看板"
            title="结果看板"
            onClick={() => onViewChange('results')}
            className={`inline-flex h-8 items-center gap-2 rounded-md px-2.5 text-xs font-mono transition-all sm:px-3 ${
              activeView === 'results'
                ? 'bg-cyber-neon-cyan/15 text-cyber-neon-cyan shadow-sm'
                : 'text-cyber-text-secondary hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary'
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">结果看板</span>
          </button>
        </nav>

        {/* Right: Actions and Status */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Theme Toggle */}
          <ThemeToggle />
          {/* Status Info */}
          <div className="hidden lg:flex items-center gap-2 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <Wifi className="w-3 h-3 text-cyber-text-secondary" />
              <span className="text-cyber-text-secondary">{t('sidebar.local')}</span>
              <span className="status-dot status-dot-online" />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
