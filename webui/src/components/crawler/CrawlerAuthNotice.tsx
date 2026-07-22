import React, { useEffect, useState } from 'react'
import { ExternalLink, LogIn, ShieldAlert, SkipForward, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface AuthRequiredEventData {
  platform: string
  kind: 'login' | 'manual'
  reason?: string
}

const PLATFORM_NAMES: Record<string, string> = {
  bili: '哔哩哔哩',
  xhs: '小红书',
  dy: '抖音',
  ks: '快手',
  wb: '微博',
  tieba: '百度贴吧',
  zhihu: '知乎',
  baidu: '百度',
  bing: '必应',
  so360: '360搜索',
  sogou: '搜狗',
}

export const CrawlerAuthNotice: React.FC = () => {
  const [items, setItems] = useState<AuthRequiredEventData[]>([])
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  useEffect(() => {
    const eventSource = new EventSource('/api/crawler/events')
    const enqueue = (item: AuthRequiredEventData) => {
      setItems((current) => [...current.filter((entry) => entry.platform !== item.platform), item])
    }
    const remove = (platform: string) => {
      setItems((current) => current.filter((item) => item.platform !== platform))
    }
    const parsePlatform = (event: MessageEvent): { platform: string; reason?: string } | null => {
      try {
        return JSON.parse(event.data)
      } catch (error) {
        console.error('[CrawlerAuthNotice] Failed to parse crawler event:', error)
        return null
      }
    }

    const onLoginRequired = (event: MessageEvent) => {
      const data = parsePlatform(event)
      if (data) enqueue({ platform: data.platform, kind: 'login', reason: data.reason })
    }
    const onLegacyQrCode = (event: MessageEvent) => {
      const data = parsePlatform(event)
      if (data) enqueue({ platform: data.platform, kind: 'login', reason: '平台可能要求重新登录' })
    }
    const onManualVerification = (event: MessageEvent) => {
      const data = parsePlatform(event)
      if (data) enqueue({ platform: data.platform, kind: 'manual', reason: data.reason })
    }
    const onResolved = (event: MessageEvent) => {
      const data = parsePlatform(event)
      if (data) remove(data.platform)
    }

    eventSource.addEventListener('login_required', onLoginRequired)
    eventSource.addEventListener('qrcode_required', onLegacyQrCode)
    eventSource.addEventListener('manual_verification_required', onManualVerification)
    eventSource.addEventListener('login_success', onResolved)
    eventSource.addEventListener('manual_verification_success', onResolved)
    eventSource.addEventListener('skipped', onResolved)
    eventSource.addEventListener('crawler_finished', onResolved)
    return () => eventSource.close()
  }, [])

  const runAction = async (platform: string, action: 'show_browser' | 'skip') => {
    const actionKey = `${action}:${platform}`
    setLoadingAction(actionKey)
    try {
      const response = await fetch('/api/crawler/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, action }),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      if (action === 'skip') setItems((current) => current.filter((item) => item.platform !== platform))
    } catch (error) {
      console.error(`[CrawlerAuthNotice] Failed to ${action}:`, error)
    } finally {
      setLoadingAction(null)
    }
  }

  if (!items.length) return null

  return (
    <aside className="fixed bottom-5 right-5 z-50 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-cyber-border-default bg-cyber-bg-panel/95 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right-4 fade-in duration-200">
      <div className="flex items-start gap-3 border-b border-cyber-border-subtle px-4 py-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400">
          <LogIn className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-cyber-text-primary">采集可能需要你的操作</p>
          <p className="mt-0.5 text-[11px] leading-4 text-cyber-text-muted">浏览器不会自动弹出。请确认后再打开对应平台窗口。</p>
        </div>
        <button type="button" onClick={() => setItems([])} className="rounded-md p-1 text-cyber-text-muted hover:bg-cyber-bg-tertiary hover:text-cyber-text-primary" title="关闭提示">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-72 space-y-2 overflow-y-auto p-3">
        {items.map((item) => {
          const platformName = PLATFORM_NAMES[item.platform] || item.platform.toUpperCase()
          const isManual = item.kind === 'manual'
          return (
            <div key={item.platform} className="rounded-xl border border-cyber-border-subtle bg-cyber-bg-secondary/70 p-3">
              <div className="flex items-start gap-2.5">
                {isManual ? <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" /> : <LogIn className="mt-0.5 h-4 w-4 shrink-0 text-cyber-neon-cyan" />}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-cyber-text-primary">{platformName}{isManual ? ' 需要人工验证' : ' 可能需要登录'}</p>
                  <p className="mt-1 text-[10px] leading-4 text-cyber-text-muted">{item.reason || '请打开平台采集浏览器确认当前状态'}</p>
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" disabled={loadingAction === `skip:${item.platform}`} onClick={() => void runAction(item.platform, 'skip')}>
                  <SkipForward className="h-3.5 w-3.5" />跳过平台
                </Button>
                <Button size="sm" variant="outline" className="h-7 border-cyber-neon-cyan/30 bg-cyber-neon-cyan/10 px-2 text-[10px] text-cyber-neon-cyan" disabled={loadingAction === `show_browser:${item.platform}`} onClick={() => void runAction(item.platform, 'show_browser')}>
                  <ExternalLink className="h-3.5 w-3.5" />打开{platformName}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
