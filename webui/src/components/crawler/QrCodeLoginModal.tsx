import React, { useEffect, useState } from 'react'
import { X, QrCode, ExternalLink, SkipForward, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface QrCodeEventData {
  platform: string
  qrCode: string
}

interface VerificationEventData {
  platform: string
  kind: 'qrcode' | 'manual'
  qrCode?: string
  reason?: string
}

const PLATFORM_NAMES: Record<string, string> = {
  bili: '哔哩哔哩 (Bilibili)',
  xhs: '小红书 (Xiaohongshu)',
  dy: '抖音 (Douyin)',
  ks: '快手 (Kuaishou)',
  wb: '新浪微博 (Weibo)',
  tieba: '百度贴吧 (Tieba)',
  zhihu: '知乎 (Zhihu)',
}

export const QrCodeLoginModal: React.FC = () => {
  const [verificationQueue, setVerificationQueue] = useState<VerificationEventData[]>([])
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  useEffect(() => {
    // Connect to EventSource endpoint /api/crawler/events
    const eventSource = new EventSource('/api/crawler/events')

    eventSource.addEventListener('qrcode_required', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as QrCodeEventData
        console.log('[QrCodeModal] Received QR Code required event:', data.platform)
        setVerificationQueue((current) => [
          ...current.filter((item) => item.platform !== data.platform),
          { platform: data.platform, kind: 'qrcode', qrCode: data.qrCode },
        ])
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse qrcode_required event:', err)
      }
    })

    eventSource.addEventListener('login_success', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { platform: string }
        console.log('[QrCodeModal] Received login_success event:', data.platform)
        setVerificationQueue((current) => current.filter((item) => item.platform !== data.platform))
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse login_success event:', err)
      }
    })

    eventSource.addEventListener('manual_verification_required', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { platform: string; reason?: string }
        setVerificationQueue((current) => [
          ...current.filter((item) => item.platform !== data.platform),
          { platform: data.platform, kind: 'manual', reason: data.reason },
        ])
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse manual verification event:', err)
      }
    })

    eventSource.addEventListener('manual_verification_success', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { platform: string }
        setVerificationQueue((current) => current.filter((item) => item.platform !== data.platform))
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse manual verification success:', err)
      }
    })

    eventSource.addEventListener('skipped', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { platform: string }
        console.log('[QrCodeModal] Received skipped event:', data.platform)
        setVerificationQueue((current) => current.filter((item) => item.platform !== data.platform))
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse skipped event:', err)
      }
    })

    eventSource.addEventListener('crawler_finished', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { platform: string }
        setVerificationQueue((current) => current.filter((item) => item.platform !== data.platform))
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse crawler_finished event:', err)
      }
    })

    return () => {
      eventSource.close()
    }
  }, [])

  const activeVerification = verificationQueue[0]
  if (!activeVerification) return null

  const platformName = PLATFORM_NAMES[activeVerification.platform] || activeVerification.platform.toUpperCase()
  const isManual = activeVerification.kind === 'manual'

  const handleSkip = async () => {
    setLoadingAction('skip')
    try {
      await fetch('/api/crawler/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: activeVerification.platform, action: 'skip' }),
      })
      setVerificationQueue((current) => current.filter((item) => item.platform !== activeVerification.platform))
    } catch (err) {
      console.error('Failed to skip platform:', err)
    } finally {
      setLoadingAction(null)
    }
  }

  const handleShowBrowser = async () => {
    setLoadingAction('show')
    try {
      await fetch('/api/crawler/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: activeVerification.platform, action: 'show_browser' }),
      })
    } catch (err) {
      console.error('Failed to send show_browser action:', err)
    } finally {
      setLoadingAction(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-xl transition-all">
        {/* Close/Skip Icon */}
        <button
          onClick={handleSkip}
          className="absolute right-4 top-4 rounded-full p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
          title="跳过此平台"
        >
          <X className="h-5 w-5" />
        </button>

        {/* Header */}
        <div className="flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/20 text-indigo-400 ring-1 ring-indigo-500/30 mb-3">
            <QrCode className="h-6 w-6" />
          </div>
          <h3 className="text-lg font-semibold text-white">{isManual ? '需要人工验证' : '需要登录'} {platformName}</h3>
          <p className="text-xs text-slate-400 mt-1">
            {isManual ? '请在平台专用浏览器中完成验证，采集会自动继续' : '请使用对应 App 扫描二维码以继续数据检索'}
          </p>
          {verificationQueue.length > 1 ? <p className="mt-2 text-[10px] text-indigo-300">还有 {verificationQueue.length - 1} 个平台等待处理</p> : null}
        </div>

        {/* QR Code Container */}
        <div className="relative my-5 flex justify-center">
          {isManual ? (
            <div className="flex h-48 w-48 flex-col items-center justify-center rounded-xl border border-indigo-500/30 bg-indigo-500/10 p-4 text-center">
              <ShieldCheck className="mb-3 h-12 w-12 text-indigo-300" />
              <span className="text-xs leading-5 text-indigo-100">{activeVerification.reason || '平台要求完成安全验证'}</span>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white p-3 shadow-inner">
              <img
                src={activeVerification.qrCode}
                alt="Login QR Code"
                className="h-44 w-44 object-contain"
              />
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="outline"
            onClick={handleSkip}
            disabled={loadingAction === 'skip'}
            className="flex-1 border-slate-700 bg-slate-800/50 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <SkipForward className="mr-1.5 h-4 w-4 text-slate-400" />
            跳过此平台
          </Button>

          <Button
            variant="outline"
            onClick={handleShowBrowser}
            disabled={loadingAction === 'show'}
            className="flex-1 border-indigo-500/30 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 hover:text-indigo-200"
          >
            <ExternalLink className="mr-1.5 h-4 w-4 text-indigo-400" />
            打开窗口
          </Button>
        </div>
      </div>
    </div>
  )
}
