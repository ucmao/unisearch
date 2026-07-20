import React, { useEffect, useState } from 'react'
import { X, QrCode, ExternalLink, SkipForward, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface QrCodeEventData {
  platform: string
  qrCode: string
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
  const [activeQrData, setActiveQrData] = useState<QrCodeEventData | null>(null)
  const [loginSuccessPlatform, setLoginSuccessPlatform] = useState<string | null>(null)
  const [loadingAction, setLoadingAction] = useState<string | null>(null)

  useEffect(() => {
    // Connect to EventSource endpoint /api/crawler/events
    const eventSource = new EventSource('/api/crawler/events')

    eventSource.addEventListener('qrcode_required', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as QrCodeEventData
        console.log('[QrCodeModal] Received QR Code required event:', data.platform)
        setActiveQrData(data)
        setLoginSuccessPlatform(null)
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse qrcode_required event:', err)
      }
    })

    eventSource.addEventListener('login_success', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { platform: string }
        console.log('[QrCodeModal] Received login_success event:', data.platform)
        setLoginSuccessPlatform(data.platform)
        setTimeout(() => {
          setActiveQrData(null)
          setLoginSuccessPlatform(null)
        }, 2000)
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse login_success event:', err)
      }
    })

    eventSource.addEventListener('skipped', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { platform: string }
        console.log('[QrCodeModal] Received skipped event:', data.platform)
        setActiveQrData((prev) => (prev?.platform === data.platform ? null : prev))
      } catch (err) {
        console.error('[QrCodeModal] Failed to parse skipped event:', err)
      }
    })

    return () => {
      eventSource.close()
    }
  }, [])

  if (!activeQrData) return null

  const platformName = PLATFORM_NAMES[activeQrData.platform] || activeQrData.platform.toUpperCase()

  const handleSkip = async () => {
    setLoadingAction('skip')
    try {
      await fetch('/api/crawler/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform: activeQrData.platform, action: 'skip' }),
      })
      setActiveQrData(null)
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
        body: JSON.stringify({ platform: activeQrData.platform, action: 'show_browser' }),
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
          <h3 className="text-lg font-semibold text-white">需要登录 {platformName}</h3>
          <p className="text-xs text-slate-400 mt-1">请使用对应 App 扫描二维码以继续数据检索</p>
        </div>

        {/* QR Code Container */}
        <div className="relative my-5 flex justify-center">
          {loginSuccessPlatform ? (
            <div className="flex flex-col items-center justify-center h-48 w-48 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <CheckCircle2 className="h-12 w-12 text-emerald-400 mb-2 animate-bounce" />
              <span className="text-sm font-medium text-emerald-300">登录成功！</span>
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-xl border border-white/10 bg-white p-3 shadow-inner">
              <img
                src={activeQrData.qrCode}
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
